import type {Primitive} from '../scene/types.js';
import type {ParametricVehiclePart} from './passenger.js';
import {passengerPartMaterial} from './passenger.js';
import {detailedRoadWheelMeshes,type RoadWheelGeometrySpec} from './passenger-wheel.js';
import type {CompiledVehicleGeometry,VehicleReferenceProvenance} from './framework.js';

type V3=readonly[number,number,number];
type Mesh=Extract<Primitive,{kind:'triangle-mesh'}>;
export interface DoubleCabPickupVehicleDefinition {
  readonly id:string;
  readonly family:'double-cab-pickup';
  readonly dimensions:{readonly width:number;readonly length:number;readonly height:number;readonly wheelbase:number;readonly track:number;readonly wheelRadius:number;readonly axleOffset:number;readonly clearance:number};
  readonly hardpoints:{readonly hoodHingeX:number;readonly tailgateHingeX:number;readonly frontDoorHingeX:number;readonly rearDoorHingeX:number};
  readonly body:{readonly beltHeight:number;readonly hoodHeight:number;readonly cabRearX:number;readonly roofFrontX:number;readonly roofRearX:number;readonly roofHalfWidth:number;readonly bedFrontX:number;readonly bedRailHeight:number;readonly canopy:boolean;readonly canopyHalfWidth:number;readonly canopyRoofHeight:number};
  readonly wheel:Omit<RoadWheelGeometrySpec,'radius'>;
  readonly reference?:VehicleReferenceProvenance;
}
export const PICKUP_CANOPY_VEHICLE_DEFINITION:DoubleCabPickupVehicleDefinition=Object.freeze({
  id:'cc0-double-cab-pickup-canopy',
  family:'double-cab-pickup',
  dimensions:Object.freeze({width:2.077,length:5.392,height:1.814,wheelbase:3.22,track:1.60,wheelRadius:.37,axleOffset:0,clearance:.20}),
  hardpoints:Object.freeze({hoodHingeX:.94,tailgateHingeX:-2.60,frontDoorHingeX:.89,rearDoorHingeX:.12}),
  body:Object.freeze({beltHeight:1.04,hoodHeight:1.02,cabRearX:-.78,roofFrontX:.55,roofRearX:-.62,roofHalfWidth:.82,bedFrontX:-.79,bedRailHeight:1.03,canopy:true,canopyHalfWidth:.94,canopyRoofHeight:1.76}),
  wheel:Object.freeze({width:.285,rimRatio:.70,spokes:6,split:0,dish:.022}),
  reference:Object.freeze({url:'https://cdn.3dassets.dev/assets/32529/v1/model.glb',license:'CC0-1.0',sourceBytes:965632,triangles:30552}),
});

class MeshBuilder{
  positions:number[]=[];normals:number[]=[];indices:number[]=[];
  tri(a:V3,b:V3,c:V3){const base=this.positions.length/3,ux=b[0]-a[0],uy=b[1]-a[1],uz=b[2]-a[2],vx=c[0]-a[0],vy=c[1]-a[1],vz=c[2]-a[2],nx=uy*vz-uz*vy,ny=uz*vx-ux*vz,nz=ux*vy-uy*vx,L=Math.hypot(nx,ny,nz)||1;for(const p of [a,b,c]){this.positions.push(...p);this.normals.push(nx/L,ny/L,nz/L);}this.indices.push(base,base+1,base+2);}
  quad(a:V3,b:V3,c:V3,d:V3){this.tri(a,b,c);this.tri(a,c,d);}
  box(cx:number,cy:number,cz:number,sx:number,sy:number,sz:number){const x0=cx-sx/2,x1=cx+sx/2,y0=cy-sy/2,y1=cy+sy/2,z0=cz-sz/2,z1=cz+sz/2,p:V3[]=[[x0,y0,z0],[x1,y0,z0],[x1,y1,z0],[x0,y1,z0],[x0,y0,z1],[x1,y0,z1],[x1,y1,z1],[x0,y1,z1]];for(const f of [[0,3,2,1],[4,5,6,7],[0,1,5,4],[3,7,6,2],[0,4,7,3],[1,2,6,5]] as const)this.quad(p[f[0]]!,p[f[1]]!,p[f[2]]!,p[f[3]]!);}
  shell(bottomFront:V3,bottomRear:V3,topFront:V3,topRear:V3){const bf=bottomFront,br=bottomRear,tf=topFront,tr=topRear;const p:V3[]=[[bf[0],bf[1],-bf[2]],[bf[0],bf[1],bf[2]],[br[0],br[1],-br[2]],[br[0],br[1],br[2]],[tf[0],tf[1],-tf[2]],[tf[0],tf[1],tf[2]],[tr[0],tr[1],-tr[2]],[tr[0],tr[1],tr[2]]];this.quad(p[0]!,p[2]!,p[6]!,p[4]!);this.quad(p[1]!,p[5]!,p[7]!,p[3]!);this.quad(p[4]!,p[6]!,p[7]!,p[5]!);this.quad(p[0]!,p[4]!,p[5]!,p[1]!);this.quad(p[2]!,p[3]!,p[7]!,p[6]!);}
  mesh():Mesh{return{kind:'triangle-mesh',positions:this.positions,normals:this.normals,indices:this.indices};}
}
const merge=(...meshes:Mesh[]):Mesh=>{const positions:number[]=[],normals:number[]=[],indices:number[]=[];for(const m of meshes){const base=positions.length/3;positions.push(...m.positions);normals.push(...m.normals);for(const i of m.indices)indices.push(base+i);}return{kind:'triangle-mesh',positions,normals,indices};};
function glassQuad(a:V3,b:V3,c:V3,d:V3):Mesh{const m=new MeshBuilder();m.quad(a,b,c,d);return m.mesh();}
function pickupBody(def:DoubleCabPickupVehicleDefinition):Mesh{
  const d=def.dimensions,b=def.body,m=new MeshBuilder(),half=d.width/2*.965,lowerY=d.clearance+.34,lowerH=b.beltHeight-lowerY;
  m.box(0,(lowerY+b.beltHeight)/2,0,d.length*.965,lowerH,half*2);
  m.shell([d.length*.48,b.hoodHeight-.16,half*.93],[def.hardpoints.hoodHingeX,b.hoodHeight-.12,half*.95],[d.length*.47,b.hoodHeight,half*.88],[def.hardpoints.hoodHingeX,b.hoodHeight,half*.91]);
  m.shell([def.hardpoints.hoodHingeX,b.beltHeight,half*.91],[b.cabRearX,b.beltHeight,half*.92],[b.roofFrontX,d.height*.965,b.roofHalfWidth],[b.roofRearX,d.height*.985,b.roofHalfWidth*.99]);
  m.box((b.bedFrontX+def.hardpoints.tailgateHingeX)/2,(lowerY+b.bedRailHeight)/2,0,b.bedFrontX-def.hardpoints.tailgateHingeX,b.bedRailHeight-lowerY,half*2*.985);
  if(b.canopy)m.shell([b.bedFrontX,b.bedRailHeight,b.canopyHalfWidth],[def.hardpoints.tailgateHingeX,b.bedRailHeight,b.canopyHalfWidth],[b.bedFrontX+.03,b.canopyRoofHeight,b.canopyHalfWidth*.94],[def.hardpoints.tailgateHingeX+.08,b.canopyRoofHeight*.985,b.canopyHalfWidth*.92]);
  m.box(d.length*.49,d.clearance+.24,0,.16,.20,d.width*.94);m.box(-d.length*.49,d.clearance+.27,0,.17,.22,d.width*.93);
  return m.mesh();
}
function pickupGlass(def:DoubleCabPickupVehicleDefinition):Mesh{
  const d=def.dimensions,b=def.body,half=d.width/2*.925,roof=b.roofHalfWidth,meshes:Mesh[]=[];
  meshes.push(glassQuad([def.hardpoints.hoodHingeX,b.beltHeight,-half],[def.hardpoints.hoodHingeX,b.beltHeight,half],[b.roofFrontX,d.height*.955,roof],[b.roofFrontX,d.height*.955,-roof]));
  const side=(s:-1|1)=>{const z=s*half,rz=s*roof;meshes.push(glassQuad([def.hardpoints.hoodHingeX-.05,b.beltHeight+.05,z],[b.roofFrontX,d.height*.93,rz],[.08,d.height*.95,rz],[.08,b.beltHeight+.05,z]));meshes.push(glassQuad([.02,b.beltHeight+.05,z],[.02,d.height*.95,rz],[b.cabRearX+.06,d.height*.93,rz],[b.cabRearX+.06,b.beltHeight+.05,z]));if(b.canopy){const cz=s*b.canopyHalfWidth*.955;meshes.push(glassQuad([b.bedFrontX+.08,b.bedRailHeight+.08,cz],[b.bedFrontX+.08,b.canopyRoofHeight-.08,s*b.canopyHalfWidth*.89],[def.hardpoints.tailgateHingeX+.18,b.canopyRoofHeight-.10,s*b.canopyHalfWidth*.87],[def.hardpoints.tailgateHingeX+.18,b.bedRailHeight+.10,cz]));}};
  side(-1);side(1);
  if(b.canopy)meshes.push(glassQuad([def.hardpoints.tailgateHingeX+.09,b.bedRailHeight+.12,-b.canopyHalfWidth*.82],[def.hardpoints.tailgateHingeX+.09,b.bedRailHeight+.12,b.canopyHalfWidth*.82],[def.hardpoints.tailgateHingeX+.17,b.canopyRoofHeight-.13,b.canopyHalfWidth*.78],[def.hardpoints.tailgateHingeX+.17,b.canopyRoofHeight-.13,-b.canopyHalfWidth*.78]));
  return merge(...meshes);
}
export function compileDoubleCabPickupVehicle(definition:DoubleCabPickupVehicleDefinition):CompiledVehicleGeometry{
  const d=definition.dimensions,body=pickupBody(definition),glass=pickupGlass(definition),parts:ParametricVehiclePart[]=[{id:'body',role:'paint',mesh:body,position:[0,0,0],material:passengerPartMaterial('paint')},{id:'glass',role:'glass',mesh:glass,position:[0,0,0],material:passengerPartMaterial('glass')}],front=d.wheelbase/2+d.axleOffset,rear=-d.wheelbase/2+d.axleOffset;
  for(const [axle,x] of [['front',front],['rear',rear]] as const)for(const [side,z,sign] of [['left',-d.track/2,-1],['right',d.track/2,1]] as const){const w=detailedRoadWheelMeshes({radius:d.wheelRadius,...definition.wheel},sign);parts.push({id:`tire-${axle}-${side}`,role:'tire',mesh:w.tire,position:[x,d.wheelRadius,z],wheel:true,material:passengerPartMaterial('tire')},{id:`rim-${axle}-${side}`,role:'rim',mesh:w.rim,position:[x,d.wheelRadius,z],wheel:true,material:passengerPartMaterial('rim')});}
  const generatedTriangles=parts.reduce((n,p)=>n+(p.mesh.kind==='triangle-mesh'?p.mesh.indices.length/3:0),0);
  return Object.freeze({definition,parts:Object.freeze(parts.map(part=>Object.freeze(part))),body,bodyTriangles:body.indices.length/3,generatedTriangles});
}
