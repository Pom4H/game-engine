/** Semantic hot edits. Editor widgets do not know how to mutate physics/render internals. */
import type {Scene} from '../scene/scene.js';
import type {MaterialSpec,AppearancePatch,SceneSpec} from '../scene/types.js';
import type {SceneProgram} from './index.js';
import {programVehicles,reviseProgram} from './runtime.js';
const optical=['color','roughness','metalness','clearcoat','clearcoatRoughness'] as const;
function physicalMaterial(m:MaterialSpec|undefined){
 if(!m)return undefined;
 const copy={...m};for(const k of optical)delete copy[k];
 // Alpha changes render classification: require a validated rebuild, never partial patch.
 return {...copy,alpha:m.color?.[3]??1};
}
/** Small source definitions rather than generated vehicle vertex arrays. */
export function structureKey(program:SceneProgram):string {
 const {camera:_,rendering:__,entities,...spec}=program.scene;
 return JSON.stringify({follow:program.follow,spec,entities:entities.map(({material,...e})=>({...e,material:physicalMaterial(material)})),vehicles:program.vehicles.map(v=>({
  source:v.blueprint.source,model:v.geometry.definition,
  options:{...v.options,paint:physicalMaterial(v.options.paint)},timeline:v.timeline,
 }))});
}
function appearance(material:MaterialSpec|undefined):NonNullable<AppearancePatch['materials']>[number]['set']{
 const m:Record<string,unknown>={};for(const k of optical)if(material?.[k]!==undefined)m[k]=material[k];return m;
}
/** Only apply changed leaves. Unrelated raw defaults cannot overwrite evolved runtime state. */
function changedOptics(before:MaterialSpec|undefined,after:MaterialSpec|undefined){
 const patch:Record<string,unknown>={};
 for(const k of optical)if(JSON.stringify(before?.[k])!==JSON.stringify(after?.[k])){
  // Deleting a property means restore material defaults: a rebuild makes this unambiguous.
  if(after?.[k]===undefined)return null;patch[k]=after[k];
 }
 return patch as ReturnType<typeof appearance>;
}
export interface ProgramEdit {readonly mode:'live'|'rebuild';readonly reason:string;readonly patch?:AppearancePatch;readonly camera?:SceneSpec['camera'];}
export function planProgramEdit(before:SceneProgram,after:SceneProgram):ProgramEdit{
 if(structureKey(before)!==structureKey(after))return{mode:'rebuild',reason:'Изменилась конструкция или начальное состояние'};
 const materials:NonNullable<AppearancePatch['materials']>[number][]=[],rendering:Record<string,unknown>={};
 for(let i=0;i<after.scene.entities.length;i++){
  const prev=before.scene.entities[i]!,next=after.scene.entities[i]!,set=changedOptics(prev.material,next.material);
  if(set===null)return{mode:'rebuild',reason:'Восстановление материала по умолчанию'};
  if(Object.keys(set).length)materials.push({id:next.id,set});
 }
 for(let i=0;i<after.vehicles.length;i++){
  const prev=before.vehicles[i]!,next=after.vehicles[i]!,set=changedOptics(prev.options.paint,next.options.paint);
  if(set===null)return{mode:'rebuild',reason:'Восстановление покрытия'};
  if(Object.keys(set).length)for(const part of next.geometry.parts)if(part.role==='paint')materials.push({id:`${next.blueprint.source.id}/${part.id}`,set});
  if(prev.air&&!next.air)return{mode:'rebuild',reason:'Восстановление атмосферы'};
 }
 for(const key of new Set([...Object.keys(before.scene.rendering??{}),...Object.keys(after.scene.rendering??{})])){
  const previous=(before.scene.rendering as Record<string,unknown>|undefined)?.[key],next=(after.scene.rendering as Record<string,unknown>|undefined)?.[key];
  if(JSON.stringify(previous)!==JSON.stringify(next)){if(next===undefined)return{mode:'rebuild',reason:'Восстановление рендера'};rendering[key]=next;}
 }
 return{mode:'live',reason:'Без сброса физики',patch:{...(materials.length?{materials}:{}),...(Object.keys(rendering).length?{rendering}:{})},...(JSON.stringify(before.scene.camera)!==JSON.stringify(after.scene.camera)?{camera:after.scene.camera}:{})};
}
export function applyLiveProgram(scene:Scene,before:SceneProgram,after:SceneProgram,edit:ProgramEdit):void{
 if(edit.mode!=='live')throw new TypeError('A structural edit needs a fresh Scene');
 if(edit.patch)scene.patchAppearance(edit.patch);
 if(edit.camera)scene.setCamera(edit.camera);
 const vehicles=programVehicles(scene);
 for(let i=0;i<after.vehicles.length;i++){
  const next=after.vehicles[i]!,previous=before.vehicles[i]!,handle=vehicles.get(next.blueprint.source.id);
  if(!handle)throw new TypeError('Missing live vehicle');
  if(JSON.stringify(next.controls)!==JSON.stringify(previous.controls)){
   const controls:Record<string,number>={};for(const key of new Set([...Object.keys(previous.controls),...Object.keys(next.controls)])){
    const old=(previous.controls as Record<string,number>)[key],value=(next.controls as Record<string,number>)[key];
    if(old!==value)controls[key]=value??0;
   }handle.vehicle.setControls(controls);
  }
  if(next.air&&JSON.stringify(next.air)!==JSON.stringify(previous.air))handle.vehicle.setAir(next.air);
 }
 reviseProgram(scene,after);
}
