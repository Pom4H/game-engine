/** Public program installer. The browser editor, headless tests and game clients share it. */
import type {Scene} from '../scene/scene.js';
import {spawnVehicle,type SceneVehicle} from '../vehicles/scene-vehicle.js';
import {validateProgram,type SceneProgram} from './index.js';
const mounted=new WeakMap<Scene,Map<string,SceneVehicle>>();
const live=new WeakMap<Scene,{program:SceneProgram;origin:readonly number[]|undefined}>();
export function programVehicles(scene:Scene):ReadonlyMap<string,SceneVehicle>{return mounted.get(scene)??new Map();}
/** Install once into a Scene. Scene owns mass, force drivers, projections and disposal. */
export function installProgram(scene:Scene,program:SceneProgram):void{
 validateProgram(program);
 if(mounted.has(scene))throw new TypeError('Program already installed');
 const vehicles=new Map<string,SceneVehicle>();mounted.set(scene,vehicles);
 const state={program,origin:undefined as readonly number[]|undefined};live.set(scene,state);
 try{
  for(const definition of program.vehicles){
   const handle=spawnVehicle(scene,definition.blueprint,definition.geometry,definition.options);
   const id=definition.blueprint.source.id;vehicles.set(id,handle);
   handle.vehicle.setControls(definition.controls);
   if(definition.air)handle.vehicle.setAir(definition.air);
   let next=0;
   const apply=()=>{while(next<definition.timeline.length&&definition.timeline[next]!.atSeconds<=scene.time+1e-9)handle.vehicle.setControls(definition.timeline[next++]!.value);};
   apply();
   if(definition.timeline.length)scene.project({ownerId:id,visualIds:[],sync:apply,dispose:()=>{vehicles.delete(id);}});
  }
  if(program.follow){state.origin=[...vehicles.get(program.follow)!.vehicle.body.position];scene.project({ownerId:program.follow,visualIds:[],sync:()=>syncProgram(scene),dispose:()=>live.delete(scene)});}
 }catch(error){for(const handle of vehicles.values())handle.dispose();mounted.delete(scene);throw error;}
}

/** Update authoring references without reconstructing force drivers. */
export function reviseProgram(scene:Scene,program:SceneProgram):void{const state=live.get(scene);if(state)state.program=program;syncProgram(scene);}
/** Camera follows the real body. No pose is written back into initial DSL parameters. */
export function syncProgram(scene:Scene):void{
 const state=live.get(scene),program=state?.program;if(!program?.follow||!state?.origin)return;
 const body=mounted.get(scene)?.get(program.follow)?.vehicle.body,camera=program.scene.camera;if(!body||!camera)return;
 const delta=body.position.map((v,k)=>v-state.origin![k]!);
 scene.setCamera({...camera,position:camera.position.map((v,k)=>v+delta[k]!) as [number,number,number],target:camera.target.map((v,k)=>v+delta[k]!) as [number,number,number]});
}
