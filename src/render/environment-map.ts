import {V3,type Vec3} from '../math.js';
import {buildDirectionalProxyTiles} from './proxy-tiles.js';
import {buildDiffuseIrradianceSH} from './irradiance.js';
import type {SceneRadianceProbe} from './radiance.js';
export interface EnvironmentMapInput {radiance:SceneRadianceProbe;sun:Vec3;sunColor:Vec3;sky:Vec3;intensity:number}
export interface EnvironmentMapData {irradiance:Float32Array;mips:Uint16Array[]}
/** Identical synthetic radiance integration in the renderer and its worker. */
export function bakeEnvironmentMap({radiance,sun,sunColor,sky,intensity}:EnvironmentMapInput):EnvironmentMapData{
    const generated:Uint16Array[]=[];
    const urbanColor=radiance.background,groundColor=radiance.ground;
    const proxies=radiance.proxies.map(proxy=>({dir:proxy.direction,color:proxy.color,threshold:proxy.threshold,strength:proxy.strength}));
    // Diffuse IBL must integrate the whole incident hemisphere. Sampling one
    // high cubemap mip along the surface normal loses bright ground/snow bounce
    // on vertical panels and makes coated objects unnaturally dark. Project the
    // same synthetic world-radiance representation into irradiance SH whenever
    // that cached representation changes; this stays off the per-frame hot path.
    const sampleSynthetic=(dir:Vec3):readonly[number,number,number]=>{
      const up=Math.max(dir[1],0),down=Math.max(-dir[1],0);
      const horizon:[number,number,number]=[sky[0]*1.22,sky[1]*1.22,sky[2]*1.22],zenith:[number,number,number]=[sky[0]*.45,sky[1]*.45,sky[2]*.45],ground:[number,number,number]=[groundColor[0]*.62,groundColor[1]*.62,groundColor[2]*.62];
      const t=Math.sqrt(up);let base:[number,number,number]=down>0?[mix(horizon[0],ground[0],down),mix(horizon[1],ground[1],down),mix(horizon[2],ground[2],down)]:[mix(horizon[0],zenith[0],t),mix(horizon[1],zenith[1],t),mix(horizon[2],zenith[2],t)];
      const horizontal=Math.pow(Math.max(0,1-Math.abs(dir[1])),3),urbanMix=horizontal*.28;
      base=[mix(base[0],urbanColor[0]*.78,urbanMix),mix(base[1],urbanColor[1]*.78,urbanMix),mix(base[2],urbanColor[2]*.78,urbanMix)];
      let pr=0,pg=0,pb=0,total=0;
      for(const proxy of proxies){
        const alignment=V3.dot(dir,proxy.dir);if(alignment<=proxy.threshold)continue;
        const q=(alignment-proxy.threshold)/Math.max(1e-5,1-proxy.threshold),weight=Math.pow(q,5.5)*proxy.strength;
        pr+=proxy.color[0]*weight;pg+=proxy.color[1]*weight;pb+=proxy.color[2]*weight;total+=weight;
      }
      if(total>.001){const amount=Math.min(.86,total/(.58+total));base=[mix(base[0],pr/total,amount),mix(base[1],pg/total,amount),mix(base[2],pb/total,amount)];}
      const sunDot=Math.max(0,dir[0]*sun[0]+dir[1]*sun[1]+dir[2]*sun[2]),sunLobe=Math.pow(sunDot,900)*intensity;
      return[base[0]+sunColor[0]*sunLobe,base[1]+sunColor[1]*sunLobe,base[2]+sunColor[2]*sunLobe];
    };
    const irradiance=buildDiffuseIrradianceSH(sampleSynthetic,512);
    // All directions and mip constants are shared. Avoid millions of small
    // vector allocations each time a moving camera crosses a probe grid cell.
    const horizon=sky.map(v=>v*1.22),zenith=[sky[0]*.45,sky[1]*.45,sky[2]*.45],ground=groundColor.map(v=>v*.62),urban=urbanColor.map(v=>v*.78),average=[mix(sky[0]*.62,urbanColor[0]*.55,.22),mix(sky[1]*.66,urbanColor[1]*.55,.22),mix(sky[2]*.72,urbanColor[2]*.55,.22)];
    const levels=9;
    for(let mip=0;mip<levels;mip++){
      const size=Math.max(1,256>>mip),roughness=mip/(levels-1),pixels=new Uint16Array(size*size*6*4),directions=cubeTexels(size);let offset=0,dirOffset=0;
      const tiles=roughness<.74?buildDirectionalProxyTiles(proxies,size,cubeDirection):null,sharp=mix(5.5,1.2,roughness*roughness),proxyGain=1-roughness*.62,exponent=mix(900,2.4,roughness*roughness),sunGain=intensity*mix(1.0,.12,roughness),blur=roughness*roughness*.68;
      for(let face=0;face<6;face++)for(let y=0;y<size;y++)for(let x=0;x<size;x++){
        const dx=directions[dirOffset++]!,dy=directions[dirOffset++]!,dz=directions[dirOffset++]!,down=Math.max(-dy,0),t=down>0?down:Math.sqrt(Math.max(dy,0)),to=down>0?ground:zenith;
        let r=mix(horizon[0]!,to[0]!,t),g=mix(horizon[1]!,to[1]!,t),b=mix(horizon[2]!,to[2]!,t);
        const urbanMix=Math.pow(Math.max(0,1-Math.abs(dy)),3)*(1-roughness*.72)*.28;
        r=mix(r,urban[0]!,urbanMix);g=mix(g,urban[1]!,urbanMix);b=mix(b,urban[2]!,urbanMix);
        if(tiles){let pr=0,pg=0,pb=0,total=0;
          for(const proxy of tiles.buckets[(face*tiles.side+(y>>4))*tiles.side+(x>>4)]!){
            const alignment=dx*proxy.dir[0]+dy*proxy.dir[1]+dz*proxy.dir[2];if(alignment<=proxy.threshold)continue;
            const q=(alignment-proxy.threshold)/Math.max(1e-5,1-proxy.threshold),weight=Math.pow(q,sharp)*proxy.strength*proxyGain;
            pr+=proxy.color[0]*weight;pg+=proxy.color[1]*weight;pb+=proxy.color[2]*weight;total+=weight;
          }
          if(total>.001){const amount=Math.min(.86,total/(.58+total));r=mix(r,pr/total,amount);g=mix(g,pg/total,amount);b=mix(b,pb/total,amount);}
        }
        const sunDot=Math.max(0,dx*sun[0]+dy*sun[1]+dz*sun[2]),lobe=Math.pow(sunDot,exponent)*sunGain;
        pixels[offset++]=float16(mix(r+sunColor[0]*lobe,average[0]!,blur));pixels[offset++]=float16(mix(g+sunColor[1]*lobe,average[1]!,blur));pixels[offset++]=float16(mix(b+sunColor[2]*lobe,average[2]!,blur));pixels[offset++]=float16(1);
      }
      generated.push(pixels);
    }
    return {irradiance,mips:generated};
}
function mix(a:number,b:number,t:number):number{return a+(b-a)*t;}
function cubeDirection(face:number,u:number,v:number):Vec3{
  const raw:Vec3=face===0?[1,-v,-u]:face===1?[-1,-v,u]:face===2?[u,1,v]:face===3?[u,-1,-v]:face===4?[u,-v,1]:[-u,-v,-1];
  return V3.normalize(raw);
}
const cubeTexelCache=new Map<number,Float64Array>();
function cubeTexels(size:number):Float64Array{
 let cached=cubeTexelCache.get(size);if(cached)return cached;cached=new Float64Array(size*size*6*3);let at=0;
 for(let face=0;face<6;face++)for(let y=0;y<size;y++)for(let x=0;x<size;x++){const d=cubeDirection(face,((x+.5)/size)*2-1,((y+.5)/size)*2-1);cached[at++]=d[0];cached[at++]=d[1];cached[at++]=d[2];}cubeTexelCache.set(size,cached);return cached;
}
const halfFloatScratch=new Float32Array(1),halfFloatBits=new Uint32Array(halfFloatScratch.buffer);
function float16(value:number):number{
  if(!Number.isFinite(value))return value<0?0xfc00:0x7c00;
  halfFloatScratch[0]=value;const x=halfFloatBits[0]!,sign=(x>>>16)&0x8000,exp=((x>>>23)&0xff)-127+15,mantissa=x&0x7fffff;
  if(exp<=0){if(exp<-10)return sign;return sign|((mantissa|0x800000)>>(14-exp));}
  if(exp>=31)return sign|0x7c00;
  return sign|(exp<<10)|(mantissa>>13);
}
