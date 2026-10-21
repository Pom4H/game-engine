import {isOwnedValidatedTriangleMesh} from '../procedural/mesh.js';
import {material} from '../materials/catalog.js';
import {deriveSurfaceState} from '../materials/surface.js';
import type {EnvironmentState} from '../environment/types.js';
import type {RuntimeEntity,RuntimeMaterial} from './scene.js';
import type {EntitySpec,MaterialSpec} from './types.js';
import {validateEntity} from './validate.js';

/** Explicit cold projection input. Physical/surface/light registration remains
 * on Scene.add; only fully validated, identity-owned meshes are accepted here. */
export type PreparedRenderEntitySpec=Omit<EntitySpec,'body'|'environmental'|'light'|'visualOnly'|'renderOnly'> & {renderOnly:true};
export type PreparedRenderEntityUpdate=Pick<EntitySpec,'position'|'rotation'|'scale'|'material'>;
export interface RenderEntityPreparation {
 readonly entity:RuntimeEntity;
 /** Recompute the same authored surface under the current Scene environment.
  * Detached position/rotation/scale can be updated before GPU publication. */
 refresh(update?:PreparedRenderEntityUpdate):void;
 /** Publish this canonical ID. The caller removes a replacement first, exactly
  * as with Scene.add. No geometry validation, clone or GPU work occurs here. */
 adopt():RuntimeEntity;
 /** Discard detached ownership; an adopted entity remains owned by the Scene. */
 dispose():void;
}
interface Owner {environment():EnvironmentState;adopt(entity:RuntimeEntity):void}
const preparedEntities=new WeakSet<object>();
const preparedAdd=Function.call.bind(WeakSet.prototype.add) as (set:WeakSet<object>,value:object)=>void;
const preparedHas=Function.call.bind(WeakSet.prototype.has) as (set:WeakSet<object>,value:object)=>boolean;
/** Internal identity proof for the GPU cold path, never a validation shortcut
 * for ordinary Scene.add or public arbitrary RuntimeEntity objects. */
export function isPreparedRenderEntity(value:RuntimeEntity):boolean{return preparedHas(preparedEntities,value);}
const scalarMaterial=['groundCover','variationSeed','label','roughness','metalness','clearcoat','clearcoatRoughness','pattern','kind','finish','ageYears','treatment'] as const;
const nestedMaterial={facade:['kind','night'],groundLitter:['kind','baseRoughness'],rainResponse:['kind','mirrorX'],decal:['kind','severity','seed'],texture:['projection','url','normalUrl','ormUrl','heightUrl','heightScaleM','sizeM','bumpStrength','albedoStrength','normalStrength','ormStrength']} as const;
function record(value:unknown):Record<string,unknown>{if(!value||typeof value!=='object'||Array.isArray(value))throw new TypeError('Prepared entity records must be objects');return value as Record<string,unknown>;}
function scalar(value:unknown):unknown{if(typeof value==='object'&&value!==null||typeof value==='function'||typeof value==='symbol'||typeof value==='bigint'||typeof value==='string'&&value.length>8192)throw new TypeError('Prepared entity scalar exceeds the bounded schema');return value;}
function vector(value:unknown,length:number):number[]{if(!Array.isArray(value)||value.length!==length)throw new TypeError('Prepared entity vector has an invalid length');const result:number[]=[];for(let i=0;i<length;i++){const n=value[i];if(typeof n!=='number'||!Number.isFinite(n))throw new TypeError('Prepared entity vector must be finite');result.push(n);}return result;}
function fields(value:unknown,names:readonly string[]):Record<string,unknown>{const source=record(value),out:Record<string,unknown>={};for(const name of names){const v=source[name];if(v!==undefined)out[name]=scalar(v);}return out;}
function snapshotMaterial(value:unknown):MaterialSpec{
 const source=record(value),out=fields(source,scalarMaterial);
 for(const [key,names] of Object.entries(nestedMaterial)){const v=source[key];if(v!==undefined)out[key]=fields(v,names);}
 for(const [key,length] of [['color',4],['emissive',3],['labelColor',3]] as const){const v=source[key];if(v!==undefined)out[key]=vector(v,length);}
 const appearance=source.surfaceAppearance;if(appearance!==undefined){const copy=fields(appearance,['wetness','darkening']),snow=record(appearance).snow;if(snow!==undefined)copy.snow=fields(snow,['snowDepthM','waterDepthM','iceDepthM','slush','freshness','liquidFraction','crust','grainSizeMm']);out.surfaceAppearance=copy;}
 return out as MaterialSpec;
}
function runtimeMaterial(spec:MaterialSpec|undefined,environment:EnvironmentState):RuntimeMaterial{
 const profile=material(spec?.kind??'default'),surface=deriveSurfaceState(profile,spec??{},environment);
 return Object.freeze({...spec,...(spec?.facade?{facade:Object.freeze({...spec.facade})}:{}),...(spec?.groundLitter?{groundLitter:Object.freeze({...spec.groundLitter})}:{}),...(spec?.rainResponse?{rainResponse:Object.freeze({...spec.rainResponse})}:{}),...(spec?.surfaceAppearance?{surfaceAppearance:Object.freeze({...spec.surfaceAppearance,...(spec.surfaceAppearance.snow?{snow:Object.freeze({...spec.surfaceAppearance.snow})}:{})})}:{}),...(spec?.decal?{decal:Object.freeze({...spec.decal})}:{}),...(spec?.texture?{texture:Object.freeze({...spec.texture})}:{}),kind:profile.kind,color:spec?.color??profile.color,profile,surface});
}
/** Work and retained data are bounded by this fixed schema: at most four 8192
 * character asset URLs, fixed material records/vectors, and two owned identities.
 * Unknown metadata is deliberately outside this new API's snapshot contract.
 * Public getters can execute user code, as in Scene.add; their execution time is
 * not claimed to be bounded. The ordinary Scene.add contract is unchanged. */
export function createRenderEntityPreparation(input:PreparedRenderEntitySpec,initialOwner:Owner):RenderEntityPreparation{
 let owner:Owner|undefined=initialOwner;
 const source=record(input);
 if(source.renderOnly!==true||source.body!==undefined||source.environmental!==undefined||source.light!==undefined||source.visualOnly!==undefined)throw new TypeError('Prepared entities require renderOnly without physical, surface or light state');
 const id=scalar(source.id),mesh=source.mesh,renderMesh=source.renderMesh;
 if((mesh===undefined&&renderMesh===undefined)||(mesh!==undefined&&!isOwnedValidatedTriangleMesh(mesh))||(renderMesh!==undefined&&!isOwnedValidatedTriangleMesh(renderMesh)))throw new TypeError('Prepared entities require owned validated triangle geometry');
 const spec:Record<string,unknown>={id,renderOnly:true,...(mesh!==undefined?{mesh}:{}),...(renderMesh!==undefined?{renderMesh}:{})};
 for(const key of ['position','rotation','scale'] as const){const v=source[key];if(v!==undefined)spec[key]=vector(v,3);}
 for(const key of ['renderVisible','renderCameraVisible'] as const){const v=source[key];if(v!==undefined)spec[key]=scalar(v);}
 if(source.material!==undefined)spec.material=snapshotMaterial(source.material);
 const checked=validateEntity(spec,false);
 let entity:RuntimeEntity|undefined={id:checked.id,position:[...(checked.position??[0,0,0])],rotation:[...(checked.rotation??[0,0,0])],scale:[...(checked.scale??[1,1,1])],renderOnly:true,...(checked.renderVisible!==undefined?{renderVisible:checked.renderVisible}:{}),...(checked.renderCameraVisible!==undefined?{renderCameraVisible:checked.renderCameraVisible}:{}),material:runtimeMaterial(checked.material,owner.environment()),...(checked.mesh?{mesh:checked.mesh}:{}),...(checked.renderMesh?{renderMesh:checked.renderMesh}:{})};
 let adopted=false;
 preparedAdd(preparedEntities,entity);
 const current=()=>{if(!entity)throw new Error('Entity preparation was disposed');return entity;};
 return {
  get entity(){return current();},
  refresh(update={}){
   if(adopted)throw new Error('Entity preparation is already adopted');const e=current(),copy:Record<string,unknown>={id:e.id,renderOnly:true};
   for(const key of ['position','rotation','scale'] as const){const v=update[key];if(v!==undefined)copy[key]=vector(v,3);}
   if(update.material!==undefined)copy.material=snapshotMaterial(update.material);
   const checked=validateEntity(copy,false),nextMaterial=checked.material?runtimeMaterial(checked.material,owner!.environment()):Object.freeze({...e.material,surface:deriveSurfaceState(e.material.profile,e.material,owner!.environment())});
   // Every component is checked before any detached component is changed.
   for(const key of ['position','rotation','scale'] as const){const v=checked[key];if(v){e[key][0]=v[0];e[key][1]=v[1];e[key][2]=v[2];}}
   (e as {material:RuntimeMaterial}).material=nextMaterial;
  },
  adopt(){const e=current();if(!adopted){owner!.adopt(e);adopted=true;}return e;},
  // These are the only captured Scene/source roots. A retained disposed ticket
  // must not keep its Scene, original input, material or mesh snapshot alive.
  dispose(){entity=undefined;owner=undefined;},
 };
}
