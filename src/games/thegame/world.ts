import type {CharacterWorld} from '../../runtime/character-motor.js';
/** Reduced, explicitly new world revision of thegame, not a compatible legacy save.
 * Hash, noise, climate blending, hub dimensions and highway curves come from
 * Pom4H/thegame biomes.ts c6a4516b665b and shared/math.ts 87384a931250. */
export const WORLD_REVISION='thegame-lite/2';
export const CHUNK_SIZE=128,TERRAIN_STEP=8,SEA_LEVEL=-.35,WORLD_LIMIT=1_000_000;
export type Biome='city'|'suburbs'|'grassland'|'forest'|'mountains'|'desert'|'coast'|'ocean';
export const BIOME_NAMES:Record<Biome,string>={city:'Город',suburbs:'Пригороды',grassland:'Поля',forest:'Лес',mountains:'Горы',desert:'Сухие земли',coast:'Побережье',ocean:'Океан'};
export type RGB=readonly [number,number,number];
const clamp=(v:number,a:number,b:number)=>Math.max(a,Math.min(b,v)),lerp=(a:number,b:number,t:number)=>a+(b-a)*t;
export function hash32(a:number,b=0,c=0,seed=29):number{let h=(seed^Math.imul(a|0,0x85ebca6b)^Math.imul(b|0,0xc2b2ae35)^Math.imul(c|0,0x27d4eb2f))>>>0;h^=h>>>16;h=Math.imul(h,0x7feb352d)>>>0;h^=h>>>15;h=Math.imul(h,0x846ca68b)>>>0;h^=h>>>16;return h>>>0;}
export const hash01=(a:number,b=0,c=0,seed=29)=>hash32(a,b,c,seed)/0xffffffff;
const ease=(a:number,b:number,v:number)=>{const t=clamp((v-a)/(b-a),0,1);return t*t*(3-2*t);},fract=(v:number)=>v-Math.floor(v);
function noise(seed:number,x:number,z:number,scale:number,salt=0):number{const px=x/scale,pz=z/scale,ix=Math.floor(px),iz=Math.floor(pz),u=ease(0,1,fract(px)),v=ease(0,1,fract(pz));return lerp(lerp(hash01(ix,iz,salt,seed),hash01(ix+1,iz,salt,seed),u),lerp(hash01(ix,iz+1,salt,seed),hash01(ix+1,iz+1,salt,seed),u),v);}
export const PALETTE:Record<Biome,RGB>={city:[.43,.45,.42],suburbs:[.39,.45,.30],grassland:[.45,.49,.28],forest:[.24,.34,.18],mountains:[.43,.43,.37],desert:[.68,.53,.34],coast:[.73,.66,.46],ocean:[.12,.30,.36]};
const natural:Biome[]=['forest','grassland','mountains','desert','coast'];
function region(seed:number,cx:number,cz:number):Biome{if(cx>=0&&cx<=2&&cz>=-2&&cz<=2)return cx>=1?'ocean':'coast';if(cx===-1&&cz===-1)return 'mountains';if(cx===-1&&cz===0)return 'forest';if(cx===-1&&cz===1)return 'grassland';if(cx===-2&&cz===1)return 'desert';return natural[hash32(cx,cz,781,seed)%natural.length]!;}
export function climateAt(seed:number,x:number,z:number):{biome:Biome;weights:Record<Biome,number>;color:RGB}{
 const wx=x+(noise(seed,x,z,2000,77)-.5)*290,wz=z+(noise(seed,x,z,2000,78)-.5)*290;
 const sx=wx/1200-.5,sz=wz/1200-.5,ix=Math.floor(sx),iz=Math.floor(sz),u=ease(0,1,fract(sx)),v=ease(0,1,fract(sz));
 const weights:Record<Biome,number>={city:0,suburbs:0,grassland:0,forest:0,mountains:0,desert:0,coast:0,ocean:0};
 for(const [dx,dz,w] of [[0,0,(1-u)*(1-v)],[1,0,u*(1-v)],[0,1,(1-u)*v],[1,1,u*v]] as const)weights[region(seed,ix+dx,iz+dz)]+=w;
 const r=Math.max(Math.abs(x),Math.abs(z)),fade=ease(400,800,r);let biome:Biome='city';const color:[number,number,number]=[0,0,0];
 for(const key of Object.keys(weights) as Biome[])weights[key]*=fade;
 weights.suburbs=1-fade;if(r<384){for(const key of Object.keys(weights) as Biome[])weights[key]=0;weights.city=1;}
 for(const key of Object.keys(weights) as Biome[]){if(weights[key]>weights[biome])biome=key;for(let i=0;i<3;i++)color[i]!+=PALETTE[key][i]!*weights[key];}
 return {biome,weights,color};
}
export function roadCenter(seed:number,axis:'e'|'n',k:number,t:number):{x:number;z:number;width:number}{
 const phase=k===0?0:hash01(k,axis==='e'?4:5,0,seed)*Math.PI*2,e=ease(384,660,Math.abs(t));
 if(axis==='e'){let z=k*1536+e*(80*Math.sin(t/550+phase)+28*Math.sin(t/1630+phase));if(k===0){const bypass=ease(408,480,-t)*(1-ease(1120,1400,-t));z=lerp(z,120,bypass);}return {x:t,z,width:12};}
 return {x:k*1536-256+e*(55*Math.sin(t/680+phase)+45*Math.sin(t/1730+phase)),z:t,width:9};
}
export function roadDistance(seed:number,x:number,z:number):number{
 if(Math.max(Math.abs(x),Math.abs(z))<384)return Math.min(Math.abs(x-Math.round(x/64)*64),Math.abs(z-Math.round(z/64)*64));
 let best=Infinity;for(const axis of ['e','n'] as const){const base=Math.round(axis==='e'?z/1536:(x+256)/1536);for(let k=base-1;k<=base+1;k++){const p=roadCenter(seed,axis,k,axis==='e'?x:z);best=Math.min(best,Math.hypot(x-p.x,z-p.z));}}return best;
}
export interface CityLamp {readonly id:string;readonly poleX:number;readonly poleZ:number;readonly x:number;readonly y:number;readonly z:number}
/** One semantic placement feeds both fixture geometry and light entities. */
export function cityLamps(cx:number,cz:number):readonly CityLamp[]{
 if(cx<-3||cx>=3||cz<-3||cz>=3)return [];
 const ox=cx*CHUNK_SIZE,oz=cz*CHUNK_SIZE,out:CityLamp[]=[];
 for(let row=0;row<2;row++)for(let col=0;col<4;col++){
  // 32 m longitudinal spacing puts useful pools of light between intersections;
  // still <=192 resident city lights at the default 7x7 view.
  const poleX=ox+col*32+9,poleZ=oz+row*64+9;
  out.push({id:`lamp:${cx}:${cz}:${row}:${col}`,poleX,poleZ,x:poleX,y:5.34,z:poleZ-1.75});
 }
 return out;
}
export interface WorldProp{readonly id:string;readonly kind:'building'|'tree';readonly x:number;readonly y:number;readonly z:number;readonly width:number;readonly depth:number;readonly height:number;readonly color:RGB}
export interface WorldChunk{readonly x:number;readonly z:number;readonly key:string;readonly heights:Float64Array;readonly props:readonly WorldProp[]}
/** CPU residency is capped independently of render residency and peer count. */
export class OpenWorld implements CharacterWorld {
 private readonly chunks=new Map<string,WorldChunk>();
 readonly stats={generated:0,evicted:0};
 constructor(readonly seed=29,readonly capacity=128){if(!Number.isSafeInteger(seed)||seed<0||seed>0xffffffff||!Number.isSafeInteger(capacity)||capacity<4||capacity>1024)throw new RangeError('Invalid world configuration');}
 vertexHeight(x:number,z:number):number{
  const radius=Math.max(Math.abs(x),Math.abs(z));if(radius<=384)return 0;
  const w=climateAt(this.seed,x,z).weights,n=noise(this.seed,x,z,650,41)*.64+noise(this.seed,x,z,220,42)*.25+noise(this.seed,x,z,70,43)*.11;
  const height=(n-.42)*(12+w.mountains*220)+w.mountains*35-w.coast*3-w.ocean*24;
  const shoulder=1-ease(5,22,roadDistance(this.seed,x,z)),road=(noise(this.seed,x,z,900,41)-.45)*5;
  return lerp(height,Math.max(0,road),shoulder)*ease(384,640,radius);
 }
 chunk(cx:number,cz:number):WorldChunk{
  if(!Number.isSafeInteger(cx)||!Number.isSafeInteger(cz)||Math.abs(cx)>8000||Math.abs(cz)>8000)throw new RangeError('World coordinate out of range');
  const key=cx+':'+cz,cached=this.chunks.get(key);if(cached){this.chunks.delete(key);this.chunks.set(key,cached);return cached;}
  const heights=new Float64Array(17*17);for(let z=0;z<=16;z++)for(let x=0;x<=16;x++)heights[z*17+x]=this.vertexHeight(cx*128+x*8,cz*128+z*8);
  const heightAt=(x:number,z:number)=>{const u=(x-cx*128)/8,v=(z-cz*128)/8,ix=Math.floor(u),iz=Math.floor(v),fx=u-ix,fz=v-iz,a=heights[iz*17+ix]!,b=heights[iz*17+ix+1]!,c=heights[(iz+1)*17+ix]!,d=heights[(iz+1)*17+ix+1]!;return fx+fz<=1?a+(b-a)*fx+(c-a)*fz:d+(d-c)*(fx-1)+(d-b)*(fz-1);};
  const props:WorldProp[]=[];
  for(let dz=0;dz<2;dz++)for(let dx=0;dx<2;dx++){
   const gx=cx*2+dx,gz=cz*2+dz,x=gx*64+32,z=gz*64+32,r=Math.max(Math.abs(x),Math.abs(z));
   if(r>=640||r>=384&&hash01(gx,gz,2,this.seed)<.65||roadDistance(this.seed,x,z)<22)continue;
   // Dense inner-city blocks form a continuous street wall while retaining a narrow
   // canonical sidewalk outside the 12 m road. One physical building remains one prop.
   const urban=r<384,width=urban?48+hash01(gx,gz,3,this.seed)*2:14,depth=urban?48+hash01(gx,gz,4,this.seed)*2:14;
   const h=urban?14+Math.floor(hash01(gx,gz,5,this.seed)*5)*3.4:5;
   const color=([[.76,.69,.56],[.63,.68,.66],[.72,.47,.35],[.78,.77,.68]] as const)[hash32(gx,gz,6,this.seed)%4]!;
   props.push({id:`building:${gx}:${gz}`,kind:'building',x,y:heightAt(x,z),z,width,depth,height:h,color});
  }
  for(let i=0;i<12;i++){
   const x=cx*128+8+hash01(cx,cz,100+i*3,this.seed)*112,z=cz*128+8+hash01(cx,cz,101+i*3,this.seed)*112,w=climateAt(this.seed,x,z),y=heightAt(x,z);
   if(y<0||w.biome==='desert'||w.biome==='mountains'||w.biome==='ocean'||i>(w.biome==='forest'?11:3)||roadDistance(this.seed,x,z)<12||props.some(p=>Math.abs(p.x-x)<p.width/2+5&&Math.abs(p.z-z)<p.depth/2+5))continue;
   props.push({id:`tree:${cx}:${cz}:${i}`,kind:'tree',x,y,z,width:.75,depth:.75,height:5+hash01(cx,cz,102+i*3,this.seed)*5,color:[.20,.34+hash01(cx,cz,i,this.seed)*.12,.18]});
  }
  const chunk={x:cx,z:cz,key,heights,props};this.chunks.set(key,chunk);this.stats.generated++;
  while(this.chunks.size>this.capacity){this.chunks.delete(this.chunks.keys().next().value!);this.stats.evicted++;}return chunk;
 }
 /** Exactly the same diagonal/triangles as the rendered global 8 m grid, not bilinear hills. */
 ground(x:number,z:number):{y:number;normal:readonly [number,number,number]}{
  const gx=Math.floor(x/8),gz=Math.floor(z/8),cx=Math.floor(gx/16),cz=Math.floor(gz/16),chunk=this.chunk(cx,cz);
  const ix=gx-cx*16,iz=gz-cz*16,u=x/8-gx,v=z/8-gz,h=chunk.heights,a=h[iz*17+ix]!,b=h[iz*17+ix+1]!,c=h[(iz+1)*17+ix]!,d=h[(iz+1)*17+ix+1]!;
  const dx=u+v<=1?b-a:d-c,dz=u+v<=1?c-a:d-b,y=u+v<=1?a+dx*u+dz*v:d+dx*(u-1)+dz*(v-1),len=Math.hypot(dx/8,1,dz/8);
  return {y,normal:[-dx/8/len,1/len,-dz/8/len]};
 }
 private *nearby(x:number,z:number,radius:number):Generator<WorldProp>{for(let cz=Math.floor((z-radius)/128);cz<=Math.floor((z+radius)/128);cz++)for(let cx=Math.floor((x-radius)/128);cx<=Math.floor((x+radius)/128);cx++)yield* this.chunk(cx,cz).props;}
 blocked(x:number,y:number,z:number,height:number,radius:number):boolean{
  if(Math.abs(x)>WORLD_LIMIT||Math.abs(z)>WORLD_LIMIT)return true;
  for(const p of this.nearby(x,z,radius)){if(y+height<=p.y+.01||y>=p.y+p.height-.005)continue;const dx=Math.max(0,Math.abs(x-p.x)-p.width/2),dz=Math.max(0,Math.abs(z-p.z)-p.depth/2);if(dx*dx+dz*dz<radius*radius)return true;}return false;
 }
 floor(x:number,y:number,z:number,range:number):{y:number;normal:readonly [number,number,number]}|null{
  let ground=this.ground(x,z);
  // Lite ocean traversal is wading/swimming on the water surface; no underwater gameplay.
  if(ground.y<SEA_LEVEL)ground={y:SEA_LEVEL,normal:[0,1,0]};
  for(const p of this.nearby(x,z,0))if(p.kind==='building'&&Math.abs(x-p.x)<p.width/2&&Math.abs(z-p.z)<p.depth/2&&p.y+p.height<=y+.001&&p.y+p.height>ground.y)ground={y:p.y+p.height,normal:[0,1,0]};
  return ground.y<=y+.001&&ground.y>=y-range?ground:null;
 }
 spawn(slot=0):{x:number;y:number;z:number}{
  for(let i=0;i<64;i++){const x=-345-Math.floor((slot+i)/16)*2.2,z=-66-((slot+i)%16)*2.2,y=Math.max(SEA_LEVEL,this.ground(x,z).y);if(!this.blocked(x,y,z,1.8,.29))return {x,y,z};}throw new Error('No clear spawn');
 }
 inspect(){return {seed:this.seed,revision:WORLD_REVISION,chunks:this.chunks.size,capacity:this.capacity,...this.stats};}
 dispose():void{this.chunks.clear();}
}
