import type {Vec3} from '../math.js';

/** Forward lighting bins are in world space, so reflection and main passes agree.
 * A large mesh is lit at each fragment; its origin never selects its lights. */
export const LIGHT_GRID_SIDE=32;
export const LIGHT_GRID_CELL=8;
export const LIGHTS_PER_CELL=16;
export const MAX_RENDER_LIGHTS=256;
export interface RenderLight {position:Vec3;light?:{color?:Vec3;intensity?:number;range?:number}}
export function buildLightGrid(sources:readonly RenderLight[],eye:Vec3):{lights:Float32Array;cells:Uint32Array;count:number;overflow:number}{
 const originX=(Math.floor(eye[0]/LIGHT_GRID_CELL)-LIGHT_GRID_SIDE/2)*LIGHT_GRID_CELL;
 const originZ=(Math.floor(eye[2]/LIGHT_GRID_CELL)-LIGHT_GRID_SIDE/2)*LIGHT_GRID_CELL;
 const ranked=sources.filter(s=>s.light&&(s.light.intensity??1)>0).map((s,index)=>{
  const r=s.light!.range??12;const d=Math.hypot(s.position[0]-eye[0],s.position[1]-eye[1],s.position[2]-eye[2]);
  return{s,index,score:(s.light!.intensity??1)*r*r/Math.max(1,d*d)};
 }).sort((a,b)=>b.score-a.score||a.index-b.index);
 const selected=ranked.slice(0,MAX_RENDER_LIGHTS),lights=new Float32Array(4+MAX_RENDER_LIGHTS*8);
 lights.set([originX,originZ,LIGHT_GRID_CELL,LIGHT_GRID_SIDE]);
 const bins:Array<Array<{index:number;score:number}>>=Array.from({length:LIGHT_GRID_SIDE**2},()=>[]);
 selected.forEach(({s},index)=>{
  const l=s.light!,range=l.range??12;lights.set([...s.position,range,...(l.color??[1,.78,.5]),l.intensity??1],4+index*8);
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
struct PointSource { position:vec4<f32>, color:vec4<f32> }
struct LightGrid { bounds:vec4<f32>, sources:array<PointSource,256> }
@group(1) @binding(5) var<storage,read> lightGrid:LightGrid;
@group(1) @binding(6) var<storage,read> lightCells:array<u32>;
fn lightCell(p:vec3<f32>)->u32{
 let c=vec2<i32>(floor((p.xz-lightGrid.bounds.xy)/lightGrid.bounds.z));
 if(any(c<vec2<i32>(0))||any(c>=vec2<i32>(32))){return 0xffffffffu;}
 return u32(c.y*32+c.x)*17u;
}
`;
