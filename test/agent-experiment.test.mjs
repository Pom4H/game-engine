import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,rmSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {runAgentExperiment} from '../tools/agent/experiment.mjs';

const root=resolve(fileURLToPath(new URL('..',import.meta.url)));
const spec=JSON.parse(readFileSync(join(root,'examples/agent/glass.scene.json'),'utf8'));

test('agent experiment streams a complete deterministic causal proof without altering simulation',()=>{
  const dir=mkdtempSync(join(tmpdir(),'agent-experiment-'));
  try{
    const report=runAgentExperiment(spec,{
      ticks:30,sampleEvery:5,outputDirectory:dir,assertions:[
        {type:'entity-absent',id:'glass'},
        {type:'event-count',event:'fracture',min:1},
        {type:'interaction-count',effect:'contact',min:1},
      ],
    });
    assert.equal(report.status,'pass',JSON.stringify(report.firstFailure));
    assert.equal(report.replay.ticksCompleted,30);
    assert.equal(report.replay.complete,true);
    assert.equal(report.replay.referenceSha256,report.replay.observedSha256);
    assert.deepEqual(report.assertions.map(a=>a.passed),[true,true,true]);
    assert.ok(report.observations.byEffect.contact>0);
    assert.ok(report.observations.events.fracture>0);
    assert.ok(report.observations.causalExamples.some(e=>e.type==='fracture'&&
      e.cause?.law==='physics.contact'));
    assert.ok(report.performance.recordedTicks>0);
    assert.ok(report.performance.topSystems.some(s=>s.system==='physics'));
    const trace=readFileSync(report.artifacts.trace,'utf8').trim().split('\n').map(JSON.parse);
    assert.equal(trace.length,report.observations.interactions);
    assert.deepEqual(trace.map(x=>x.sequence),trace.map((_,i)=>i+1));
    assert.ok(trace.some(x=>x.effect.kind==='contact'));
    assert.equal(JSON.parse(readFileSync(report.artifacts.report,'utf8')).status,'pass');
  }finally{rmSync(dir,{recursive:true,force:true});}
});

test('agent failures are actionable, machine-readable and fail-closed',()=>{
  const report=runAgentExperiment(spec,{ticks:30,assertions:[{type:'entity-present',id:'glass'}]});
  assert.equal(report.status,'fail');
  assert.equal(report.firstFailure.code,'assertion-failed');
  assert.equal(report.firstFailure.assertion.observed,false);
  assert.equal(report.replay.complete,true);
  assert.throws(()=>runAgentExperiment(spec,{ticks:0}),/ticks/);
  assert.throws(()=>runAgentExperiment(spec,{traceCapacity:1}),/traceCapacity/);
  assert.throws(()=>runAgentExperiment(spec,{assertions:[{type:'event-count',event:'unknown',min:1}]}),/event/);
});

test('agent CLI executes declarative fixtures and writes JSONL evidence',()=>{
  const dir=mkdtempSync(join(tmpdir(),'agent-cli-'));
  try{
    const command=spawnSync(process.execPath,[
      join(root,'tools/agent/experiment.mjs'),
      join(root,'examples/agent/glass.experiment.json'),dir,
    ],{encoding:'utf8',cwd:root,timeout:120000});
    assert.equal(command.status,0,command.stderr||command.stdout);
    const output=JSON.parse(command.stdout);
    assert.equal(output.status,'pass');
    assert.equal(output.report,join(dir,'report.json'));
    assert.equal(JSON.parse(readFileSync(output.report,'utf8')).status,'pass');
  }finally{rmSync(dir,{recursive:true,force:true});}
});
