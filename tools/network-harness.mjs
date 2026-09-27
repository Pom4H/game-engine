#!/usr/bin/env node
import {createHash} from 'node:crypto';
import {mkdirSync,writeFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import assert from 'node:assert/strict';
import {projection,vector3,scalar,Publication,populationCells,populationProjection} from '../dist/network/index.js';
const observers=16,entities=128,publications=30,samples=11,warmups=4;
const p=projection('benchmark/motion',{position:vector3(),wear:scalar('step',0,1)});
const data=Array.from({length:entities},(_,i)=>({id:'entity:'+i,data:{position:[i*3,200+i*.5,i*.2],wear:i/1000}}));
function run(shared,verify=false){const old={...p.stats},results=[];const start=performance.now();let bytes=0;
 for(let tick=0;tick<publications;tick++){
  const stamp={epoch:1,sequence:tick,tick:tick*3,time:tick*.05,paused:false};let pub;
  if(shared)pub=new Publication(p,p.capture(stamp,data));
  for(let viewer=0;viewer<observers;viewer++){const text=pub?pub.text():p.encode(p.capture(stamp,data));bytes+=text.length;if(verify)results.push(text);}
 }
 return{ms:performance.now()-start,bytes,hash:verify?createHash('sha256').update(results.join('\n')).digest('hex'):null,captures:p.stats.captures-old.captures,encodes:p.stats.encodes-old.encodes};
}
const before=run(false,true),after=run(true,true);assert.equal(before.hash,after.hash);assert.equal(before.bytes,after.bytes);
for(let i=0;i<warmups;i++){run(false);run(true);}const a=[],b=[];
for(let i=0;i<samples;i++){if(i%2){b.push(run(true).ms);a.push(run(false).ms);}else{a.push(run(false).ms);b.push(run(true).ms);}}
const median=x=>[...x].sort((a,b)=>a-b)[Math.floor(x.length/2)];
function* population(){for(let i=0;i<100000;i++)yield[i%4*128+1,i%2*32+1,0];}
const cells=populationCells({epoch:1,sequence:0,tick:0,time:0,paused:true},population());
const report={commit:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),node:process.version,platform:process.platform,arch:process.arch,
 observers,entities,publications,samples,warmups,before:{...before,samplesMs:a,medianMs:median(a)},after:{...after,samplesMs:b,medianMs:median(b)},
 aggregate:{inputPositions:100000,cells:cells.rows.length,bytes:new TextEncoder().encode(populationProjection.encode(cells)).length,total:cells.rows.reduce((n,r)=>n+r.values[3],0)},
 notes:['Same projected bytes for all observers; shared capture/encoding vs repeated work, not a benchmark against thegame.','Only publication CPU work, no simulation, socket, GPU, network bandwidth saving or FPS claim.','Population input is synthetic positions, not a 100000-NPC AI workload.']};
mkdirSync('artifacts/network',{recursive:true});writeFileSync('artifacts/network/publication-report.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
