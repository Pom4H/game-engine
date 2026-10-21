import {createReadStream, existsSync, readFileSync, writeFileSync} from 'node:fs';
import {createInterface} from 'node:readline';
import {dirname, join, relative, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const root=resolve(fileURLToPath(new URL('../..',import.meta.url)));
const owners={
  physics:{files:['src/physics/world.ts','src/scene/scene.ts'],tests:['test/contact-laws.test.mjs','test/proving-ground.test.mjs']},
  fracture:{files:['src/materials/fracture.ts','src/scene/scene.ts'],tests:['test/contact-laws.test.mjs','test/world-interaction-ir.test.mjs']},
  deformation:{files:['src/physics/deformation.ts','src/scene/scene.ts'],tests:['test/proving-ground.test.mjs']},
  surfaces:{files:['src/environment/surface-state.ts','src/scene/scene.ts'],tests:['test/surface-fastpath.test.mjs']},
  weather:{files:['src/environment/types.ts','src/scene/scene.ts'],tests:['test/proving-ground.test.mjs']},
  events:{files:['src/scene/scene.ts','src/scene/events.ts'],tests:['test/world-interaction-ir.test.mjs']},
  hearing:{files:['src/scene/acoustic-coupling.ts','src/world-ir/index.ts'],tests:['test/world-interaction-ir.test.mjs']},
  animation:{files:['src/animation/locomotion.ts','src/scene/scene.ts'],tests:['test/animation.test.mjs']},
  'vehicle-visuals':{files:['src/scene/scene.ts','src/vehicles/vehicle.ts'],tests:['test/vehicle-interaction.test.mjs']},
  'surface-contacts':{files:['src/environment/surface-contacts.ts','src/scene/scene.ts'],tests:['test/proving-ground.test.mjs']},
  'world-ir':{files:['src/world-ir/index.ts','src/scene/scene.ts'],tests:['test/world-interaction-ir.test.mjs']},
  profiling:{files:['src/scene/performance.ts'],tests:['test/scene-performance.test.mjs']},
  scheduling:{files:['src/scene/modules.ts','src/core/kernel.ts'],tests:['test/kernel-depth.test.mjs']},
};
const lawOwner={
  'physics.contact':'physics','environment.resolve':'weather',
  'surface.contact-work':'surfaces','scene.fracture':'fracture',
  'scene.impact':'events','scene.mechanism':'events',
  'acoustic.radiation':'hearing','npc.hearing':'hearing',
};
const brief=record=>({
  id:record.id,tick:record.tick,law:record.law,
  source:record.source?.id??null,target:record.target?.id??null,
  causeId:record.causeId??null,
  ...(record.effect.kind==='event'?{event:record.effect.event.type}:{})
});
function touching(record,entity){
  if(!entity)return false;
  const e=record.effect;
  return record.source?.id===entity||record.target?.id===entity||
    (e.kind==='event'&&[e.event.entity,e.event.a,e.event.b].includes(entity));
}
async function traceEvidence(file,entity,event){
  const index=new Map(),matched=[],tail=[];
  if(!existsSync(file))return {records:0,complete:false,relevant:[],error:'missing trace.jsonl'};
  let total=0;
  const lines=createInterface({input:createReadStream(file),crlfDelay:Infinity});
  try{
    for await(const line of lines){
      if(!line)continue;
      if(line.length>200000)throw new RangeError('Oversized causal record');
      const record=JSON.parse(line);
      if(record.sequence!==total+1)throw new TypeError('Non-contiguous causal sequence');
      total++;
      const item=brief(record);
      const parent=index.get(record.causeId);
      if(parent)item.parent={id:parent.id,law:parent.law,tick:parent.tick};
      index.set(item.id,item);
      if(index.size>2048)index.delete(index.keys().next().value);
      if(touching(record,entity)||(event&&record.effect.kind==='event'&&record.effect.event.type===event)){
        matched.push(item);if(matched.length>12)matched.shift();
      }
      tail.push(item);if(tail.length>12)tail.shift();
    }
  }finally{lines.close();}
  return {records:total,complete:true,relevant:(matched.length?matched:tail).slice(-12)};
}
function suspects(report,evidence){
  const failure=report.firstFailure;
  if(!failure)return [report.performance?.topSystems?.[0]?.system??'profiling'];
  if(failure.code==='cpu-p95-budget')return [report.performance?.topSystems?.[0]?.system??'profiling','profiling'];
  if(['invalid-causal-graph','missing-causal-history','causal-event-divergence'].includes(failure.code))return ['world-ir','events'];
  if(failure.code==='event-divergence')return ['events','physics'];
  if(failure.code==='runtime-error')return ['scheduling','physics'];
  if(['state-divergence','non-finite-state'].includes(failure.code))return ['physics','deformation','surfaces'];
  const a=failure.assertion;
  if(failure.code==='assertion-failed'&&a){
    if(a.type==='event-count')return a.event==='fracture'?['fracture','physics','events']:['events','physics'];
    if(a.type==='interaction-count'){
      const system={contact:'physics','surface-work':'surfaces',weather:'weather',
        event:'events','acoustic-radiation':'hearing',hearing:'hearing'}[a.effect]??'world-ir';
      return [system,'world-ir'];
    }
    if(a.type==='entity-absent'||a.type==='entity-present')
      return evidence.some(r=>r.law==='scene.fracture')?['fracture','physics','deformation']:['physics','fracture'];
  }
  return [lawOwner[evidence.at(-1)?.law]??'scheduling'];
}

/** Creates bounded, evidence-linked investigation hints. Never edits physical laws. */
export async function diagnoseAgentReport(reportPath,experimentPath){
  const file=resolve(reportPath),report=JSON.parse(readFileSync(file,'utf8'));
  if(report.schema!=='game-engine.agent-experiment.v1')throw new TypeError('Unsupported report schema');
  const assertion=report.firstFailure?.assertion;
  const entity=(assertion?.type==='entity-absent'||assertion?.type==='entity-present')?assertion.id:null;
  const event=assertion?.type==='event-count'?assertion.event:null;
  const trace=report.artifacts?.trace??join(dirname(file),'trace.jsonl');
  const evidence=await traceEvidence(trace,entity,event);
  const systems=[...new Set(suspects(report,evidence.relevant))].slice(0,4);
  const candidates=systems.map((name,i)=>{
    const owner=owners[name]??owners.scheduling;
    for(const path of [...owner.files,...owner.tests])
      if(!existsSync(join(root,path)))throw new TypeError('Stale source link: '+path);
    return {rank:i+1,system:name,files:owner.files,tests:owner.tests,
      measuredP95Ms:report.performance?.systems?.[name]?.p95Ms??null,
      evidenceIds:evidence.relevant.filter(r=>lawOwner[r.law]===name).slice(-4).map(r=>r.id)};
  });
  const commands=['bun run build','node --test test/agent-experiment.test.mjs test/agent-diagnose.test.mjs'];
  if(experimentPath)commands.push('node tools/agent/experiment.mjs '+
    JSON.stringify(relative(root,resolve(experimentPath)).replaceAll('\\','/')));
  const diagnosis={
    schema:'game-engine.agent-diagnosis.v1',status:report.status,
    firstFailure:report.firstFailure??null,targetEntity:entity,expectedEvent:event,
    evidence, candidates,
    warning:'Ranked systems are investigation candidates, not proven root causes. Causal records are observed committed facts.',
    retry:{commands,rule:'Derive a physical correction; do not tune coefficients to match expected output. Preserve replay parity.'},
  };
  const artifact=join(dirname(file),'diagnosis.json');
  writeFileSync(artifact,JSON.stringify(diagnosis,null,2)+'\n');
  return {diagnosis,artifact};
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  if(!process.argv[2]){process.stderr.write('Usage: diagnose.mjs <report.json> [experiment.json]\n');process.exitCode=2;}
  else diagnoseAgentReport(process.argv[2],process.argv[3]).then(x=>
    process.stdout.write(JSON.stringify({artifact:x.artifact,status:x.diagnosis.status,
      suspects:x.diagnosis.candidates.map(c=>c.system)})+'\n')
  ).catch(e=>{process.stderr.write(String(e.stack??e)+'\n');process.exitCode=2;});
}
