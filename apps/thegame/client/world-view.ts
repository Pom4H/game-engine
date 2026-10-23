import {Scene} from '../../../src/scene/scene.js';
import {sampleWalker,bindHumanoid,type HumanoidBinding,type WalkerSpec} from '../../../src/animation/locomotion.js';
import {batchStaticScenery} from '../../../src/procedural/static-batch.js';
import {resolveEnvironmentAt} from '../../../src/environment/types.js';
import type {EntitySpec,Color} from '../../../src/scene/types.js';
import {compileOffice} from './office-geometry.js';
import {buildOfficeLayout} from '../office-layout.js';
import {BuildingWorld,LIFT} from '../building.js';
import {localPoint,worldPoint,type Binding,type OfficeState,type WorldPresentation,type Person,type Vec3} from '../shared.js';

type Mode='office'|'game';
type Avatar={ids:string[];bindings:HumanoidBinding[];walker:WalkerSpec};
const hash=(s:string)=>{let n=2166136261;for(const c of s)n=Math.imul(n^c.charCodeAt(0),16777619);return n>>>0;};
const box=(id:string,position:Vec3,size:Vec3,color:Color,rotation:Vec3=[0,0,0]):EntitySpec=>({id,position,rotation,mesh:{kind:'box',size},material:{color,roughness:.76},renderOnly:true});

/** One passive native Engine projection is used in both Game and Office. */
export class WorldLayer{
 private mode:Mode;private binding:Binding;private readonly world:BuildingWorld;private readonly embeddedOffice:boolean;
 private layout:OfficeState|null=null;private selectedFloor:number;private disposed=false;private cityVisible=true;
 private chunks=new Map<string,string[]>();private avatars=new Map<string,Avatar>();private vehicles=new Map<string,string[]>();
 private buildingIds:string[]=[];private liftIds:string[]=[];private localMarkers:{id:string;position:Vec3;name:string}[]=[];
 private layoutKey='';private buildingKey='';private lightingKey='';private last:WorldPresentation|null=null;
 readonly diagnostics={chunks:0,actors:0,traffic:0,lightingUpdates:0,presentedTime:0};
 constructor(private readonly scene:Scene,options:{binding:Binding;mode:Mode}){this.binding={...options.binding};this.mode=options.mode;this.embeddedOffice=options.mode==='office';this.selectedFloor=this.binding.officeFloor;this.world=new BuildingWorld(this.binding.seed,this.binding.epoch);Object.assign(this.world.binding,this.binding);}
 toLocal(p:Vec3):Vec3{return localPoint(this.binding,p,this.selectedFloor);}
 isOfficeFloor(floor:number):boolean{return this.layout?floor>=this.binding.officeFloor&&floor<this.binding.officeFloor+this.layout.floors.length:floor===this.binding.officeFloor;}
 setMode(mode:Mode):void{if(this.mode!==mode){this.mode=mode;this.buildingKey='';this.rebuildBuilding();}}
 /** A view preference: the house and visitors keep their authoritative state. */
 setCityVisible(visible:boolean):void{if(this.disposed||this.cityVisible===visible)return;this.cityVisible=visible;if(this.last)this.update(this.last);else if(!visible)this.clearCity();}
 configureLayout(state:OfficeState):void{
  const key=JSON.stringify([state.revision,state.activeFloor,state.objects,state.floors]);if(key===this.layoutKey)return;
  const floor=this.binding.officeFloor+Math.max(0,state.floors.findIndex(f=>f.id===state.activeFloor));this.layout=structuredClone(state);this.layoutKey=key;this.world.setLayout(state);
  if(floor!==this.selectedFloor){this.selectedFloor=floor;this.clearStatic();for(const a of this.avatars.values())for(const id of a.ids)this.scene.setVisualTransform(id,[0,-1000,0]);}
  this.buildingKey='';this.rebuildBuilding();
 }
 private add(spec:EntitySpec):string{this.scene.add({...spec,renderOnly:true});return spec.id;}
 private remove(ids:Iterable<string>){for(const id of ids)this.scene.remove(id);}
 private clearCity(){for(const ids of this.chunks.values())this.remove(ids);this.chunks.clear();this.diagnostics.chunks=0;}
 private clearStatic(){this.clearCity();this.remove(this.buildingIds);this.remove(this.liftIds);this.buildingIds=[];this.liftIds=[];this.buildingKey='';}
 private translated(spec:EntitySpec,prefix:string,base:Vec3):EntitySpec{const p=spec.position??[0,0,0];return{...spec,id:prefix+spec.id,position:[p[0]+base[0],p[1]+base[1],p[2]+base[2]],renderOnly:true};}
 private rebuildBuilding():void{
  if(this.disposed)return;const key=[this.mode,this.selectedFloor,this.binding.floorCount,this.layoutKey,this.cityVisible].join(':');if(key===this.buildingKey)return;this.buildingKey=key;
  this.remove(this.buildingIds);this.remove(this.liftIds);this.buildingIds=[];this.liftIds=[];
  const specs:EntitySpec[]=[],floorHeight=this.binding.floorHeight;
  if(this.mode==='office'&&this.cityVisible){
   // All levels retain their facade silhouette. Shared shell walls define the
   // footprint; only perimeter ribs and very light panels surround the office.
   const plan=this.world.floorLayouts.get(this.selectedFloor)??buildOfficeLayout({version:1,revision:0,floors:[{id:'shell',name:'',wallpaper:'ivory'}],objects:[],activeFloor:'shell',selection:null});
   const shell=plan.walls.filter(w=>w.id.startsWith('shell:'));
   for(let floor=0;floor<this.binding.floorCount;floor++){
    const y=(floor-this.selectedFloor)*floorHeight,frame:EntitySpec[]=[],panels:EntitySpec[]=[],prefix=`world:facade:${floor}:`;
    for(const wall of shell){
     const color:Color=[.53,.64,.62,1],rotation:Vec3=[0,wall.rotation,0],span=wall.width+wall.depth,height=floorHeight-.18;
     for(const edge of [0,floorHeight])frame.push(box(`${prefix}${wall.id}:band:${edge}`,[wall.x,y+edge-.04,wall.z],[span,.08,.12],color,rotation));
     const bays=Math.max(1,Math.ceil(span/4.5)),c=Math.cos(wall.rotation),s=Math.sin(wall.rotation);
     for(let bay=0;bay<=bays;bay++){const x=(bay/bays-.5)*span;frame.push(box(`${prefix}${wall.id}:post:${bay}`,[wall.x+c*x,y+height/2,wall.z-s*x],[.065,height,.10],color,rotation));}
     panels.push(box(`${prefix}${wall.id}:panel`,[wall.x,y+height/2,wall.z],[span,height,.035],[.34,.52,.57,.025],rotation));
    }
    // Uniform ribs are one authored transparent surface per spatial cell.
    // Batch before assigning alpha so the renderer can sort bounded groups.
    for(const e of batchStaticScenery(frame,()=>true,64))specs.push({...e,material:{...e.material,color:[.53,.64,.62,floor===this.selectedFloor ? .32 : .18]}});
    specs.push(...panels);
   }
  }
  if(this.mode==='game'){
   for(let floor=0;floor<this.binding.floorCount;floor++){
    const y=(floor-this.selectedFloor)*floorHeight,isOffice=this.isOfficeFloor(floor);
    if(isOffice&&this.layout){if(this.embeddedOffice&&floor===this.selectedFloor)continue;const state={...this.layout,activeFloor:this.layout.floors[floor-this.binding.officeFloor]!.id},compiled=compileOffice(state,[],{elevator:false});for(const e of compiled.spec.entities)if(!e.id.startsWith('selection:'))specs.push(this.translated(e,`world:office:${floor}:`,[0,y,0]));continue;}
    // Slabs leave the actual lift aperture. There is no unsupported stair opening.
    specs.push(box(`world:slab:${floor}:front`,[0,y-.07,.95],[28,.14,18.1],[.69,.64,.54,1]));
    for(const s of [-1,1])specs.push(box(`world:slab:${floor}:${s}`,[s*7.925,y-.07,-9.05],[12.15,.14,1.9],[.69,.64,.54,1]));
    const color:Color=[.65,.67,.62,1];
    for(const s of [-1,1])specs.push(box(`world:wall:${floor}:side:${s}`,[s*13.9,y+1.55,0],[.2,3.1,20],color));
    for(const s of [-1,1])specs.push(box(`world:wall:${floor}:rear:${s}`,[s*7.925,y+1.55,-9.9],[12.15,3.1,.2],color));
    for(const s of [-1,1])specs.push(box(`world:wall:${floor}:front:${s}`,[s*7.8,y+1.55,9.9],[12.4,3.1,.2],color));
    if(floor>0)specs.push(box(`world:wall:${floor}:front:center`,[0,y+1.55,9.9],[3.2,3.1,.2],color));
    specs.push({...box(`world:floorlabel:${floor}`,[1.9,y+1.45,-7.99],[.5,.35,.04],[.15,.26,.26,1]),material:{color:[.15,.26,.26,1],label:String(floor+1)}});
   }
  }
  const shaftFloor=this.mode==='office'?this.selectedFloor:null;
  for(let floor=0;floor<this.binding.floorCount;floor++){
   if(shaftFloor!==null&&floor!==shaftFloor)continue;const y=(floor-this.selectedFloor)*floorHeight;
   for(const s of [-1,1])specs.push(box(`world:shaft:${floor}:side:${s}`,[s*1.85,y+1.55,-9.4],[.2,3.1,2.8],[.16,.23,.25,1]));
   specs.push(box(`world:shaft:${floor}:rear`,[0,y+1.55,-10.72],[3.8,3.1,.16],[.16,.23,.25,1]));
   for(const s of [-1,1])this.liftIds.push(this.add(box(`world:gate:${floor}:${s}`,[s*.8,y+1.3,LIFT.front],[1.6,2.6,.10],[.22,.59,.53,1])));
  }
  const y=(this.last?.lift.elevation??this.binding.officeFloor*floorHeight)-this.selectedFloor*floorHeight;
  this.liftIds.push(this.add(box('world:cabin:floor',[0,y-.06,LIFT.z],[3.25,.12,2.5],[.35,.43,.45,1])));
  this.liftIds.push(this.add(box('world:cabin:back',[0,y+1.35,LIFT.z-1.22],[3.2,2.7,.10],[.44,.52,.54,1])));
  this.liftIds.push(this.add(box('world:cabin:ceiling',[0,y+2.72,LIFT.z],[3.25,.08,2.5],[.75,.76,.70,1])));
  specs.push({...box('world:elevator:sign',[0,2.98,LIFT.front+.12],[2.9,.28,.08],[.85,.68,.32,1]),material:{color:[.85,.68,.32,1],label:'THE GAME · LIFT',labelColor:[.12,.23,.24]}});
  for(const spec of batchStaticScenery(specs,e=>!!e.mesh,32))this.buildingIds.push(this.add(spec));
 }
 private streamCity(center:Vec3):void{
  const cx=Math.floor(center[0]/128),cz=Math.floor(center[2]/128),wanted=new Set<string>();
  for(let dz=-1;dz<=1;dz++)for(let dx=-1;dx<=1;dx++){
   const x=cx+dx,z=cz+dz,key=`${x}:${z}`;wanted.add(key);if(this.chunks.has(key))continue;
   const chunk=this.world.chunk(x,z),base=this.toLocal([x*128,0,z*128]),specs:EntitySpec[]=[],positions:number[]=[],indices:number[]=[],normals:number[]=[];
   for(let j=0;j<=16;j++)for(let i=0;i<=16;i++){positions.push(i*8,chunk.heights[j*17+i]!,j*8);normals.push(0,1,0);}
   for(let j=0;j<16;j++)for(let i=0;i<16;i++){const a=j*17+i;indices.push(a,a+17,a+1,a+1,a+17,a+18);}
   specs.push({id:`world:terrain:${key}`,position:base,mesh:{kind:'triangle-mesh',positions,normals,indices},material:{kind:'concrete',color:[.32,.43,.33,1],roughness:.95},renderOnly:true});
   // The city's 64 m street grid is the same road source used by the recovered world.
   if(Math.abs(x)<3&&Math.abs(z)<3)for(let i=0;i<2;i++){
    specs.push(box(`world:roadx:${key}:${i}`,[base[0]+i*64,base[1]+.015,base[2]+64],[12,.03,128],[.17,.20,.20,1]));
    specs.push(box(`world:roadz:${key}:${i}`,[base[0]+64,base[1]+.019,base[2]+i*64],[128,.03,12],[.17,.20,.20,1]));
    specs.push(box(`world:roadmarkx:${key}:${i}`,[base[0]+i*64,base[1]+.036,base[2]+64],[.13,.008,112],[.82,.80,.66,1]));
    specs.push(box(`world:roadmarkz:${key}:${i}`,[base[0]+64,base[1]+.038,base[2]+i*64],[112,.008,.13],[.82,.80,.66,1]));
   }
   for(const prop of chunk.props){const p=this.toLocal([prop.x,prop.y+prop.height/2,prop.z]),color:Color=[...prop.color,1];specs.push(box(`world:prop:${prop.id}`,p,[prop.width,prop.height,prop.depth],color));if(prop.kind==='building'){
    for(const side of [-1,1])for(let f=0;f<Math.min(8,Math.floor(prop.height/3.3));f++)specs.push(box(`world:window:${prop.id}:${side}:${f}`,[p[0],p[1]-prop.height/2+1.8+f*3.3,p[2]+side*(prop.depth/2+.01)],[prop.width*.82,1.5,.025],[.18,.29,.33,1]));
   }}
   this.chunks.set(key,batchStaticScenery(specs,e=>!!e.mesh,64).map(e=>this.add(e)));
  }
  for(const [key,ids] of this.chunks)if(!wanted.has(key)){this.remove(ids);this.chunks.delete(key);}this.diagnostics.chunks=this.chunks.size;
 }
 private avatar(person:Person):Avatar{
  let avatar=this.avatars.get(person.id);if(avatar)return avatar;const prefix=`world:actor:${person.id}:`,seed=hash(person.id),shirt:Color=person.kind===0?[.27+(seed%4)*.09,.52,.56,1]:[.52,.42+(seed%3)*.08,.32,1],skin:Color=[.72,.51,.37,1],dark:Color=[.19,.23,.27,1],ids:string[]=[],bindings:HumanoidBinding[]=[];
  const part=(name:string,joint:HumanoidBinding['joint'],size:Vec3,color:Color,extra:Partial<HumanoidBinding>={})=>{const id=prefix+name;ids.push(this.add(box(id,[0,-1000,0],size,color)));bindings.push({entity:id,joint,...extra});};
  part('torso','chest',[.4,.5,.25],shirt,{offset:[0,-.035,0]});part('hips','pelvis',[.34,.23,.23],dark);part('head','head',[.24,.29,.25],skin);part('hair','head',[.255,.09,.26],[.22,.16,.12,1],{offset:[0,.14,0]});
  for(const side of ['left','right'] as const){part(side+'arm',`${side}Shoulder`,[1,1,1],shirt,{boneTo:`${side}Elbow`,scale:[.12,1,.12]});part(side+'forearm',`${side}Elbow`,[1,1,1],skin,{boneTo:`${side}Hand`,scale:[.09,1,.09]});part(side+'thigh',`${side}Hip`,[1,1,1],dark,{boneTo:`${side}Knee`,scale:[.15,1,.15]});part(side+'shin',`${side}Knee`,[1,1,1],dark,{boneTo:`${side}Ankle`,scale:[.11,1,.11]});part(side+'shoe',`${side}Foot`,[.28,.12,.14],[.10,.13,.16,1],{foot:side});}
  avatar={ids,bindings,walker:{id:person.id,root:[0,0,0],speed:0,stance:'neutral'}};this.avatars.set(person.id,avatar);return avatar;
 }
 update(presentation:WorldPresentation):void{
  if(this.disposed)return;this.last=presentation;Object.assign(this.binding,presentation.binding);Object.assign(this.world.binding,presentation.binding);Object.assign(this.world.lift,presentation.lift);
  const center=this.mode==='game'&&presentation.self?presentation.self.position:this.binding.origin;if(this.cityVisible)this.streamCity(center);else this.clearCity();this.rebuildBuilding();this.localMarkers=[];const active=new Set<string>();
  for(const person of presentation.actors){
   const p=this.toLocal(person.position),floor=Math.floor((person.position[1]-this.binding.origin[1]+.05)/this.binding.floorHeight);
   if(this.mode==='office'&&this.world.inBuilding(person.position[0],person.position[2])&&floor!==this.selectedFloor)continue;
   if(!this.cityVisible&&!this.world.inBuilding(person.position[0],person.position[2]))continue;
   if(Math.hypot(person.position[0]-center[0],person.position[2]-center[2])>240)continue;
   const avatar=this.avatar(person);active.add(person.id);const heading=person.yaw-Math.PI/2,speed=Math.min(2,person.speed),period=Math.max(.42,Math.min(1.3,1.16/Math.max(.01,speed))),time=person.phase/(Math.PI*2)*period,travel=speed*time;
   const pose=sampleWalker({...avatar.walker,root:[p[0]-Math.cos(heading)*travel,p[1],p[2]+Math.sin(heading)*travel],heading,speed,period},time);
   for(const t of bindHumanoid(pose,avatar.bindings))this.scene.setVisualTransform(t.entity,t.position,t.rotation,t.scale);
   if(this.world.inBuilding(person.position[0],person.position[2])||person.kind===0)this.localMarkers.push({id:person.id,position:[p[0],p[1]+2.02,p[2]],name:person.name});
  }
  for(const [id,a] of this.avatars)if(!active.has(id)){this.remove(a.ids);this.avatars.delete(id);}this.diagnostics.actors=this.avatars.size;
  const traffic=new Set<string>();for(const vehicle of this.cityVisible?presentation.vehicles:[]){traffic.add(vehicle.id);let ids=this.vehicles.get(vehicle.id);if(!ids){const prefix=`world:traffic:${vehicle.id}:`;ids=[this.add(box(prefix+'body',[0,0,0],[2.45,2.6,10.8],[.21,.48,.43,1])),this.add(box(prefix+'windows',[0,0,0],[2.48,1.05,9.0],[.13,.24,.28,1]))];this.vehicles.set(vehicle.id,ids);}const p=this.toLocal(vehicle.position);this.scene.setVisualTransform(ids[0]!,[p[0],p[1]+1.3,p[2]],[0,vehicle.yaw-this.binding.yaw,0]);this.scene.setVisualTransform(ids[1]!,[p[0],p[1]+1.8,p[2]],[0,vehicle.yaw-this.binding.yaw,0]);}
  for(const [id,ids]of this.vehicles)if(!traffic.has(id)){this.remove(ids);this.vehicles.delete(id);}this.diagnostics.traffic=this.vehicles.size;
  const l=presentation.lift;for(let floor=0;floor<this.binding.floorCount;floor++)for(const side of [-1,1]){const id=`world:gate:${floor}:${side}`;if(this.scene.entities.has(id))this.scene.setVisualTransform(id,[side*(.8+(floor===l.floor?l.door:0)*1.6),(floor-this.selectedFloor)*this.binding.floorHeight+1.3,LIFT.front]);}
  for(const [name,offset]of [['floor',-.06],['back',1.35],['ceiling',2.72]] as const){const id=`world:cabin:${name}`;if(this.scene.entities.has(id))this.scene.setVisualTransform(id,[0,l.elevation-this.selectedFloor*this.binding.floorHeight+offset,name==='back'?LIFT.z-1.22:LIFT.z]);}
  const w=presentation.weather,key=[...w.sunDirection.map(n=>Math.round(n*100)),Math.round(w.sunIntensity*100),...w.skyColor.map(n=>Math.round(n*100))].join(':');if(key!==this.lightingKey){this.lightingKey=key;this.scene.patchAppearance({rendering:{sunDirection:w.sunDirection,sunIntensity:w.sunIntensity,skyColor:w.skyColor,ambientIrradiance:[.23,.27,.28],shadowExtent:90,fogDensity:.001}});this.diagnostics.lightingUpdates++;}
  this.scene.environment=resolveEnvironmentAt({...w,clock:{startHour:(presentation.worldMinute%1440)/60,hoursPerSecond:0}},0);this.diagnostics.presentedTime=presentation.time;
 }
 markers():{id:string;position:Vec3;name:string}[]{return this.localMarkers;}
 cameraPosition(self:Vec3,desired:Vec3):Vec3{
  const absolute=worldPoint(this.binding,self,this.selectedFloor);if(!this.world.inBuilding(absolute[0],absolute[2]))return desired;
  const base=Math.floor((absolute[1]-this.binding.origin[1]+.05)/this.binding.floorHeight)*this.binding.floorHeight-this.selectedFloor*this.binding.floorHeight;
  const candidate:Vec3=[desired[0],Math.min(base+2.72,Math.max(base+.28,desired[1])),desired[2]],head:Vec3=[self[0],self[1]+1.5,self[2]];
  let clear:Vec3=head;for(let i=1;i<=32;i++){const t=i/32,p:Vec3=[head[0]+(candidate[0]-head[0])*t,head[1]+(candidate[1]-head[1])*t,head[2]+(candidate[2]-head[2])*t],a=worldPoint(this.binding,p,this.selectedFloor);if(this.world.blocked(a[0],a[1]-.12,a[2],.24,.15))break;clear=p;}return clear;
 }
 dispose():void{if(this.disposed)return;this.disposed=true;this.clearStatic();for(const a of this.avatars.values())this.remove(a.ids);for(const ids of this.vehicles.values())this.remove(ids);this.avatars.clear();this.vehicles.clear();this.diagnostics.actors=this.diagnostics.traffic=0;this.world.dispose();this.localMarkers=[];}
}
