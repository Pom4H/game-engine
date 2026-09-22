import test from 'node:test';
import assert from 'node:assert/strict';
import {buildDirectionalProxyTiles} from '../dist/render/proxy-tiles.js';
import {V3} from '../dist/math.js';

const direction=(face,u,v)=>V3.normalize(face===0?[1,-v,-u]:face===1?[-1,-v,u]:face===2?[u,1,v]:face===3?[u,-1,-v]:face===4?[u,-v,1]:[-u,-v,-1]);
const proxies=Array.from({length:40},(_,i)=>({
  id:i,
  dir:V3.normalize([Math.sin(i*13.1),Math.cos(i*4.7),Math.sin(i*2.9)]),
  threshold:.35+(i%7)*.10,
}));

test('cube tiles never drop a contributing radiance proxy at mip edges',()=>{
  for(const size of [1,2,16,64,256]){
    const {side,buckets}=buildDirectionalProxyTiles(proxies,size,direction);
    for(let face=0;face<6;face++)for(let y=0;y<size;y++)for(let x=0;x<size;x++){
      const dir=direction(face,(x+.5)*2/size-1,(y+.5)*2/size-1);
      const candidates=buckets[(face*side+(y>>4))*side+(x>>4)];
      for(const proxy of proxies){
        if(V3.dot(dir,proxy.dir)>proxy.threshold)
          assert.ok(candidates.includes(proxy),`missing proxy ${proxy.id} at ${size}/${face}/${x}/${y}`);
      }
      for(let i=1;i<candidates.length;i++)assert.ok(candidates[i-1].id<candidates[i].id);
    }
  }
});
