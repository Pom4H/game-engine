import {Scene,type RuntimeEntity} from '../../scene/scene.js';
import {WebGPURenderer} from '../../render/webgpu.js';
import {humanoid} from '../../dsl/index.js';
import {sampleWalker,bindHumanoid,type WalkerSpec} from '../../animation/locomotion.js';
import {ChunkWindow,type ChunkTicket} from '../../runtime/chunk-window.js';
import {PreparedMesh} from '../../procedural/prepared-mesh.js';
import {WorkBudget} from '../../core/work-budget.js';
import type {Sample} from '../../network/playback.js';
import type {CharacterState} from '../../runtime/character-motor.js';
import {OpenWorld,cityLamps} from './world.js';
import type {ThegameConfig} from './session.js';
import type {PreparedScenery} from './geometry.js';
interface Prepared {parts:readonly {spec:PreparedScenery['spec'];mesh:PreparedMesh}[];cursor:number;lightCursor:number;installed:RuntimeEntity[]}
interface Actor {rig:WalkerSpec;entities:RuntimeEntity[];release:()=>void;stamp:string}
/** Passive projection. Preparation, upload, publication and rendering have different
 * ownership boundaries. A delayed producer cannot force work into an input/frame tick. */
export class ThegameView {
 readonly scene:Scene;readonly chunks:ChunkWindow<Prepared>;readonly actors=new Map<string,Actor>();
 private worker:Worker;private originX=0;private originZ=0;private disposed=false;
 private readonly admission=new WorkBudget(128*1024,8,1);
 private readonly activeActors=new Set<string>();
 private readonly presentation={frameId:0,time:0,self:{x:0,y:0,z:0},camera:{position:[0,0,0],target:[0,0,0]}};
 readonly stats={frames:0,rebases:0,chunkPreparationMs:0,maxChunkAdmissionMs:0,maxAdmissionBytes:0,maxAdmissionOperations:0,admissionDeferrals:0,expandedMeshes:0};error='';radius:number;
 constructor(readonly renderer:WebGPURenderer,readonly world:OpenWorld,config:ThegameConfig){
  this.radius=config.viewRadius;
  this.scene=new Scene({version:1,seed:config.seed,environment:{temperatureC:5,sunlight:.06,humidity:.94,groundMoisture:.72,precipitation:'occasional',snowfall:'none'},rendering:{sunDirection:[-.58,.20,-.32],sunIntensity:.12,sunColor:[.62,.65,.70],skyColor:[.050,.052,.056],fogDensity:.019,shadowExtent:95,exposure:config.exposure},entities:[]});
  this.chunks=new ChunkWindow((_,value)=>{
   for(const entity of value.installed)this.scene.remove(entity.id);
   for(const part of value.parts)this.renderer.releasePreparedMesh(part.mesh);
  });
  this.worker=new Worker(new URL('./chunk-worker.js',import.meta.url),{type:'module'});
  this.worker.onmessage=({data}:{data:{ticket:ChunkTicket;parts:PreparedScenery[];ms:number;error?:string}})=>{
   if(this.disposed)return;
   try{
    if(data.error)throw new Error(data.error);
    if(!Array.isArray(data.parts)||data.parts.length<1||data.parts.length>10)throw new Error('Invalid chunk transfer');
    const parts=data.parts.map(part=>({spec:part.spec,mesh:new PreparedMesh(part.mesh)}));
    if(parts.reduce((n,p)=>n+p.mesh.byteLength,0)>8*1024*1024)throw new Error('Chunk transfer exceeds 8 MiB');
    this.stats.chunkPreparationMs+=data.ms;this.chunks.prepared(data.ticket,{parts,cursor:0,lightCursor:0,installed:[]});
   }catch(error){this.error=String(error);}
  };
  this.worker.onerror=event=>{this.error=event.message;};
 }
 configure(config:ThegameConfig):void{this.radius=config.viewRadius;this.scene.patchAppearance({rendering:{exposure:config.exposure}});}
 private actor(id:string,kind:number):Actor{
  let actor=this.actors.get(id);if(actor)return actor;
  const figure=humanoid('actor:'+id,{root:[0,0,0],speed:0,heightScale:1.1}),entities=figure.entities.map(spec=>this.scene.add({...spec,material:{...spec.material,color:spec.id.endsWith('head')?[.74,.51,.35,1]:spec.id.includes('shin')||spec.id.includes('thigh')?[.16,.23,.26,1]:kind===1?[.71,.54,.27,1]:[.20,.52,.66,1]}}));
  actor={rig:figure.rig,entities,release:this.scene.trackPresentation(entities.map(e=>e.id)),stamp:''};this.actors.set(id,actor);return actor;
 }
 private pose(id:string,x:number,y:number,z:number,yaw:number,phase:number,speed:number,kind:number):void{
  const actor=this.actor(id,kind),stamp=[x,y,z,yaw,phase,speed,this.originX,this.originZ].join(':');
  if(stamp===actor.stamp)return;actor.stamp=stamp;
  const heading=yaw-Math.PI/2,walk=Math.min(2,Math.max(0,speed)),period=walk>.01?Math.min(1.3,1.16*1.1/walk):1.3,time=phase/(Math.PI*2)*period,travel=walk*time;
  const pose=sampleWalker({...actor.rig,root:[x-this.originX-Math.cos(heading)*travel,y,z-this.originZ+Math.sin(heading)*travel],heading,speed:walk,period},time);
  for(const transform of bindHumanoid(pose,actor.rig.bindings??[])){const entity=this.scene.entities.get(transform.entity)!;for(let i=0;i<3;i++){entity.position[i]=transform.position[i]!;entity.rotation[i]=transform.rotation[i]!;entity.scale[i]=transform.scale[i]!;}}
 }
 private admit(ticket:ChunkTicket,value:Prepared):boolean{
  if(!this.renderer.submissionAvailable)return false;
  while(value.cursor<value.parts.length){
   const part=value.parts[value.cursor]!;
   if(!this.renderer.prepareMesh(part.mesh,this.admission)||!this.admission.claim())return false;
   const p=part.spec.position??[0,0,0];
   const entity=this.scene.addPrepared({...part.spec,position:[ticket.x*128-this.originX+p[0],p[1],ticket.z*128-this.originZ+p[2]]},part.mesh);
   // Staging is not visible to rendering, probes, picking or gameplay. GPU data is
   // fully prepared first; a complete chunk becomes visible in one bounded commit.
   entity.presentationVisible=false;value.installed.push(entity);value.cursor++;
  }
  const lamps=cityLamps(ticket.x,ticket.z);
  while(value.lightCursor<lamps.length){
   if(!this.admission.claim())return false;
   const lamp=lamps[value.lightCursor++]!;
   const entity=this.scene.add({id:`chunk:${ticket.key}/${lamp.id}`,collision:'none',position:[lamp.x-this.originX,lamp.y,lamp.z-this.originZ],light:{kind:'point',color:[1,.68,.36],intensity:22,range:18}});
   entity.presentationVisible=false;value.installed.push(entity);
  }
  if(!this.admission.claim())return false;
  for(const entity of value.installed)entity.presentationVisible=true;
  for(const part of value.parts){this.renderer.publishPreparedMesh(part.mesh);if(part.mesh.expanded)this.stats.expandedMeshes++;}
  this.scene.renderStructureRevision++;return true;
 }
 /** Rebase only transforms. Chunk geometry buffers and authoritative positions survive. */
 frame(self:CharacterState,remote:Sample|undefined,yaw:number,pitch:number,now:number,draw=true):void{
  if(this.disposed)return;const cx=Math.floor(self.x/128),cz=Math.floor(self.z/128),ox=cx*128,oz=cz*128;
  if(ox!==this.originX||oz!==this.originZ){const dx=this.originX-ox,dz=this.originZ-oz;for(const entity of this.scene.entities.values()){entity.position[0]+=dx;entity.position[2]+=dz;}this.originX=ox;this.originZ=oz;this.scene.renderStructureRevision++;this.scene.cutPresentation();this.stats.rebases++;}
  this.chunks.want(cx,cz,this.radius);
  const start=performance.now();this.admission.begin();
  try{const hadReady=this.chunks.inspect().ready;if(hadReady&&!this.chunks.admit((ticket,value)=>this.admit(ticket,value)))this.stats.admissionDeferrals++;}
  catch(error){this.error=String(error);this.chunks.dispose();return;}
  finally{this.admission.finish();this.stats.maxChunkAdmissionMs=Math.max(this.stats.maxChunkAdmissionMs,performance.now()-start);this.stats.maxAdmissionBytes=Math.max(this.stats.maxAdmissionBytes,this.admission.bytes);this.stats.maxAdmissionOperations=Math.max(this.stats.maxAdmissionOperations,this.admission.operations);}
  const ticket=this.chunks.next();if(ticket)this.worker.postMessage({seed:this.world.seed,ticket});
  this.pose('self',self.x,self.y,self.z,self.yaw,self.phase,self.speed,0);this.activeActors.clear();this.activeActors.add('self');
  for(const row of remote?.rows??[]){const v=row.values;this.activeActors.add(row.id);this.pose(row.id,v[0]!,v[1]!,v[2]!,v[3]!,v[4]!,v[5]!,v[6]!);}
  for(const [id,actor] of this.actors)if(!this.activeActors.has(id)){actor.release();for(const e of actor.entities)this.scene.remove(e.id);this.actors.delete(id);}
  const target:[number,number,number]=[self.x-this.originX,self.y+1.3,self.z-this.originZ],distance=6.5,dx=-Math.sin(yaw)*Math.cos(pitch),dz=-Math.cos(yaw)*Math.cos(pitch),dy=Math.sin(pitch);let reach=distance;
  for(let d=.6;d<=distance;d+=.3){const x=self.x+dx*d,y=self.y+1.3+dy*d,z=self.z+dz*d;if(this.world.blocked(x,y,z,.2,.15)||this.world.ground(x,z).y+.2>y){reach=Math.max(.5,d-.3);break;}}
  this.scene.camera={position:[target[0]+dx*reach,target[1]+dy*reach,target[2]+dz*reach],target,fov:62,aperture:0,focusDistance:reach};this.scene.time=remote?.time??now/1000;
  if(draw&&this.renderer.render(this.scene)){
   this.stats.frames++;this.presentation.frameId=this.stats.frames;this.presentation.time=this.scene.time;
   this.presentation.self.x=self.x;this.presentation.self.y=self.y;this.presentation.self.z=self.z;
   for(let i=0;i<3;i++){this.presentation.camera.position[i]=this.scene.camera.position[i]!;this.presentation.camera.target[i]=target[i]!;}
  }
 }
 get ready():boolean{return this.chunks.inspect().resident>=9&&this.renderer.environmentReady;}
 inspect(detailed=false){return {...this.stats,chunks:this.chunks.inspect(),admission:{maxBytes:this.admission.maxBytes,maxOperations:this.admission.maxOperations,deadlineMs:this.admission.milliseconds,overruns:this.admission.overruns},submission:this.renderer.throughput(),presented:{...this.presentation,self:{...this.presentation.self},camera:{position:[...this.presentation.camera.position],target:[...this.presentation.camera.target]}},actors:this.actors.size,origin:[this.originX,this.originZ],clientPhysicsSteps:this.scene.tick,clientBodies:this.scene.physics.bodies.size,renderer:this.renderer.inspect(detailed),error:this.error||this.renderer.throughput().error};}
 dispose():void{if(this.disposed)return;this.disposed=true;this.worker.terminate();this.chunks.dispose();for(const a of this.actors.values())a.release();this.actors.clear();this.scene.dispose();this.renderer.dispose();}
}
