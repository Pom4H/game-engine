import {eulerFromBasis,eulerFromQuaternion} from '../physics/rotation.js';
import {Scene,type RuntimeEntity} from '../scene/scene.js';
import type {EntitySpec,Color} from '../scene/types.js';
import type {Vec3,MutableVec3} from '../math.js';
import {ForceFrame} from '../physics/force-frame.js';
import {DynamicMesh} from '../procedural/dynamic-mesh.js';
import {compileVehicle} from '../vehicles/framework.js';
import {M3_VEHICLE_DEFINITION} from '../vehicles/m3.js';
import {BALL,CAR_SCALE,arenaBoxes,arenaProjection,PADS} from './car-ball.js';
import type {Sample} from '../network/playback.js';

export const arenaOffset=Object.fromEntries(arenaProjection.layout.map(f=>[f.name,f.offset])) as Record<string,number>;
interface BoundPart {readonly entity:RuntimeEntity;readonly offset:Vec3;readonly wheel:number;}
interface BoundCar {readonly frame:ForceFrame;readonly rotation:MutableVec3;readonly origin:number;readonly orientation:number;readonly parts:readonly BoundPart[];}
const teams:readonly Color[]=[[.05,.38,.88,1],[.95,.27,.055,1]];
const box=(id:string,position:Vec3,size:Vec3,color:Color):EntitySpec=>({id,position,mesh:{kind:'box',size},material:{kind:'plastic',color,roughness:.75},collision:'none'});
/** Passive scene projection. No solver/body allocation, even during replay. */
export class CarBallView {
 readonly scene:Scene;readonly ballMesh:DynamicMesh;
 readonly geometry=compileVehicle(M3_VEHICLE_DEFINITION);
 private readonly cars:readonly BoundCar[];private readonly pads:readonly RuntimeEntity[];private readonly release:()=>void;
 private readonly local=new ForceFrame();private readonly wheelBasis=new Float64Array(9);private readonly tmp:MutableVec3=[0,0,0];
 private generation=-1;private epoch=-1;private lastTime=-1;
 constructor(){
  const entities:EntitySpec[]=arenaBoxes.filter(b=>b.visible).map(b=>({...box(b.id,b.position,b.size,b.id==='floor'?[.06,.16,.13,1]:b.id.startsWith('side')?[.12,.17,.23,1]:b.position[0]<0?[.035,.18,.42,1]:[.4,.115,.035,1]),rotation:b.rotation??[0,0,0]}));
  // Field markings, goal mouths and stands are ordinary engine geometry.
  entities.push(box('halfway',[0,.004,0],[.08,.008,36],[.8,.9,.85,1]));
  entities.push({id:'circle',position:[0,.013,0],mesh:{kind:'torus',radius:5,tube:.04,segments:64},material:{kind:'plastic',color:[.8,.9,.85,1]},collision:'none'});
  for(let z=-16;z<=16;z+=4)entities.push(box(`stripe:${z}`,[0,.002,z],[55,.003,2],[.065,.18,.145,1]));
  for(const s of [-1,1]){
   for(const z of [-5,5])entities.push(box(`post:${s}:${z}`,[s*27.92,2,z],[.18,4,.18],teams[s<0?0:1]!));
   entities.push(box(`goal-line:${s}`,[s*28,.009,0],[.12,.012,10],[.9,.94,.9,1]));
   for(const z of [-17.8,17.8])entities.push(box(`rail:${s}:${z}`,[s*14,1,z],[28,.09,.08],teams[s<0?0:1]!));
  }
  PADS.forEach((pad,i)=>entities.push({id:`pad:${i}`,position:pad.position,mesh:{kind:'cylinder',radius:pad.amount===100?.8:.45,height:.025,segments:20},material:{kind:'plastic',color:[1,.67,.12,1],emissive:[.3,.13,.01]},collision:'none'}));
  for(let car=0;car<2;car++)for(const part of this.geometry.parts)entities.push({id:`car:${car}/${part.id}`,scale:[CAR_SCALE,CAR_SCALE,CAR_SCALE],mesh:part.mesh,material:part.role==='paint'?{...part.material,color:teams[car]!,roughness:.34,metalness:.12,clearcoat:.35,clearcoatRoughness:.25}:part.material??{},collision:'none'});
  entities.push({id:'ball',mesh:{kind:'sphere',radius:1.45},material:{kind:'rubber',color:[.96,.93,.81,1],roughness:.67},collision:'none'});
  this.scene=new Scene({version:1,entities,environment:{temperatureC:20,sunlight:1,humidity:0,groundMoisture:0,precipitation:'arid',snowfall:'none'},camera:{position:[-23,5,8],target:[0,1,0],fov:70},rendering:{sunDirection:[-.3,.9,.45],sunIntensity:2.1,sunColor:[1,.96,.87],skyColor:[.38,.5,.7],fogDensity:.001,shadowExtent:45,exposure:1}});
  // Resolve once for this fixed scene roster. Recreate the view when its topology changes.
  const parts=this.geometry.parts.map(part=>{
   const match=/^(tire|rim)-(front|rear)-(left|right)$/.exec(part.id);
   return{id:part.id,offset:[part.position[0]*CAR_SCALE,(part.position[1]-.70)*CAR_SCALE,part.position[2]*CAR_SCALE] as Vec3,wheel:match?(match[2]==='front'?0:2)+(match[3]==='left'?0:1):-1};
  });
  this.cars=[0,1].map(car=>({frame:new ForceFrame(),rotation:[0,0,0],origin:arenaOffset[`car${car}`]!,orientation:arenaOffset[`rotation${car}`]!,parts:parts.map(part=>({entity:this.scene.entities.get(`car:${car}/${part.id}`)!,offset:part.offset,wheel:part.wheel}))}));
  this.pads=PADS.map((_,i)=>this.scene.entities.get(`pad:${i}`)!);
  this.ballMesh=new DynamicMesh(BALL.definition.nodes.slice(0,BALL.surfaceNodes).flatMap(n=>[...n.position]),BALL.indices);
  this.scene.entities.get('ball')!.mesh=this.ballMesh;
  this.release=this.scene.trackPresentation([...this.scene.entities.keys()].filter(id=>id.startsWith('car:')||id==='ball'||id.startsWith('pad:')));
 }
 apply(sample:Sample):void {
  const row=sample.rows[0];if(!row)return;const v=row.values,o=arenaOffset;
  if(this.epoch!==sample.epoch||this.generation!==row.generation){this.scene.cutPresentation();this.generation=row.generation;this.epoch=sample.epoch;this.lastTime=-1;}
  if(this.lastTime===sample.time)return;this.lastTime=sample.time;
  const tmp=this.tmp;
  for(let car=0;car<this.cars.length;car++){
   const {origin,orientation,frame:f,rotation,parts}=this.cars[car]!;
   eulerFromQuaternion(v.subarray(orientation,orientation+4),rotation);f.update(rotation);
   for(const {entity:e,offset,wheel} of parts){
    tmp.splice(0,3,...offset);
    if(wheel>=0)tmp[1]=(.04-.32+.0475)*CAR_SCALE+v[o.compression!+car*4+wheel]!;
    f.rotate(tmp,tmp);for(let k=0;k<3;k++){e.position[k]=v[origin+k]!+tmp[k]!;e.rotation[k]=rotation[k]!;}
    if(wheel>=0){
     const spin=v[o.spin!+car*4+wheel]!,steer=wheel<2?v[o.steer!+car]!*.6:0;
     // Compose wheel local frame with the body frame before converting for this renderer.
     const local=this.local;local.update([0,-steer,-spin]);const basis=this.wheelBasis;
     for(let a=0;a<3;a++){f.rotate([local.basis[a*3]!,local.basis[a*3+1]!,local.basis[a*3+2]!],tmp);basis.set(tmp,a*3);}eulerFromBasis(basis,e.rotation);
    }
   }
  }
  let changed=false;for(let i=0;i<this.ballMesh.positions.length;i++){const n=v[o.nodes!+i]!;if(this.ballMesh.positions[i]!==n){this.ballMesh.positions[i]=n;changed=true;}}
  if(changed)this.ballMesh.commit();
  this.pads.forEach((e,i)=>{const s=v[o.pads!+i]!>0?.22:1;e.scale[0]=e.scale[2]=s;});
  this.scene.tick=sample.fromTick;this.scene.time=sample.time;
 }
 dispose():void {this.release();this.scene.dispose();}
}
