import {populationProjection} from '../../src/network/population.ts';
import {THEGAME_REGION_CAPABILITY} from '../../src/games/thegame/region.ts';

const normalize=raw=>{
 const url=new URL(raw);if(url.protocol==='ws:')url.protocol='http:';if(url.protocol==='wss:')url.protocol='https:';
 url.pathname=url.pathname.replace(/\/ws\/?$/,'/');return url;
};
export function createMeshworkPopulationMirror(raw,{intervalMs=500}={}){
 const base=normalize(raw),frames=new Map();let timer,closed=false,inflight=false;
 const stats={polls:0,accepted:0,rejected:0,errors:0,lastAt:0};
 const refresh=async()=>{
  if(closed||inflight)return;inflight=true;
  try{
   const response=await fetch(new URL('/shards',base),{signal:AbortSignal.timeout(Math.max(1000,intervalMs*2))});
   if(!response.ok)throw Error(await response.text());
   const shards=await response.json();if(!Array.isArray(shards))throw Error('Invalid shard list');
   const live=new Set();
   for(const state of shards){
    if(state?.shard?.capability!==THEGAME_REGION_CAPABILITY||state.publication===undefined)continue;
    live.add(state.shard.id);
    try{const frame=populationProjection.read(state.publication);frames.set(state.shard.id,frame);stats.accepted++;}
    catch{stats.rejected++;}
   }
   for(const id of frames.keys())if(!live.has(id))frames.delete(id);
   stats.polls++;stats.lastAt=Date.now();
  }catch{stats.errors++;}finally{inflight=false;}
 };
 void refresh();timer=setInterval(()=>void refresh(),intervalMs);
 return{
  snapshot:()=>Object.freeze([...frames.values()]),
  inspect:()=>({...stats,regions:frames.size,base:base.origin}),
  dispose(){closed=true;clearInterval(timer);frames.clear();},
 };
}
