import {performance} from 'node:perf_hooks';
import {createHash} from 'node:crypto';
import {writeFileSync} from 'node:fs';
import {Scene} from '../dist/scene/scene.js';
import {freezePrimitive} from '../dist/procedural/mesh.js';
import {buildSceneRadianceProbe} from '../dist/render/radiance.js';

// Fixed dense immutable geometry, matching streamed city mesh part sizes.
// Only the camera-local probe changes; atmosphere, geometry and quality stay fixed.
const scene=new Scene({version:1,entities:[]}),positions=[];
for(let i=0;i<60000;i++)positions.push(Math.sin(i*.7)*8,Math.cos(i*.3)*4,Math.sin(i*.1)*6);
const normals=positions.map((_,i)=>i%3===1?1:0),indices=Array.from({length:60000},(_,i)=>i);
for(let n=0;n<30;n++)scene.add({id:'mesh-'+n,position:[(n%6)*12-30,2,Math.floor(n/6)*12-24],mesh:freezePrimitive({kind:'triangle-mesh',positions:[...positions],normals,indices},true)});
const run=n=>buildSceneRadianceProbe(scene,[n*.125,1.8,n*.25],128,true);
for(let n=0;n<8;n++)run(n);
const timings=[],hash=createHash('sha256');
for(let n=0;n<40;n++){const start=performance.now(),probe=run(n);timings.push(performance.now()-start);hash.update(JSON.stringify(probe));}
timings.sort((a,b)=>a-b);
const result={date:new Date().toISOString(),scope:'CPU probe construction only; fixed 30 meshes of 60000 vertices, warmed, changing origin',samples:timings.length,vertices:1800000,meanMs:timings.reduce((a,b)=>a+b,0)/timings.length,p50Ms:timings[19],p95Ms:timings[37],probeSha256:hash.digest('hex')};
if(process.argv[2])writeFileSync(process.argv[2],JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify(result));
