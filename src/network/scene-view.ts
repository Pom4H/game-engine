import type {Scene,RuntimeEntity} from '../scene/scene.js';
import type {SceneSpec,EntitySpec} from '../scene/types.js';
import {projection,vector3,type Stamp} from './projection.js';
import type {Sample} from './playback.js';
/** The first built-in projection. No meshes, force buffers, private resources or camera on wire. */
export const sceneMotion=projection('scene-motion/v1',{position:vector3(),rotation:vector3('angle'),scale:vector3('linear',0,1e6)});
export function captureSceneMotion(scene:Scene,at:Stamp){
 const sources=[];for(const id of scene.renderMoverIds()){const e=scene.entities.get(id);if(e)sources.push({id:e.id,data:e});}return sceneMotion.capture(at,sources);
}
/** Build once on installation, not once per packet. It deliberately contains no physical bodies. */
export function presentationScene(scene:Scene):SceneSpec{
 const entities:EntitySpec[]=Array.from(scene.entities.values(),e=>{
  const {profile:_,surface:__,...material}=e.material;
  return{id:e.id,position:[...e.position],rotation:[...e.rotation],scale:[...e.scale],collision:'none',
   ...(e.mesh?{mesh:e.mesh}:{}),...(e.renderMesh?{renderMesh:e.renderMesh}:{}),...(e.light?{light:e.light}:{}),material};
 });
 return{version:1,entities,camera:scene.camera,...(scene.spec.rendering?{rendering:scene.spec.rendering}:{}),...(scene.spec.environment?{environment:scene.spec.environment}:{}),...(scene.spec.clearColor?{clearColor:scene.spec.clearColor}:{})};
}
/** Only writes presentation transforms; never creates geometry or runs physics on packet arrival. */
export class SceneReplicaView{
 private readonly owned=new Map<string,RuntimeEntity>();private readonly release:()=>void;
 readonly stats={applied:0,unknown:0};
 constructor(readonly scene:Scene,ids:readonly string[]=[...scene.entities.keys()]){
  for(const id of ids){const e=scene.entities.get(id);if(!e||e.body)throw new TypeError('A replica view requires known non-physical entities');this.owned.set(e.id,e);}
  this.release=scene.trackPresentation([...this.owned.keys()]);
 }
 apply(frame:Sample):void{
  for(const e of this.owned.values())e.presentationVisible=false;
  for(const row of frame.rows){const e=this.owned.get(row.id);if(!e||this.scene.entities.get(row.id)!==e){this.stats.unknown++;continue;}
   e.presentationVisible=true;const v=row.values;for(let k=0;k<3;k++){e.position[k]=v[k]!;e.rotation[k]=v[3+k]!;e.scale[k]=v[6+k]!;}this.stats.applied++;
  }
  this.scene.time=frame.time;this.scene.tick=frame.fromTick;
 }
 dispose():void{this.release();for(const e of this.owned.values())delete e.presentationVisible;this.owned.clear();}
}
