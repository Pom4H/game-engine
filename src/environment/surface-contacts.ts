import {trackRuntimeMemory,trackRuntimeInstance} from '../core/runtime-memory.js';
import type {MutableVec3,Vec3} from '../math.js';
import type {RuntimeEntity} from '../scene/scene.js';
import type {EntitySpec,MaterialSpec} from '../scene/types.js';
import {SnowFootprints,type FootContact,type SnowFootprint} from './footprints.js';
import {SnowSurface,type SnowSurfaceOptions} from './snow-surface.js';
import type {SurfaceEnvironmentSystem,SurfaceEnvironmentState} from './surface-state.js';

export interface SurfaceContactHost {
 readonly entities:Map<string,RuntimeEntity>;
 readonly surfaces:SurfaceEnvironmentSystem;
 readonly resources:Map<string,unknown>;
 add(entity:EntitySpec):RuntimeEntity;
 remove(id:string):void;
}
export interface SurfaceSample {readonly surfaceId:string;readonly height:number;readonly snowDepth:number;readonly waterDepth:number}
export interface SurfaceFootprint extends SnowFootprint {readonly surfaceId:string}
export interface WheelSurfaceContact {
 readonly id:string;
 /** Position of the bottom of the tyre, in world metres. */
 readonly position:Vec3;
 readonly velocity:Vec3;
 readonly grounded:boolean;
 /** Contact radius in world metres when known. */
 readonly radius?:number;
 /** Wheel angular speed magnitude in rad/s when known. */
 readonly angularSpeed?:number;
 /** Unit direction away from the vehicle at this wheel. */
 readonly lateral?:Vec3;
}
export interface SnowContactSurfaceOptions {
 readonly tileSize?:number;readonly coarseCellSize?:number;readonly detailedCellSize?:number;
 readonly maxTiles?:number;readonly maxDetailedTiles?:number;readonly seed?:number;readonly material?:MaterialSpec;
}
export interface SurfaceContactsOptions {readonly capacity?:number;readonly particleCapacity?:number;readonly id?:string}
interface WheelBinding {readonly id:string;readonly radius?:number;readonly lateral?:Vec3}
interface SprayParticle {readonly index:number;readonly born:number;readonly life:number;readonly origin:Vec3;readonly velocity:Vec3;readonly ground:number}
interface SnowBinding {readonly source:string;readonly skin:SnowSurface;visible:boolean}
const contactNamespaces=trackRuntimeMemory('SurfaceContactSystem','namespaces','registry',new WeakMap<SurfaceContactHost,{sequence:number;reserved:Set<string}>());
function allocateNamespace(host:SurfaceContactHost,base:string):string{
 let state=contactNamespaces.get(host);if(!state){state={sequence:0,reserved:new Set()};contactNamespaces.set(host,state);}
 let candidate=base;
 while(state.reserved.has(candidate)||[...host.entities.keys()].some(id=>id===candidate||id.startsWith(candidate+':')))candidate=`${base}#${++state.sequence}`;
 state.reserved.add(candidate);return candidate;
}
const clamp=(value:number,low:number,high:number)=>Math.max(low,Math.min(high,value));
const finiteVec=(v:Vec3)=>v.length===3&&v.every(Number.isFinite);
function localXZ(entity:RuntimeEntity,x:number,z:number):readonly[number,number]{const c=Math.cos(entity.rotation[1]),s=Math.sin(entity.rotation[1]),dx=x-entity.position[0],dz=z-entity.position[2];return[(c*dx-s*dz)/entity.scale[0],(s*dx+c*dz)/entity.scale[2]];}
/** Environmental contact queries use the actual rotated polygon, never its
 * rectangular field allocation. A clipped puddle cannot wet tyres outside it. */
export function surfaceContains(entity:RuntimeEntity,x:number,z:number):boolean{
 if(Math.abs(entity.rotation[0])>1e-5||Math.abs(entity.rotation[2])>1e-5)return false;
 const [u,v]=localXZ(entity,x,z),mesh=entity.mesh;
 if(mesh?.kind==='box'||mesh?.kind==='shard')return Math.abs(u)<=(mesh.size?.[0]??1)/2&&Math.abs(v)<=(mesh.size?.[2]??1)/2;
 if(mesh?.kind==='plane')return Math.abs(u)<=(mesh.size?.[0]??1)/2&&Math.abs(v)<=(mesh.size?.[1]??1)/2;
 if(mesh?.kind==='polygon-prism'&&(mesh.axis??2)===1){let inside=false;for(let i=0,j=mesh.points.length-1;i<mesh.points.length;j=i++){const a=mesh.points[i]!,b=mesh.points[j]!;if((a[1]>v)!==(b[1]>v)&&u<(b[0]-a[0])*(v-a[1])/(b[1]-a[1])+a[0])inside=!inside;}return inside;}
 return false;
}
export function surfaceElevation(entity:RuntimeEntity):number{
 const mesh=entity.mesh;if(mesh?.kind==='box'||mesh?.kind==='shard')return entity.position[1]+(mesh.size?.[1]??1)*entity.scale[1]/2;
 if(mesh?.kind==='polygon-prism'&&(mesh.axis??2)===1)return entity.position[1]+mesh.thickness*entity.scale[1]/2;
 return entity.position[1];
}
function surfaceDimensions(entity:RuntimeEntity):readonly[number,number]{
 const mesh=entity.mesh;if(mesh?.kind==='box'||mesh?.kind==='shard')return[(mesh.size?.[0]??1)*entity.scale[0],(mesh.size?.[2]??1)*entity.scale[2]];
 if(mesh?.kind==='plane')return[(mesh.size?.[0]??1)*entity.scale[0],(mesh.size?.[1]??1)*entity.scale[2]];
 throw new TypeError('Deformable snow requires a horizontal box or plane surface');
}
/** Engine-owned surface contact integration. Scene calls step after animation and
 * physics; applications author surface/wheel bindings once. Rendering geometry,
 * persistent footprints, spray and sound records share these actual contacts. */
export class SurfaceContactSystem {
 readonly footprints:SnowFootprints;
 private readonly host:SurfaceContactHost;private readonly id:string;private readonly particleCapacity:number;
 private readonly surfaces=trackRuntimeMemory('SurfaceContactSystem','surfaces','registry',new Map<string,SnowBinding>());private readonly wheels=trackRuntimeMemory('SurfaceContactSystem','wheels','registry',new Map<string,WheelBinding>());
 private readonly particles=trackRuntimeMemory('SurfaceContactSystem','particles','pool',new Map<number,SprayParticle>());private readonly wheelEmission=trackRuntimeMemory('SurfaceContactSystem','wheelEmission','state',new Map<string,number>());
 private readonly events=trackRuntimeMemory('SurfaceContactSystem','events','queue',[] as SurfaceFootprint[]);private readonly particleIds=trackRuntimeMemory('SurfaceContactSystem','particleIds','registry',new Map<string,RuntimeEntity>());private readonly snowEntities=trackRuntimeMemory('SurfaceContactSystem','snowEntities','registry',new Map<string,RuntimeEntity>());
 private sequence=0;private surfaceSequence=0;private time=-Infinity;private wetnessValue=0;private emitted=0;
 constructor(host:SurfaceContactHost,options:SurfaceContactsOptions={}){
  trackRuntimeInstance('SurfaceContactSystem',this);this.host=host;const base=options.id??'__contacts';this.particleCapacity=options.particleCapacity??96;this.footprints=new SnowFootprints(options.capacity??256);
  if(!base||base.length>100||!Number.isSafeInteger(this.particleCapacity)||this.particleCapacity<1||this.particleCapacity>2048)throw new RangeError('Invalid surface contact budget');
  this.id=allocateNamespace(host,base);
 }
 get wetness(){return this.wetnessValue;}
 get sprayEmitted(){return this.emitted;}
 get emittedCount(){return this.emitted;}
 controlledEntityIds():ReadonlySet<string>{return new Set(this.particleIds.keys());}
 addSnowSurface(surfaceId:string,options:SnowContactSurfaceOptions={}):SnowSurface{
  if(this.surfaces.has(surfaceId))throw new TypeError(`Snow surface already registered: ${surfaceId}`);
  const entity=this.host.entities.get(surfaceId);if(!entity?.environmental?.surfaceUse)throw new TypeError(`No environmental surface: ${surfaceId}`);
  if(Math.abs(entity.rotation[0])>1e-5||Math.abs(entity.rotation[2])>1e-5)throw new TypeError('Deformable snow surface must be horizontal');
  const depth=this.host.surfaces.surface(surfaceId)?.snowDepthM??entity.environmental.snowDepthM??0;
  const snowMaterial=options.material??entity.environmental.snowMaterial;
  const spec:SnowSurfaceOptions={...options,...(snowMaterial?{material:snowMaterial}:{}),id:`${this.id}:snow:0`,center:[entity.position[0],entity.position[2]],size:surfaceDimensions(entity),yaw:entity.rotation[1],height:surfaceElevation(entity)+depth,snowDepth:depth,capacity:this.footprints.capacity};
  let skin:SnowSurface;do{skin=new SnowSurface({...spec,id:`${this.id}:snow:${this.surfaceSequence++}`});}while(skin.ids().some(id=>this.host.entities.has(id)));
  const binding={source:surfaceId,skin,visible:depth>.002};this.surfaces.set(surfaceId,binding);
  if(binding.visible)this.applyMeshes(skin);return skin;
 }
 removeSnowSurface(surfaceId:string):void{const binding=this.surfaces.get(surfaceId);if(!binding)return;this.surfaces.delete(surfaceId);for(const id of binding.skin.ids()){const owned=this.snowEntities.get(id);if(owned&&this.host.entities.get(id)===owned)this.host.remove(id);this.snowEntities.delete(id);}}
 /** Scene.remove uses this hook; regenerated snow tile IDs do not match source
  * bindings, so recursive cleanup does not unregister the original surface. */
 onEntityRemoved(id:string):void{
  this.removeWheelContact(id);this.removeSnowSurface(id);this.snowEntities.delete(id);
  if(this.particleIds.delete(id))for(const [index] of this.particles)if(id===`${this.id}:spray:${index}`)this.particles.delete(index);
 }
 addWheelContact(entityId:string,options:{readonly radius?:number;readonly lateral?:Vec3}={}):void{
  if(!this.host.entities.get(entityId)?.body||this.wheels.has(entityId)||options.radius!==undefined&&(!Number.isFinite(options.radius)||options.radius<=0)||options.lateral&&!finiteVec(options.lateral))throw new TypeError('Invalid wheel contact binding');
  this.wheels.set(entityId,{id:entityId,...options,...(options.lateral?{lateral:Object.freeze([...options.lateral]) as Vec3}:{})});
  this.host.surfaces.claimContactBody(entityId);
 }
 removeWheelContact(entityId:string):void{this.wheels.delete(entityId);this.wheelEmission.delete(entityId);this.host.surfaces.releaseContactBody(entityId);}
 private state(entity:RuntimeEntity,x:number,z:number):Pick<SurfaceEnvironmentState,'snowDepthM'|'waterDepthM'>{
  return this.host.surfaces.sample(entity.id,x,z)??this.host.surfaces.surface(entity.id)??{snowDepthM:entity.environmental?.snowDepthM??0,waterDepthM:entity.environmental?.waterDepthM??0};
 }
 /** Highest accessible surface. This is also the engine's foot-placement query. */
 sample(position:Vec3):SurfaceSample|undefined{
  if(!finiteVec(position))throw new TypeError('Invalid surface sample position');let best:SurfaceSample|undefined;
  for(const entity of this.host.entities.values()){
   if(!entity.environmental?.surfaceUse||!surfaceContains(entity,position[0],position[2]))continue;
   const state=this.state(entity,position[0],position[2]),skin=this.surfaces.get(entity.id)?.skin,height=skin?.sample(position[0],position[2])??surfaceElevation(entity)+state.snowDepthM;
   if(height>position[1]+.35||height<position[1]-1.0)continue;
   if(!best||height>best.height)best={surfaceId:entity.id,height,snowDepth:state.snowDepthM,waterDepth:state.waterDepthM};
  }return best;
 }
 private boundWheels():WheelSurfaceContact[]{const result:WheelSurfaceContact[]=[];for(const binding of this.wheels.values()){
  const entity=this.host.entities.get(binding.id);if(!entity?.body)continue;
  const radius=binding.radius??(entity.mesh?.kind==='sphere'?(entity.mesh.radius??1)*entity.scale[1]:.3),position:Vec3=[entity.position[0],entity.position[1]-radius,entity.position[2]];
  result.push({id:binding.id,position,velocity:entity.body.velocity,grounded:Math.abs(entity.body.velocity[1])<.2,radius,angularSpeed:Math.hypot(...entity.body.angularVelocity),...(binding.lateral?{lateral:binding.lateral}:{})});
 }return result;}
 step(dt:number,at:number,feet:readonly FootContact[]=[],wheelContacts:readonly WheelSurfaceContact[]=[]):void{
  if(!Number.isFinite(dt)||dt<=0||dt>.25||!Number.isFinite(at)||at<this.time)throw new RangeError('Invalid surface contact time');
  const contacts=[...this.boundWheels(),...wheelContacts],ids=new Set<string>();
  for(const wheel of contacts){if(!wheel.id||ids.has(wheel.id)||!finiteVec(wheel.position)||!finiteVec(wheel.velocity)||typeof wheel.grounded!=='boolean'||wheel.radius!==undefined&&(!Number.isFinite(wheel.radius)||wheel.radius<=0)||wheel.angularSpeed!==undefined&&(!Number.isFinite(wheel.angularSpeed)||wheel.angularSpeed<0)||wheel.lateral&&!finiteVec(wheel.lateral))throw new TypeError('Invalid wheel surface contact');ids.add(wheel.id);}
  // SnowFootprints validates the entire foot batch before touching persistent state.
  const created=this.footprints.update(at,feet,p=>{const s=this.sample(p);return s?{height:s.height,snowDepth:s.snowDepth}:undefined;});
  this.time=at;
  for(const [surfaceId,binding] of this.surfaces){const entity=this.host.entities.get(surfaceId);if(!entity){this.removeSnowSurface(surfaceId);continue;}
   const depth=this.host.surfaces.surface(surfaceId)?.snowDepthM??entity.environmental?.snowDepthM??0;
   binding.skin.setSnow(surfaceElevation(entity)+depth,depth);
   if(depth<=.002&&binding.visible){for(const id of binding.skin.ids()){const owned=this.snowEntities.get(id);if(owned&&this.host.entities.get(id)===owned)this.host.remove(id);this.snowEntities.delete(id);}binding.visible=false;}
   else if(depth>.002){binding.visible=true;this.applyMeshes(binding.skin);}
  }
  for(const stamp of created){const surface=this.sample(stamp.position);if(!surface)continue;
   const event=Object.freeze({...stamp,surfaceId:surface.surfaceId});this.events.push(event);if(this.events.length>this.footprints.capacity)this.events.shift();
   const binding=this.surfaces.get(surface.surfaceId);if(binding?.visible){binding.skin.stamp(stamp);this.applyMeshes(binding.skin);}
  }
  this.stepSpray(dt,at,contacts);
  this.host.resources.set('engine:surface-contacts',Object.freeze({time:at,wetness:this.wetness,footprints:this.footprints.snapshot().length,sprayEmitted:this.emitted,sprayActive:this.particles.size}));
 }
 drainFootsteps():SurfaceFootprint[]{return this.events.splice(0);}
 private applyMeshes(skin:SnowSurface){
  const specs=skin.drainMeshes();
  for(const spec of specs){const existing=this.host.entities.get(spec.id);if(existing&&this.snowEntities.get(spec.id)!==existing)throw new TypeError('Generated snow identity is occupied by an unowned entity');}
  for(const spec of specs){if(this.host.entities.has(spec.id))this.host.remove(spec.id);const entity=this.host.add(spec);this.snowEntities.set(spec.id,entity);}
 }
 private particle(index:number):RuntimeEntity{
  const id=`${this.id}:spray:${index}`,found=this.host.entities.get(id);if(found){if(this.particleIds.get(id)!==found)throw new TypeError('Generated particle identity collides with an authored entity');return found;}
  const entity=this.host.add({id,position:[0,-1000,0],mesh:{kind:'sphere',radius:.5,segments:6},scale:[.008,.018,.008],material:{kind:'default',color:[.52,.59,.63,.48],roughness:.14}});this.particleIds.set(id,entity);return entity;
 }
 private stepSpray(dt:number,at:number,contacts:readonly WheelSurfaceContact[]):void{
  this.wetnessValue=0;const live=new Set<string>();
  for(const wheel of contacts){
   live.add(wheel.id);
   const speed=Math.hypot(wheel.velocity[0],wheel.velocity[2]),surface=wheel.grounded&&Math.abs(wheel.velocity[1])<.25?this.sample(wheel.position):undefined;
   if(surface){
    const source=this.host.entities.get(wheel.id),body=source?.body,surfaceEntity=this.host.entities.get(surface.surfaceId),radius=wheel.radius??(source?.mesh?.kind==='sphere'?(source.mesh.radius??1)*source.scale[1]:.3);
    if(body&&surfaceEntity?.body){
     const rollingSpeed=(wheel.angularSpeed??Math.hypot(...body.angularVelocity))*radius,lateral=wheel.lateral,lateralSpeed=lateral?Math.abs(wheel.velocity[0]*lateral[0]+wheel.velocity[2]*lateral[2]):0;
     const slipSpeed=Math.hypot(Math.abs(speed-rollingSpeed),lateralSpeed),friction=Math.sqrt(Math.max(0,body.friction*surfaceEntity.body.friction));
     this.host.surfaces.applyContactWork({sourceId:wheel.id,surfaceId:surface.surfaceId,x:wheel.position[0],z:wheel.position[2],radiusM:Math.max(.06,radius*.55),durationSeconds:dt,speedMps:speed,slipSpeedMps:slipSpeed,normalLoadN:Math.max(1,body.mass)*9.81,frictionCoefficient:friction});
    }
   }
   const wet=surface?clamp(surface.waterDepth/.004,0,1):0;
   // A stationary or airborne tyre makes neither spray nor a rolling-water sound.
   if(speed<.15||wet<.04){this.wheelEmission.delete(wheel.id);continue;}this.wetnessValue=Math.max(this.wetnessValue,wet*clamp(speed/.6,0,1));
   let amount=(this.wheelEmission.get(wheel.id)??0)+dt*(12+speed*6)*wet;
   while(amount>=1){amount-=1;const index=this.sequence++%this.particleCapacity,a=this.sequence*2.3999632297,life=.20+((this.sequence*17)%19)/100,travel:Vec3=[wheel.velocity[0]/speed,0,wheel.velocity[2]/speed],lateral=wheel.lateral??[-travel[2],0,travel[0]],sideLength=Math.hypot(lateral[0],lateral[2])||1,fan=.35+wet*.72;
    const velocity:Vec3=[travel[0]*speed*.16+lateral[0]/sideLength*fan+Math.sin(a)*.13,.28+wet*.66+speed*.055,travel[2]*speed*.16+lateral[2]/sideLength*fan+Math.cos(a)*.13];
    const p:SprayParticle={index,born:at,life,origin:[wheel.position[0],surface!.height+.02,wheel.position[2]],velocity,ground:surface!.height+.003};this.particles.set(index,p);this.particle(index);this.emitted++;
   }this.wheelEmission.set(wheel.id,amount);
  }
  for(const id of this.wheelEmission.keys())if(!live.has(id))this.wheelEmission.delete(id);
  for(const [index,p] of this.particles){const age=at-p.born,entity=this.particle(index),height=p.origin[1]+p.velocity[1]*age-4.905*age*age;
   if(age>=p.life||height<p.ground){entity.position=[0,-1000,0];this.particles.delete(index);continue;}
   entity.position=[p.origin[0]+p.velocity[0]*age,height,p.origin[2]+p.velocity[2]*age];
   const growth=.7+.3*clamp(age/.08,0,1);entity.scale=[.009*growth,.012+.016*(1-age/p.life),.009*growth] as MutableVec3;
  }
 }
 inspect(){return{surfaces:this.surfaces.size,wheelContacts:this.wheels.size,tiles:[...this.surfaces.values()].reduce((sum,s)=>sum+s.skin.tileCount,0),detailedTiles:[...this.surfaces.values()].reduce((sum,s)=>sum+s.skin.detailedTiles,0),footprints:this.footprints.snapshot().length,particles:this.particles.size,particleEntities:this.particleIds.size,sprayEmitted:this.emitted,wetness:this.wetness};}
 dispose():void{for(const id of [...this.surfaces.keys()])this.removeSnowSurface(id);for(const id of [...this.wheels.keys()])this.removeWheelContact(id);for(const [id,owned] of this.particleIds)if(this.host.entities.get(id)===owned)this.host.remove(id);this.particles.clear();this.particleIds.clear();this.snowEntities.clear();this.wheelEmission.clear();this.events.length=0;this.host.resources.delete('engine:surface-contacts');}
}
