import {THEGAME_REGION_CAPABILITY} from '../../src/games/thegame/region.ts';

const raw=process.env.MESHWORK_BROKER??'http://127.0.0.1:8787';
const base=new URL(raw);
if(base.protocol==='ws:')base.protocol='http:';
if(base.protocol==='wss:')base.protocol='https:';
base.pathname=base.pathname.replace(/\/ws\/?$/,'/');
if(base.protocol!=='http:'&&base.protocol!=='https:')throw Error('MESHWORK_BROKER must be http(s) or ws(s)');

const seed=Number(process.env.THEGAME_SEED??29);
const radius=Number(process.env.THEGAME_REGION_RADIUS??1);
const sizeM=Number(process.env.THEGAME_REGION_SIZE??2048);
const population=Number(process.env.THEGAME_REGION_POPULATION??4096);
if(!Number.isSafeInteger(radius)||radius<0||radius>8)throw Error('THEGAME_REGION_RADIUS must be 0..8');

const response=await fetch(new URL('/shards',base));
if(!response.ok)throw Error('Meshwork shards: '+await response.text());
const existing=await response.json();
const key=(x,z)=>JSON.stringify([seed,x,z,sizeM,population]);
const found=new Map(existing.filter(s=>s?.shard?.capability===THEGAME_REGION_CAPABILITY).map(s=>{
 const i=s.shard.input;return[key(i.seed,i.x,i.z,i.sizeM,i.population),s];
}));
let created=0;
for(let z=-radius;z<=radius;z++)for(let x=-radius;x<=radius;x++){
 const k=key(x,z);if(found.has(k))continue;
 const input={seed,x,z,sizeM,population,cellM:128,stepSeconds:.1};
 const result=await fetch(new URL('/shards',base),{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({capability:THEGAME_REGION_CAPABILITY,input,startTick:0,affinityKey:`thegame:${seed}:${x}:${z}`})});
 if(!result.ok)throw Error(`Create region ${x}:${z}: `+await result.text());
 created++;
}
console.log(`TheGame regions ready: ${(radius*2+1)**2} desired, ${created} created, broker ${base.origin}`);
