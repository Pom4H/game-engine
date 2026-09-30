import {Scene,type RuntimeEntity} from '../../scene/scene.js';
import {WebGPURenderer} from '../../render/webgpu.js';
import {humanoid} from '../../dsl/index.js';
import {sampleWalker,bindHumanoid,type WalkerSpec} from '../../animation/locomotion.js';
import {ChunkWindow,type ChunkTicket} from '../../runtime/chunk-window.js';
import type {EntitySpec} from '../../scene/types.js';
import type {Sample} from '../../network/playback.js';
import type {CharacterState} from '../../runtime/character-motor.js';
import {OpenWorld} from './world.js';
import type {ThegameConfig} from './session.js';
interface Prepared {entities:readonly EntitySpec[];installed?:string[]}
interface Actor {rig:WalkerSpec;entities:RuntimeEntity[];release:()=>void}
/** A passive projection onto the existing Scene/WebGPU/IK. No world stepping here. */
export class ThegameView {
 readonly scene:Scene;readonly chunks:ChunkWindow<Prepared>;readonly actors=new Map<string,Actor>();
 private worker:Worker;private originX=0;private originZ=0;private disposed=false;private first=true;
 readonly stats={frames:0,rebases:0,chunkPreparationMs:0,maxChunkAdmissionMs:0};error='';radius:number;
 constructor(readonly renderer:WebGPURenderer,readonly world:OpenWorld,config:ThegameConfig){
  this.radius=config.viewRadius;
  this.scene=new Scene({version:1,seed:config.seed,environment:{temperatureC:20,sunlight:1,humidity:0,groundMoisture:0,precipitation:'arid',snowfall:'none'},rendering:{sunDirection:[-.5,.8,-.3],sunIntensity:2.3,sunColor:[1,.91,.75],skyColor:[.45,.62,.73],fogDensity:.003,shadowExtent:95,exposure:config.exposure},entities:[]});
  this.chunks=new ChunkWindow((_,value)=>{for(const id of value.installed??[])this.scene.remove(id);});
  this.worker=new Worker(new URL('./chunk-worker.js',import.meta.url),{type:'module'});
  this.worker.onmessage=({data}:{data:{ticket:ChunkTicket;entities:EntitySpec[];ms:number;error?:string}})=>{if(this.disposed)return;if(data.error){this.error=data.error;return;}this.stats.chunkPreparationMs+=data.ms;this.chunks.prepared(data.ticket,{entities:data.entities});};
  this.worker.onerror=event=>{this.error=event.message;};
 }
 configure(config:ThegameConfig):void{this.radius=config.viewRadius;this.scene.patchAppearance({rendering:{exposure:config.exposure}});}
 private actor(id:string,kind:number):Actor{
  let actor=this.actors.get(id);if(actor)return actor;
  const figure=humanoid('actor:'+id,{root:[0,0,0],speed:0,heightScale:1.1}),entities=figure.entities.map(spec=>this.scene.add({...spec,material:{...spec.material,color:spec.id.endsWith('head')?[.74,.51,.35,1]:spec.id.includes('shin')||spec.id.includes('thigh')?[.16,.23,.26,1]:kind===1?[.71,.54,.27,1]:[.20,.52,.66,1]}}));
  actor={rig:figure.rig,entities,release:this.scene.trackPresentation(entities.map(e=>e.id))};this.actors.set(id,actor);return actor;
 }
 private pose(id:string,x:number,y:number,z:number,yaw:number,phase:number,speed:number,kind:number):void{
  const actor=this.actor(id,kind),heading=yaw-Math.PI/2,walk=Math.min(2,Math.max(0,speed)),period=walk>.01?Math.min(1.3,1.16*1.1/walk):1.3,time=phase/(Math.PI*2)*period,travel=walk*time;
  const pose=sampleWalker({...actor.rig,root:[x-this.originX-Math.cos(heading)*travel,y,z-this.originZ+Math.sin(heading)*travel],heading,speed:walk,period},time);
  for(const transform of bindHumanoid(pose,actor.rig.bindings??[])){const entity=this.scene.entities.get(transform.entity)!;entity.position=[...transform.position];entity.rotation=[...transform.rotation];entity.scale=[...transform.scale];}
 }
 /** Rebase only transforms. Chunk geometry objects/buffers and authoritative positions survive. */
 frame(self:CharacterState,remote:Sample|undefined,yaw:number,pitch:number,now:number,draw=true):void{
  if(this.disposed)return;const cx=Math.floor(self.x/128),cz=Math.floor(self.z/128),ox=cx*128,oz=cz*128;
  if(ox!==this.originX||oz!==this.originZ){const dx=this.originX-ox,dz=this.originZ-oz;for(const entity of this.scene.entities.values()){entity.position[0]+=dx;entity.position[2]+=dz;}this.originX=ox;this.originZ=oz;this.scene.renderStructureRevision++;this.scene.cutPresentation();this.stats.rebases++;}
  this.chunks.want(cx,cz,this.radius);const start=performance.now();this.chunks.admit((ticket,value)=>{const added:string[]=[];try{for(const spec of value.entities){const p=spec.position??[0,0,0];this.scene.add({...spec,position:[ticket.x*128-this.originX+p[0],p[1],ticket.z*128-this.originZ+p[2]]});added.push(spec.id);}value.installed=added;}catch(error){for(const id of added)this.scene.remove(id);throw error;}});this.stats.maxChunkAdmissionMs=Math.max(this.stats.maxChunkAdmissionMs,performance.now()-start);
  const ticket=this.chunks.next();if(ticket)this.worker.postMessage({seed:this.world.seed,ticket});
  this.pose('self',self.x,self.y,self.z,self.yaw,self.phase,self.speed,0);const active=new Set(['self']);
  for(const row of remote?.rows??[]){const v=row.values;active.add(row.id);this.pose(row.id,v[0]!,v[1]!,v[2]!,v[3]!,v[4]!,v[5]!,v[6]!);}
  for(const [id,actor] of this.actors)if(!active.has(id)){actor.release();for(const e of actor.entities)this.scene.remove(e.id);this.actors.delete(id);}
  const target:[number,number,number]=[self.x-this.originX,self.y+1.3,self.z-this.originZ],distance=6.5,dx=-Math.sin(yaw)*Math.cos(pitch),dz=-Math.cos(yaw)*Math.cos(pitch),dy=Math.sin(pitch);let reach=distance;
  for(let d=.6;d<=distance;d+=.3){const x=self.x+dx*d,y=self.y+1.3+dy*d,z=self.z+dz*d;if(this.world.blocked(x,y,z,.2,.15)||this.world.ground(x,z).y+.2>y){reach=Math.max(.5,d-.3);break;}}
  this.scene.camera={position:[target[0]+dx*reach,target[1]+dy*reach,target[2]+dz*reach],target,fov:62,aperture:0,focusDistance:reach};this.scene.time=remote?.time??now/1000;
  if(draw){this.renderer.render(this.scene);this.stats.frames++;if(this.first){this.first=false;this.renderer.resetProfile();}}
 }
 get ready():boolean{return this.chunks.inspect().resident>=9;}
 inspect(){return {...this.stats,chunks:this.chunks.inspect(),actors:this.actors.size,origin:[this.originX,this.originZ],clientPhysicsSteps:this.scene.tick,clientBodies:this.scene.physics.bodies.size,renderer:this.renderer.inspect(),error:this.error};}
 dispose():void{this.disposed=true;this.worker.terminate();this.chunks.dispose();for(const a of this.actors.values())a.release();this.actors.clear();this.scene.dispose();this.renderer.dispose();}
}
