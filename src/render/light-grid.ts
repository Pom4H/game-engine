import type {Vec3} from '../math.js';
import {V3} from '../math.js';
import type {LightSpec,LightEmissionSpec} from '../scene/types.js';

/** Forward lighting bins are in world space, so reflection and main passes agree.
 * A large mesh is lit at each fragment; its origin never selects its lights. */
export const LIGHT_GRID_SIDE=32;
export const LIGHT_GRID_CELL=8;
export const LIGHTS_PER_CELL=16;
export const MAX_RENDER_LIGHTS=256;
export const LIGHT_SOURCE_FLOATS=20;
export interface RenderLight {position:Vec3;light?:LightSpec}
const smooth=(a:number,b:number,x:number)=>{const t=Math.max(0,Math.min(1,(x-a)/(b-a)));return t*t*(3-2*t);};
/** The cap blocks upward emission; ribs attenuate rays between glass panes. */
export function lightEmissionWeight(profile:LightEmissionSpec|undefined,fromLight:Vec3):number{
 if(!profile)return 1;
 if(profile.boxHalfSize){
  const [hx,hy,hz]=profile.boxHalfSize,a=profile.panelRotation??0,c=Math.cos(a),s=Math.sin(a);
  const x=c*fromLight[0]+s*fromLight[2],y=fromLight[1],z=-s*fromLight[0]+c*fromLight[2];
  const tx=hx/Math.max(Math.abs(x),1e-8),ty=hy/Math.max(Math.abs(y),1e-8),tz=hz/Math.max(Math.abs(z),1e-8),t=Math.min(tx,tz);
  if(ty<=t)return 0;
  const gap=Math.min(hy-Math.abs(y*t),tx<tz?hz-Math.abs(z*t):hx-Math.abs(x*t)),width=profile.frameWidthM??.015;
  return width>0?smooth(width*.5,width*1.5,gap):1;
 }
 const axis=V3.normalize(profile.axis),direction=V3.normalize(fromLight);
 const polar=smooth(Math.cos(profile.outerAngle),Math.cos(profile.innerAngle),V3.dot(axis,direction));
 const count=profile.panelCount??0,width=profile.frameWidth??0;
 if(count<2||width<=0)return polar;
 const tangent=V3.normalize(V3.cross(axis,Math.abs(axis[1])>.9?[0,0,1]:[0,1,0])),bitangent=V3.cross(axis,tangent);
 const x=V3.dot(direction,tangent),y=V3.dot(direction,bitangent),period=2*Math.PI/count;
 const angle=Math.atan2(y,x)-(profile.panelRotation??0),wrapped=((angle+period*.5)%period+period)%period-period*.5;
 const rib=smooth(width*.5,width*1.5,Math.abs(wrapped)),radial=smooth(.04,.18,Math.hypot(x,y));
 return polar*(1-radial*(1-rib));
}
export function buildLightGrid(sources:readonly RenderLight[],eye:Vec3,shadowSlots:ReadonlyMap<RenderLight,number>=new Map()):{lights:Float32Array;cells:Uint32Array;count:number;overflow:number}{
 const originX=(Math.floor(eye[0]/LIGHT_GRID_CELL)-LIGHT_GRID_SIDE/2)*LIGHT_GRID_CELL;
 const originZ=(Math.floor(eye[2]/LIGHT_GRID_CELL)-LIGHT_GRID_SIDE/2)*LIGHT_GRID_CELL;
 const ranked=sources.filter(s=>s.light&&(s.light.intensity??1)>0).map((s,index)=>{
  const r=s.light!.range??12;const d=Math.hypot(s.position[0]-eye[0],s.position[1]-eye[1],s.position[2]-eye[2]);
  return{s,index,score:(s.light!.intensity??1)*r*r/Math.max(1,d*d)};
 }).sort((a,b)=>b.score-a.score||a.index-b.index);
 const selected=ranked.slice(0,MAX_RENDER_LIGHTS),lights=new Float32Array(4+MAX_RENDER_LIGHTS*LIGHT_SOURCE_FLOATS);
 lights.set([originX,originZ,LIGHT_GRID_CELL,LIGHT_GRID_SIDE]);
 const bins:Array<Array<{index:number;score:number}>>=Array.from({length:LIGHT_GRID_SIDE**2},()=>[]);
 selected.forEach(({s},index)=>{
  const l=s.light!,range=l.range??12,p=l.emission,offset=4+index*LIGHT_SOURCE_FLOATS;lights.set([...s.position,range,...(l.color??[1,.78,.5]),l.intensity??1],offset);
  if(p){lights.set([...V3.normalize(p.axis),Math.cos(p.outerAngle)],offset+8);lights.set([Math.cos(p.innerAngle),p.panelCount??0,p.panelRotation??0,p.frameWidth??0],offset+12);}
  if(p?.boxHalfSize)lights.set([...p.boxHalfSize,p.frameWidthM??.015],offset+16);
  else if(shadowSlots.has(s))lights[offset+19]=shadowSlots.get(s)!+1;
  const minX=Math.max(0,Math.floor((s.position[0]-range-originX)/LIGHT_GRID_CELL)),maxX=Math.min(LIGHT_GRID_SIDE-1,Math.floor((s.position[0]+range-originX)/LIGHT_GRID_CELL));
  const minZ=Math.max(0,Math.floor((s.position[2]-range-originZ)/LIGHT_GRID_CELL)),maxZ=Math.min(LIGHT_GRID_SIDE-1,Math.floor((s.position[2]+range-originZ)/LIGHT_GRID_CELL));
  for(let z=minZ;z<=maxZ;z++)for(let x=minX;x<=maxX;x++){
   const dx=Math.max(0,Math.abs(s.position[0]-(originX+(x+.5)*LIGHT_GRID_CELL))-LIGHT_GRID_CELL/2);
   const dz=Math.max(0,Math.abs(s.position[2]-(originZ+(z+.5)*LIGHT_GRID_CELL))-LIGHT_GRID_CELL/2);
   if(dx*dx+dz*dz>range*range)continue;
   bins[z*LIGHT_GRID_SIDE+x]!.push({index,score:(l.intensity??1)*Math.pow(1-Math.hypot(dx,dz)/range,2)});
  }
 });
 const cells=new Uint32Array(LIGHT_GRID_SIDE**2*(LIGHTS_PER_CELL+1));let overflow=Math.max(0,ranked.length-MAX_RENDER_LIGHTS);
 bins.forEach((bin,i)=>{bin.sort((a,b)=>b.score-a.score||a.index-b.index);const n=Math.min(LIGHTS_PER_CELL,bin.length),offset=i*(LIGHTS_PER_CELL+1);cells[offset]=n;for(let j=0;j<n;j++)cells[offset+1+j]=bin[j]!.index;overflow+=Math.max(0,bin.length-n);});
 return{lights,cells,count:selected.length,overflow};
}
export const LIGHT_GRID_WGSL=`
struct PointSource { position:vec4<f32>, color:vec4<f32>, axis:vec4<f32>, shape:vec4<f32>, housing:vec4<f32> }
struct LightGrid { bounds:vec4<f32>, sources:array<PointSource,256> }
@group(1) @binding(5) var<storage,read> lightGrid:LightGrid;
@group(1) @binding(6) var<storage,read> lightCells:array<u32>;
fn emissionWeight(source:PointSource,fromLight:vec3<f32>)->f32{
 if(source.housing.x>0.0){
  let c=cos(source.shape.z);let s=sin(source.shape.z);
  let local=vec3<f32>(c*fromLight.x+s*fromLight.z,fromLight.y,-s*fromLight.x+c*fromLight.z);
  let hit=source.housing.xyz/max(abs(local),vec3<f32>(.00000001));let t=min(hit.x,hit.z);
  if(hit.y<=t){return 0.0;}
  let gap=min(source.housing.y-abs(local.y*t),select(source.housing.x-abs(local.x*t),source.housing.z-abs(local.z*t),hit.x<hit.z));
  if(source.housing.w<=0.0){return 1.0;}
  return smoothstep(source.housing.w*.5,source.housing.w*1.5,gap);
 }
 if(dot(source.axis.xyz,source.axis.xyz)<.5){return 1.0;}
 let direction=fromLight/max(length(fromLight),.0001);
 let polar=smoothstep(source.axis.w,source.shape.x,dot(source.axis.xyz,direction));
 if(source.shape.y<2.0||source.shape.w<=0.0){return polar;}
 var reference=vec3<f32>(0,1,0);if(abs(source.axis.y)>.9){reference=vec3<f32>(0,0,1);}
 let tangent=normalize(cross(source.axis.xyz,reference));let bitangent=cross(source.axis.xyz,tangent);
 let xy=vec2<f32>(dot(direction,tangent),dot(direction,bitangent));let period=6.2831853/source.shape.y;
 let angle=atan2(xy.y,xy.x)-source.shape.z;let wrapped=angle-period*floor((angle+period*.5)/period);
 let rib=smoothstep(source.shape.w*.5,source.shape.w*1.5,abs(wrapped));
 return polar*mix(1.0,rib,smoothstep(.04,.18,length(xy)));
}
fn lightCell(p:vec3<f32>)->u32{
 let c=vec2<i32>(floor((p.xz-lightGrid.bounds.xy)/lightGrid.bounds.z));
 if(any(c<vec2<i32>(0))||any(c>=vec2<i32>(32))){return 0xffffffffu;}
 return u32(c.y*32+c.x)*17u;
}
`;
