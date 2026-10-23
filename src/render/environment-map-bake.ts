import {V3,type Vec3} from '../math.js';
import {shBasis} from './irradiance.js';
import type {EnvironmentMapInput,EnvironmentMapData} from './environment-map.js';
import type {RadianceProxy} from './radiance.js';
type Proxy={dir:Vec3;color:readonly[number,number,number];threshold:number;strength:number};
const BAND_SCALE=[Math.PI,2*Math.PI/3,2*Math.PI/3,2*Math.PI/3,Math.PI/4,Math.PI/4,Math.PI/4,Math.PI/4,Math.PI/4] as const;
const directionsCache=new Map<number,Float64Array>(),EMPTY:readonly Proxy[]=[];
const halfFloatScratch=new Float32Array(1),halfFloatBits=new Uint32Array(halfFloatScratch.buffer);
const enum Phase{Start,Copy,SHBase,SHProxy,SHFinish,SHBands,SHPack,Mip,Directions,TileBase,TileProxy,Pixels,PixelProxy,PixelPack,Complete,Cancelled}
function mix(a:number,b:number,t:number){return a+(b-a)*t;}
function cubeDirection(face:number,u:number,v:number):Vec3{const raw:Vec3=face===0?[1,-v,-u]:face===1?[-1,-v,u]:face===2?[u,1,v]:face===3?[u,-1,-v]:face===4?[u,-v,1]:[-u,-v,-1];return V3.normalize(raw);}
function float16(value:number):number{
 if(!Number.isFinite(value))return value<0?0xfc00:0x7c00;
 halfFloatScratch[0]=value;const x=halfFloatBits[0]!,sign=(x>>>16)&0x8000,exp=((x>>>23)&0xff)-127+15,mantissa=x&0x7fffff;
 if(exp<=0){if(exp<-10)return sign;return sign|((mantissa|0x800000)>>(14-exp));}if(exp>=31)return sign|0x7c00;return sign|(exp<<10)|(mantissa>>13);
}
/** Exact F64 phase state for private worker-owned input. No generator/iterator
 * allocation per operation; no partial result or private direction view escapes. */
export class EnvironmentBakeCursor{
 private input:EnvironmentMapInput|undefined;private phase=Phase.Start;private result:EnvironmentMapData|undefined;
 private proxySource:readonly RadianceProxy[]|undefined;private proxies:Proxy[]=[];private copyAt=0;private proxyCount=0;
 private sun:Vec3|undefined;private sunColor:Vec3|undefined;private sky:Vec3|undefined;private urbanColor:Vec3|undefined;private groundColor:Vec3|undefined;private intensity=0;
 private readonly coefficients=new Float64Array(27);private readonly irradiance=new Float32Array(36);
 private readonly solidAngle=4*Math.PI/512;private readonly goldenAngle=Math.PI*(3-Math.sqrt(5));
 private sample=0;private band=0;private shProxy=0;private shDirection:Vec3=[0,0,0];private basis:readonly number[]=[];private rgb:readonly number[]=[];
 private baseR=0;private baseG=0;private baseB=0;private pr=0;private pg=0;private pb=0;private total=0;
 private horizon:readonly number[]=[];private zenith:readonly number[]=[];private ground:readonly number[]=[];private urban:readonly number[]=[];private average:readonly number[]=[];
 private generated:Uint16Array[]=[];private mip=0;private size=0;private roughness=0;private pixels:Uint16Array|undefined;private directions:Float64Array|undefined;
 private face=0;private y=0;private x=0;private dirAt=0;private offset=0;
 private tileSide=0;private tileFace=0;private tileY=0;private tileX=0;private tileProxy=0;private tileCenter:Vec3=[0,0,0];private tileRadius=0;private tileCandidates:Proxy[]=[];private tiles:Proxy[][]|undefined;
 private sharp=0;private proxyGain=0;private exponent=0;private sunGain=0;private blur=0;
 private dx=0;private dy=0;private dz=0;private candidates:readonly Proxy[]=EMPTY;private pixelProxy=0;
 constructor(input:EnvironmentMapInput){this.input=input;}
 get done(){return this.phase===Phase.Complete;}
 get data(){if(!this.result)throw Error('Environment bake is not complete');return this.result;}
 /** A credit is ONE finite loop operation, not a batch. All variable loops
  * consume this same budget, including cold directions and proxy candidates. */
 step(maxOps:number):boolean{
  if(!Number.isSafeInteger(maxOps)||maxOps<1||maxOps>4096)throw RangeError('Environment bake work credit must be 1..4096');
  if(this.phase===Phase.Cancelled)throw Error('Environment bake is cancelled');if(this.done)return true;let left=maxOps;
  try{while(left>0&&!this.done){switch(this.phase){
   case Phase.Start:{const input=this.input!,radiance=input.radiance;this.urbanColor=radiance.background;this.groundColor=radiance.ground;this.proxySource=radiance.proxies;this.proxyCount=this.proxySource.length;this.proxies=new Array<Proxy>(this.proxyCount);this.sun=input.sun;this.sunColor=input.sunColor;this.sky=input.sky;this.intensity=input.intensity;this.input=undefined;this.phase=Phase.Copy;left--;break;}
   case Phase.Copy:{const end=Math.min(this.proxyCount,this.copyAt+left),source=this.proxySource!;left-=end-this.copyAt;for(;this.copyAt<end;this.copyAt++)if(this.copyAt in source){const p=source[this.copyAt]!;this.proxies[this.copyAt]={dir:p.direction,color:p.color,threshold:p.threshold,strength:p.strength};}if(this.copyAt===this.proxyCount){this.proxySource=undefined;this.phase=Phase.SHBase;}break;}
   case Phase.SHBase:{
    if(this.sample===512){this.band=0;this.phase=Phase.SHPack;break;}
    const sky=this.sky!,ground=this.groundColor!,urban=this.urbanColor!,y=1-2*(this.sample+.5)/512,r=Math.sqrt(Math.max(0,1-y*y)),phi=this.sample*this.goldenAngle,dir:Vec3=[Math.cos(phi)*r,y,Math.sin(phi)*r];this.shDirection=dir;
    const up=Math.max(dir[1],0),down=Math.max(-dir[1],0),t=Math.sqrt(up),urbanMix=Math.pow(Math.max(0,1-Math.abs(dir[1])),3)*.28;
    const r0=down>0?mix(sky[0]*1.22,ground[0]*.62,down):mix(sky[0]*1.22,sky[0]*.45,t),g0=down>0?mix(sky[1]*1.22,ground[1]*.62,down):mix(sky[1]*1.22,sky[1]*.45,t),b0=down>0?mix(sky[2]*1.22,ground[2]*.62,down):mix(sky[2]*1.22,sky[2]*.45,t);
    this.baseR=mix(r0,urban[0]*.78,urbanMix);this.baseG=mix(g0,urban[1]*.78,urbanMix);this.baseB=mix(b0,urban[2]*.78,urbanMix);this.pr=this.pg=this.pb=this.total=0;this.shProxy=0;this.phase=Phase.SHProxy;left--;break;
   }
   case Phase.SHProxy:{
    const end=Math.min(this.proxies.length,this.shProxy+left),dir=this.shDirection;let pr=this.pr,pg=this.pg,pb=this.pb,total=this.total;left-=end-this.shProxy;
    for(;this.shProxy<end;this.shProxy++){const proxy=this.proxies[this.shProxy]!,alignment=V3.dot(dir,proxy.dir);if(alignment<=proxy.threshold)continue;const q=(alignment-proxy.threshold)/Math.max(1e-5,1-proxy.threshold),weight=Math.pow(q,5.5)*proxy.strength;pr+=proxy.color[0]*weight;pg+=proxy.color[1]*weight;pb+=proxy.color[2]*weight;total+=weight;}
    this.pr=pr;this.pg=pg;this.pb=pb;this.total=total;if(this.shProxy===this.proxies.length)this.phase=Phase.SHFinish;break;
   }
   case Phase.SHFinish:{
    let r=this.baseR,g=this.baseG,b=this.baseB;if(this.total>.001){const amount=Math.min(.86,this.total/(.58+this.total));r=mix(r,this.pr/this.total,amount);g=mix(g,this.pg/this.total,amount);b=mix(b,this.pb/this.total,amount);}
    const dir=this.shDirection,sun=this.sun!,color=this.sunColor!,sunDot=Math.max(0,dir[0]*sun[0]+dir[1]*sun[1]+dir[2]*sun[2]),sunLobe=Math.pow(sunDot,900)*this.intensity;
    this.rgb=[r+color[0]*sunLobe,g+color[1]*sunLobe,b+color[2]*sunLobe];this.basis=shBasis(dir);this.band=0;this.phase=Phase.SHBands;left--;break;
   }
   case Phase.SHBands:{const end=Math.min(9,this.band+left),coefficients=this.coefficients,rgb=this.rgb,basis=this.basis;left-=end-this.band;for(;this.band<end;this.band++){const weight=basis[this.band]!*this.solidAngle*BAND_SCALE[this.band]!,offset=this.band*3;coefficients[offset]=coefficients[offset]!+rgb[0]!*weight;coefficients[offset+1]=coefficients[offset+1]!+rgb[1]!*weight;coefficients[offset+2]=coefficients[offset+2]!+rgb[2]!*weight;}if(this.band===9){this.sample++;this.phase=Phase.SHBase;}break;}
   case Phase.SHPack:{
    const end=Math.min(9,this.band+left);left-=end-this.band;for(;this.band<end;this.band++){this.irradiance[this.band*4]=this.coefficients[this.band*3]!;this.irradiance[this.band*4+1]=this.coefficients[this.band*3+1]!;this.irradiance[this.band*4+2]=this.coefficients[this.band*3+2]!;}
    if(this.band===9){this.irradiance[3]=1;const sky=this.sky!,urban=this.urbanColor!;this.horizon=sky.map(v=>v*1.22);this.zenith=[sky[0]*.45,sky[1]*.45,sky[2]*.45];this.ground=this.groundColor!.map(v=>v*.62);this.urban=urban.map(v=>v*.78);this.average=[mix(sky[0]*.62,urban[0]*.55,.22),mix(sky[1]*.66,urban[1]*.55,.22),mix(sky[2]*.72,urban[2]*.55,.22)];this.phase=Phase.Mip;}break;
   }
   case Phase.Mip:{
    if(this.mip===9){this.result={irradiance:this.irradiance,mips:this.generated};this.releaseWork();this.phase=Phase.Complete;break;}
    this.size=Math.max(1,256>>this.mip);this.roughness=this.mip/8;this.pixels=new Uint16Array(this.size*this.size*6*4);this.directions=directionsCache.get(this.size);this.face=this.x=this.y=this.dirAt=this.offset=0;
    this.sharp=mix(5.5,1.2,this.roughness*this.roughness);this.proxyGain=1-this.roughness*.62;this.exponent=mix(900,2.4,this.roughness*this.roughness);this.sunGain=this.intensity*mix(1.0,.12,this.roughness);this.blur=this.roughness*this.roughness*.68;this.tiles=undefined;this.tileSide=Math.ceil(this.size/16);this.tileFace=this.tileX=this.tileY=0;
    if(this.directions)this.phase=this.roughness<.74?Phase.TileBase:Phase.Pixels;else{this.directions=new Float64Array(this.size*this.size*6*3);this.phase=Phase.Directions;}left--;break;
   }
   case Phase.Directions:{
    const data=this.directions!,size=this.size;let face=this.face,y=this.y,x=this.x,at=this.dirAt;
    while(left>0&&face<6){const d=cubeDirection(face,((x+.5)/size)*2-1,((y+.5)/size)*2-1);data[at++]=d[0];data[at++]=d[1];data[at++]=d[2];left--;if(++x===size){x=0;if(++y===size){y=0;face++;}}}
    this.face=face;this.y=y;this.x=x;this.dirAt=at;if(face===6){directionsCache.set(size,data);this.face=this.x=this.y=this.dirAt=0;this.phase=this.roughness<.74?Phase.TileBase:Phase.Pixels;}break;
   }
   case Phase.TileBase:{
    if(this.tileFace===6){this.phase=Phase.Pixels;break;}
    this.tiles??=[];const size=this.size,x0=this.tileX*16,x1=Math.min(size,x0+16),y0=this.tileY*16,y1=Math.min(size,y0+16);this.tileCenter=cubeDirection(this.tileFace,(x0+x1)/size-1,(y0+y1)/size-1);this.tileRadius=Math.hypot((x1-x0)/size,(y1-y0)/size)+1e-12;this.tileCandidates=[];this.tileProxy=0;this.phase=Phase.TileProxy;left--;break;
   }
   case Phase.TileProxy:{
    const end=Math.min(this.proxies.length,this.tileProxy+left),center=this.tileCenter,radius=this.tileRadius,candidates=this.tileCandidates;left-=end-this.tileProxy;
    for(;this.tileProxy<end;this.tileProxy++){const proxy=this.proxies[this.tileProxy]!,dot=center[0]*proxy.dir[0]+center[1]*proxy.dir[1]+center[2]*proxy.dir[2],norm=Math.hypot(proxy.dir[0],proxy.dir[1],proxy.dir[2]);if(dot+radius*norm>proxy.threshold)candidates.push(proxy);}
    if(this.tileProxy===this.proxies.length){this.tiles!.push(candidates);if(++this.tileX===this.tileSide){this.tileX=0;if(++this.tileY===this.tileSide){this.tileY=0;this.tileFace++;}}this.phase=Phase.TileBase;}break;
   }
   case Phase.Pixels:left-=this.pixelBatch(left);break;
   case Phase.PixelProxy:{
    const end=Math.min(this.candidates.length,this.pixelProxy+left);let pr=this.pr,pg=this.pg,pb=this.pb,total=this.total;left-=end-this.pixelProxy;
    for(;this.pixelProxy<end;this.pixelProxy++){const proxy=this.candidates[this.pixelProxy]!,alignment=this.dx*proxy.dir[0]+this.dy*proxy.dir[1]+this.dz*proxy.dir[2];if(alignment<=proxy.threshold)continue;const q=(alignment-proxy.threshold)/Math.max(1e-5,1-proxy.threshold),weight=Math.pow(q,this.sharp)*proxy.strength*this.proxyGain;pr+=proxy.color[0]*weight;pg+=proxy.color[1]*weight;pb+=proxy.color[2]*weight;total+=weight;}
    this.pr=pr;this.pg=pg;this.pb=pb;this.total=total;if(this.pixelProxy===this.candidates.length)this.phase=Phase.PixelPack;break;
   }
   case Phase.PixelPack:{
    let r=this.baseR,g=this.baseG,b=this.baseB;if(this.total>.001){const amount=Math.min(.86,this.total/(.58+this.total));r=mix(r,this.pr/this.total,amount);g=mix(g,this.pg/this.total,amount);b=mix(b,this.pb/this.total,amount);}
    const sun=this.sun!,color=this.sunColor!,sunDot=Math.max(0,this.dx*sun[0]+this.dy*sun[1]+this.dz*sun[2]),lobe=Math.pow(sunDot,this.exponent)*this.sunGain,pixels=this.pixels!;
    pixels[this.offset++]=float16(mix(r+color[0]*lobe,this.average[0]!,this.blur));pixels[this.offset++]=float16(mix(g+color[1]*lobe,this.average[1]!,this.blur));pixels[this.offset++]=float16(mix(b+color[2]*lobe,this.average[2]!,this.blur));pixels[this.offset++]=float16(1);
    this.dirAt+=3;if(++this.x===this.size){this.x=0;if(++this.y===this.size){this.y=0;this.face++;}}this.phase=Phase.Pixels;if(this.face===6)this.finishMip();left--;break;
   }
   default:throw Error('Invalid environment bake phase');
  }}return this.done;}catch(error){this.cancel();throw error;}
 }
 /** Complete pixels run in local scalar loops only if ALL their candidate
  * operations fit. Otherwise preserve exact partial F64 sums across steps. */
 private pixelBatch(maxOps:number):number{
  const texels=this.directions!,pixels=this.pixels!,size=this.size,tiles=this.tiles,side=this.tileSide,roughness=this.roughness,horizon=this.horizon,ground=this.ground,zenith=this.zenith,urban=this.urban,average=this.average,sun=this.sun!,color=this.sunColor!,sharp=this.sharp,proxyGain=this.proxyGain,exponent=this.exponent,sunGain=this.sunGain,blur=this.blur;
  let face=this.face,y=this.y,x=this.x,dir=this.dirAt,out=this.offset,used=0;
  while(used<maxOps&&face<6){
   const candidates=tiles?.[(face*side+(y>>4))*side+(x>>4)]??EMPTY,needed=2+candidates.length,dx=texels[dir]!,dy=texels[dir+1]!,dz=texels[dir+2]!,down=Math.max(-dy,0),t=down>0?down:Math.sqrt(Math.max(dy,0)),to=down>0?ground:zenith;
   let r=mix(horizon[0]!,to[0]!,t),g=mix(horizon[1]!,to[1]!,t),b=mix(horizon[2]!,to[2]!,t);const urbanMix=Math.pow(Math.max(0,1-Math.abs(dy)),3)*(1-roughness*.72)*.28;r=mix(r,urban[0]!,urbanMix);g=mix(g,urban[1]!,urbanMix);b=mix(b,urban[2]!,urbanMix);
   if(needed>maxOps-used){this.dx=dx;this.dy=dy;this.dz=dz;this.baseR=r;this.baseG=g;this.baseB=b;this.pr=this.pg=this.pb=this.total=0;this.candidates=candidates;this.pixelProxy=0;this.phase=Phase.PixelProxy;used++;break;}
   if(tiles){let pr=0,pg=0,pb=0,total=0;for(const proxy of candidates){const alignment=dx*proxy.dir[0]+dy*proxy.dir[1]+dz*proxy.dir[2];if(alignment<=proxy.threshold)continue;const q=(alignment-proxy.threshold)/Math.max(1e-5,1-proxy.threshold),weight=Math.pow(q,sharp)*proxy.strength*proxyGain;pr+=proxy.color[0]*weight;pg+=proxy.color[1]*weight;pb+=proxy.color[2]*weight;total+=weight;}if(total>.001){const amount=Math.min(.86,total/(.58+total));r=mix(r,pr/total,amount);g=mix(g,pg/total,amount);b=mix(b,pb/total,amount);}}
   const sunDot=Math.max(0,dx*sun[0]+dy*sun[1]+dz*sun[2]),lobe=Math.pow(sunDot,exponent)*sunGain;pixels[out++]=float16(mix(r+color[0]*lobe,average[0]!,blur));pixels[out++]=float16(mix(g+color[1]*lobe,average[1]!,blur));pixels[out++]=float16(mix(b+color[2]*lobe,average[2]!,blur));pixels[out++]=float16(1);
   used+=needed;dir+=3;if(++x===size){x=0;if(++y===size){y=0;face++;}}
  }
  this.face=face;this.y=y;this.x=x;this.dirAt=dir;this.offset=out;if(face===6)this.finishMip();return used;
 }
 private finishMip(){this.generated.push(this.pixels!);this.mip++;this.pixels=undefined;this.directions=undefined;this.tiles=undefined;this.candidates=EMPTY;this.phase=Phase.Mip;}
 private releaseWork(){this.input=undefined;this.proxySource=undefined;this.proxies=[];this.sun=this.sunColor=this.sky=this.groundColor=this.urbanColor=undefined;this.directions=undefined;this.pixels=undefined;this.tiles=undefined;this.tileCandidates=[];this.candidates=EMPTY;this.generated=[];this.basis=this.rgb=[];}
 cancel(){if(this.phase===Phase.Cancelled)return;this.phase=Phase.Cancelled;this.result=undefined;this.releaseWork();}
}
