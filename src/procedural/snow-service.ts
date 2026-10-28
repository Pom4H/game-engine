import type {Primitive,MaterialSpec,EntitySpec} from '../scene/types.js';
import type {Vec3} from '../math.js';
export type SnowServicePart={id:string;p:Vec3;mesh:Primitive;material:MaterialSpec;wheel?:number;axisZ?:boolean};
import {batchStaticScenery} from './static-batch.js';
import {freezePrimitive} from './mesh.js';
import {detailedRoadWheelMeshes} from '../vehicles/passenger-wheel.js';

const paint:MaterialSpec={kind:'steel',color:[.87,.32,.025,1],treatment:'painted',roughness:.35,metalness:.08,clearcoat:.35,clearcoatRoughness:.18},steel:MaterialSpec={kind:'steel',color:[.17,.19,.20,1],roughness:.65,metalness:.55},pane:MaterialSpec={kind:'default',color:[.08,.14,.18,1],roughness:.6};
let cache:SnowServicePart[]|undefined;
function curvedBlade():Primitive{
 const outer:[number,number][]=[[-.08,-.5],[.18,-.35],[.24,0],[.14,.35],[-.12,.5]],inner=outer.map(([x,y]):[number,number]=>[x-.08,y]),positions:number[]=[],normals:number[]=[],indices:number[]=[];
 const at=(p:number[],z:number):number[]=>[p[0]!,p[1]!,z],quad=(a:number[],b:number[],c:number[],d:number[])=>{const ab=b.map((v,k)=>v-a[k]!),ac=c.map((v,k)=>v-a[k]!),n=[ab[1]!*ac[2]!-ab[2]!*ac[1]!,ab[2]!*ac[0]!-ab[0]!*ac[2]!,ab[0]!*ac[1]!-ab[1]!*ac[0]!],length=Math.hypot(...n),base=positions.length/3;for(const p of [a,b,c,d]){positions.push(...p);normals.push(...n.map(v=>v/length));}indices.push(base,base+1,base+2,base,base+2,base+3);};
 for(let i=0;i<outer.length-1;i++){
  quad(at(outer[i]!,-1.75),at(outer[i+1]!,-1.75),at(outer[i+1]!,1.75),at(outer[i]!,1.75));
  quad(at(inner[i]!,1.75),at(inner[i+1]!,1.75),at(inner[i+1]!,-1.75),at(inner[i]!,-1.75));
  quad(at(outer[i]!,-1.75),at(inner[i]!,-1.75),at(inner[i+1]!,-1.75),at(outer[i+1]!,-1.75));
  quad(at(outer[i]!,1.75),at(outer[i+1]!,1.75),at(inner[i+1]!,1.75),at(inner[i]!,1.75));
 }
 quad(at(outer[0]!,-1.75),at(outer[0]!,1.75),at(inner[0]!,1.75),at(inner[0]!,-1.75));
 quad(at(outer[4]!,-1.75),at(inner[4]!,-1.75),at(inner[4]!,1.75),at(outer[4]!,1.75));
 return{kind:'triangle-mesh',positions,normals,indices};
}
/** Render details follow the existing physical truck and wheels. */
export function serviceVisuals():SnowServicePart[]{
 if(cache)return cache;const entities:EntitySpec[]=[];
 const add=(id:string,p:Vec3,mesh:Primitive,material:MaterialSpec=paint,rotation?:Vec3)=>entities.push({id,position:p,mesh,material,...(rotation?{rotation}:{})});
 const box=(id:string,p:Vec3,size:Vec3,material:MaterialSpec=paint,rotation?:Vec3)=>add(id,p,{kind:'box',size},material,rotation);
 add('cab',[1.8,.75,0],{kind:'polygon-prism',axis:2,thickness:2.2,points:[[-1.05,-.8],[1.05,-.8],[1.05,.1],[.84,.7],[.64,.8],[-.87,.8],[-1.05,.62]]});
 box('windscreen',[2.735,1.18,0],[.04,.55,1.9],pane,[0,0,.337]);
 box('frame',[-.25,-.25,0],[6.4,.32,1.3],steel);
 box('deck',[-1.3,.35,0],[3.6,.22,2.4]);
 for(const side of [-1,1]){
  box('bed'+side,[-1.3,.9,side*1.12],[3.6,1,.12]);
  box('rail'+side,[-1.3,1.43,side*1.14],[3.7,.09,.14],steel);
  for(let n=0;n<4;n++)box('rib'+side+':'+n,[-2.85+n*.95,.9,side*1.21],[.07,1,.06],steel);
  box('side-glass'+side,[1.72,1.13,side*1.115],[1.45,.59,.035],pane);
  box('window-divider'+side,[1.45,1.13,side*1.14],[.055,.63,.045],steel);
  box('door-handle'+side,[1.16,.60,side*1.15],[.22,.04,.055],steel);
  box('step'+side,[1.45,-.19,side*1.23],[1.55,.14,.35],steel);
  box('mirror-arm'+side,[2.57,1.23,side*1.28],[.07,.06,.34],steel);
  box('mirror'+side,[2.56,1.31,side*1.45],[.13,.32,.21],steel);
  box('fender-front'+side,[2.05,-.05,side*1.13],[1.34,.17,.23],steel);
  box('fender-rear'+side,[-1.9,-.06,side*1.13],[1.38,.14,.27],steel);
  box('mudflap'+side,[-2.59,-.59,side*1.07],[.10,.45,.45],{kind:'rubber',color:[.04,.045,.05,1],roughness:.95});
  box('headlamp'+side,[2.91,.28,side*.85],[.10,.22,.34],{kind:'default',color:[1,.9,.62,1],emissive:[1.2,1.04,.75],roughness:.4});
  box('rear-lamp'+side,[-3.16,.10,side*.92],[.06,.17,.25],{kind:'default',color:[.65,.035,.012,1],emissive:[.5,.012,0],roughness:.45});
 }
 box('tailgate',[-3.02,.9,0],[.16,1,2.24]);
 box('front-bumper',[3.05,-.13,0],[.24,.25,2.5],steel);box('rear-bumper',[-3.12,-.2,0],[.16,.2,2.4],steel);
 box('grille',[2.88,.28,0],[.04,.47,1.25],{kind:'default',color:[.035,.045,.05,1],roughness:.8});
 for(let n=0;n<5;n++)box('grille-slat'+n,[2.915,.08+n*.09,0],[.025,.025,1.21],steel);
 const blade:MaterialSpec={kind:'steel',color:[.94,.53,.025,1],treatment:'painted',metalness:.1,roughness:.6};
 add('blade',[3.9,-.6,0],curvedBlade(),blade);
 box('cutting-edge',[3.79,-1.07,0],[.16,.12,3.58],steel);box('blade-arm',[3.25,-.52,0],[1.2,.16,.3],steel);
 box('beacon-mount',[1.7,1.61,0],[.76,.1,.34],steel);
 for(const side of [-1,1])add('beacon'+side,[1.7,1.77,side*.23],{kind:'cylinder',radius:.105,height:.23,segments:16},{kind:'default',color:[1,.55,.02,1],emissive:[1.2,.48,.01],roughness:.3});
 const result:SnowServicePart[]=batchStaticScenery(entities,()=>true,100).map(e=>({id:e.id,p:e.position!,mesh:freezePrimitive(e.mesh!),material:e.material!}));
 for(let i=0;i<4;i++){
  const wheel=detailedRoadWheelMeshes({radius:.52,width:.36,rimRatio:.61,spokes:8,dish:.035},i%2?1:-1);
  for(const name of ['tire','rim'] as const)result.push({id:name+i,p:[i<2?2.05:-1.9,-.75,i%2?1.08:-1.08],wheel:i,axisZ:true,mesh:freezePrimitive(wheel[name]!),material:name==='tire'?{kind:'rubber',color:[.04,.045,.05,1],roughness:.87,pattern:'rubber'}:{kind:'steel',color:[.48,.50,.51,1],roughness:.38,metalness:.8}});
 }
 return cache=result;
}

/** Integrate the rendered mound to the actual payload volume. */
export function snowLoadMesh(volume:number):Primitive{
 const nx=12,nz=8,width=3.3,depth=2.02,positions=[],normals=[],indices=[],shape:number[]=[];
 for(let z=0;z<=nz;z++)for(let x=0;x<=nx;x++)shape.push(Math.sin(x/nx*Math.PI)*Math.sin(z/nz*Math.PI));
 let integral=0;
 for(let z=0;z<nz;z++)for(let x=0;x<nx;x++){const a=z*(nx+1)+x,b=a+1,c=a+nx+1;indices.push(a,c,b,b,c,c+1);for(const tri of [[a,c,b],[b,c,c+1]])integral+=width/nx*depth/nz*.5*(shape[tri[0]!]!+shape[tri[1]!]!+shape[tri[2]!]!)/3;}
 const height=volume/integral;
 for(let z=0;z<=nz;z++)for(let x=0;x<=nx;x++){
  const u=x/nx,v=z/nz,dx=-height*Math.PI/width*Math.cos(u*Math.PI)*Math.sin(v*Math.PI),dz=-height*Math.PI/depth*Math.sin(u*Math.PI)*Math.cos(v*Math.PI),length=Math.hypot(dx,1,dz);
  positions.push((u-.5)*width,shape[z*(nx+1)+x]!*height,(v-.5)*depth);normals.push(dx/length,1/length,dz/length);
 }
 return freezePrimitive({kind:'triangle-mesh',positions,normals,indices},true);
}
