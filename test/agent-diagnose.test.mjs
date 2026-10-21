import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {runAgentExperiment} from '../tools/agent/experiment.mjs';
import {diagnoseAgentReport} from '../tools/agent/diagnose.mjs';

const root=resolve(fileURLToPath(new URL('..',import.meta.url)));
const spec=JSON.parse(readFileSync(join(root,'examples/agent/glass.scene.json'),'utf8'));
const config=join(root,'examples/agent/glass.experiment.json');

test('diagnosis links failed fracture assertion to recorded contacts and real source files',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'engine-agent-failed-'));
  try{
    const report=runAgentExperiment(spec,{
      ticks:30,outputDirectory:dir,assertions:[{type:'entity-present',id:'glass'}]});
    assert.equal(report.status,'fail');
    const {diagnosis,artifact}=await diagnoseAgentReport(report.artifacts.report,config);
    assert.equal(diagnosis.firstFailure.code,'assertion-failed');
    assert.equal(diagnosis.targetEntity,'glass');
    assert.equal(diagnosis.candidates[0].system,'fracture');
    assert.ok(diagnosis.candidates[0].files.includes('src/materials/fracture.ts'));
    assert.ok(diagnosis.evidence.complete);
    assert.ok(diagnosis.evidence.relevant.some(r=>r.law==='physics.contact'));
    assert.ok(diagnosis.evidence.relevant.some(r=>r.law==='scene.fracture'&&r.parent?.law==='physics.contact'));
    assert.ok(diagnosis.retry.commands.some(s=>s.includes('glass.experiment.json')));
    assert.equal(JSON.parse(readFileSync(artifact,'utf8')).schema,'game-engine.agent-diagnosis.v1');
  }finally{rmSync(dir,{recursive:true,force:true});}
});

test('passing run retains evidence without claiming any failure',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'engine-agent-passed-'));
  try{
    const report=runAgentExperiment(spec,{ticks:30,outputDirectory:dir,
      assertions:[{type:'entity-absent',id:'glass'}]});
    assert.equal(report.status,'pass');
    const {diagnosis}=await diagnoseAgentReport(report.artifacts.report,config);
    assert.equal(diagnosis.status,'pass');
    assert.equal(diagnosis.firstFailure,null);
    assert.equal(diagnosis.evidence.records,report.observations.interactions);
    assert.ok(diagnosis.candidates.length>0);
  }finally{rmSync(dir,{recursive:true,force:true});}
});

test('diagnosis rejects unrelated or incomplete reports',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'engine-agent-schema-'));
  try{
    const report=join(dir,'report.json');
    writeFileSync(report,JSON.stringify({schema:'unknown'}));
    await assert.rejects(diagnoseAgentReport(report),/schema/);
  }finally{rmSync(dir,{recursive:true,force:true});}
});
