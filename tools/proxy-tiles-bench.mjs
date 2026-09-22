import {performance} from 'node:perf_hooks';
import {buildDirectionalProxyTiles} from '../dist/render/proxy-tiles.js';
import {V3} from '../dist/math.js';

const direction=(face,u,v)=>V3.normalize(face===0?[1,-v,-u]:face===1?[-1,-v,u]:face===2?[u,1,v]:face===3?[u,-1,-v]:face===4?[u,-v,1]:[-u,-v,-1]);
const proxies=Array.from({length:128},(_,i)=>({dir:V3.normalize([Math.sin(i*13.1),Math.cos(i*4.7),Math.sin(i*2.9)]),threshold:.72+(i%7)*.035,strength:1}));
function probe(tiled){
  let sum=0,visited=0;
  for(let mip=0;mip<7;mip++){
    const size=Math.max(1,256>>mip),roughness=mip/8,tiles=tiled?buildDirectionalProxyTiles(proxies,size,direction):null;
    for(let face=0;face<6;face++)for(let y=0;y<size;y++)for(let x=0;x<size;x++){
      const dir=direction(face,(x+.5)*2/size-1,(y+.5)*2/size-1);
      const candidates=tiles?tiles.buckets[(face*tiles.side+(y>>4))*tiles.side+(x>>4)]:proxies;
      for(const proxy of candidates){
        visited++;
        const alignment=V3.dot(dir,proxy.dir);if(alignment<=proxy.threshold)continue;
        const q=(alignment-proxy.threshold)/Math.max(1e-5,1-proxy.threshold);
        sum+=Math.pow(q,5.5-4.3*roughness*roughness)*proxy.strength*(1-roughness*.62);
      }
    }
  }
  return{sum,visited};
}
probe(false);probe(true);
for(const tiled of [false,true]){
  const times=[];let result;
  for(let i=0;i<3;i++){const start=performance.now();result=probe(tiled);times.push(performance.now()-start);}
  console.log(JSON.stringify({tiled,medianMs:times.sort((a,b)=>a-b)[1],...result}));
}
