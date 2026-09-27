import {V3,type Vec3} from '../math.js';
import {buildDirectionalProxyTiles} from './proxy-tiles.js';
import type {SceneRadianceProbe} from './radiance.js';
export interface EnvironmentInput{sun:Vec3;sunColor:Vec3;sky:Vec3;intensity:number;radiance:SceneRadianceProbe}
export interface EnvironmentMip{mip:number;size:number;pixels:Uint16Array}
/** The existing 256px/6-face/9-level evaluator, moved unchanged out of render's hot path. */
export function bakeEnvironment(input:EnvironmentInput):EnvironmentMip[]{
 const {sun,sunColor,sky,intensity,radiance}=input,urbanColor=radiance.background,groundColor=radiance.ground;
 const proxies=radiance.proxies.map(proxy=>({dir:proxy.direction,color:proxy.color,threshold:proxy.threshold,strength:proxy.strength}));
    const levels=9;const result:EnvironmentMip[]=[];
    for(let mip=0;mip<levels;mip++){
      const size=Math.max(1,256>>mip),roughness=mip/(levels-1),pixels=new Uint16Array(size*size*6*4);let offset=0;
      const tiles=roughness<.74?buildDirectionalProxyTiles(proxies,size,cubeDirection):null;
      for(let face=0;face<6;face++)for(let y=0;y<size;y++)for(let x=0;x<size;x++){
        const u=((x+.5)/size)*2-1,v=((y+.5)/size)*2-1,dir=cubeDirection(face,u,v),up=Math.max(dir[1],0),down=Math.max(-dir[1],0);
        const horizon:[number,number,number]=[sky[0]*1.22,sky[1]*1.22,sky[2]*1.22],zenith:[number,number,number]=[sky[0]*.45,sky[1]*.45,sky[2]*.45],ground:[number,number,number]=[groundColor[0]*.62,groundColor[1]*.62,groundColor[2]*.62];
        const t=Math.sqrt(up);let base:[number,number,number]=down>0?[mix(horizon[0],ground[0],down),mix(horizon[1],ground[1],down),mix(horizon[2],ground[2],down)]:[mix(horizon[0],zenith[0],t),mix(horizon[1],zenith[1],t),mix(horizon[2],zenith[2],t)];
        const horizontal=Math.pow(Math.max(0,1-Math.abs(dir[1])),3)*(1-roughness*.72);
        const urbanMix=horizontal*.28;
        base=[mix(base[0],urbanColor[0]*.78,urbanMix),mix(base[1],urbanColor[1]*.78,urbanMix),mix(base[2],urbanColor[2]*.78,urbanMix)];
        if(roughness<.74){
          let pr=0,pg=0,pb=0,total=0;
          const candidates=tiles!.buckets[(face*tiles!.side+(y>>4))*tiles!.side+(x>>4)]!;
          for(const proxy of candidates){
            const alignment=V3.dot(dir,proxy.dir);if(alignment<=proxy.threshold)continue;
            const q=(alignment-proxy.threshold)/Math.max(1e-5,1-proxy.threshold),sharp=mix(5.5,1.2,roughness*roughness),weight=Math.pow(q,sharp)*proxy.strength*(1-roughness*.62);
            pr+=proxy.color[0]*weight;pg+=proxy.color[1]*weight;pb+=proxy.color[2]*weight;total+=weight;
          }
          if(total>.001){const amount=Math.min(.86,total/(.58+total));base=[mix(base[0],pr/total,amount),mix(base[1],pg/total,amount),mix(base[2],pb/total,amount)];}
        }
        const sunDot=Math.max(0,dir[0]*sun[0]+dir[1]*sun[1]+dir[2]*sun[2]),exponent=mix(900,2.4,roughness*roughness),sunLobe=Math.pow(sunDot,exponent)*intensity*mix(1.0,.12,roughness);
        const average:[number,number,number]=[mix(sky[0]*.62,urbanColor[0]*.55,.22),mix(sky[1]*.66,urbanColor[1]*.55,.22),mix(sky[2]*.72,urbanColor[2]*.55,.22)],blur=roughness*roughness*.68;
        for(let channel=0;channel<3;channel++)pixels[offset++]=float16(mix(base[channel]!+sunColor[channel]!*sunLobe,average[channel]!,blur));
        pixels[offset++]=float16(1);
      }
      result.push({mip,size,pixels});
    }
    return result;
}
function mix(a:number,b:number,t:number):number{return a+(b-a)*t;}
export function cubeDirection(face:number,u:number,v:number):Vec3{
  const raw:Vec3=face===0?[1,-v,-u]:face===1?[-1,-v,u]:face===2?[u,1,v]:face===3?[u,-1,-v]:face===4?[u,-v,1]:[-u,-v,-1];
  return V3.normalize(raw);
}
const halfFloatScratch=new Float32Array(1),halfFloatBits=new Uint32Array(halfFloatScratch.buffer);
export function float16(value:number):number{
  if(!Number.isFinite(value))return value<0?0xfc00:0x7c00;
  halfFloatScratch[0]=value;const x=halfFloatBits[0]!,sign=(x>>>16)&0x8000,exp=((x>>>23)&0xff)-127+15,mantissa=x&0x7fffff;
  if(exp<=0){if(exp<-10)return sign;return sign|((mantissa|0x800000)>>(14-exp));}
  if(exp>=31)return sign|0x7c00;
  return sign|(exp<<10)|(mantissa>>13);
}
