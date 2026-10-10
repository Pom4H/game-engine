import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {closeSync, mkdirSync, openSync, readFileSync, rmSync, mkdtempSync, writeFileSync, writeSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {basename, dirname, extname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {Scene} from '../../dist/scene/scene.js';
import {diagnoseAgentReport} from './diagnose.mjs';
import {validateWorldInteractionGraph} from '../../dist/world-ir/index.js';

const root=resolve(fileURLToPath(new URL('../..',import.meta.url)));
const allowedEffects=new Set(['weather','contact','surface-work','event','acoustic-radiation','hearing']);
const allowedEvents=new Set(['impact','fracture','mechanism']);
const increment=(object,key)=>{object[key]=(object[key]??0)+1;};

function checkedOptions(input){
  const options={
    ticks:input.ticks??60,dt:input.dt??1/60,traceCapacity:input.traceCapacity??4096,
    tickBudgetMs:input.tickBudgetMs??5,sampleEvery:input.sampleEvery??5,
    maxP95Ms:input.maxP95Ms,assertions:input.assertions??[],
    outputDirectory:input.outputDirectory,
  };
  if(!Number.isSafeInteger(options.ticks)||options.ticks<1||options.ticks>100000)
    throw new RangeError('ticks must be an integer in 1..100000');
  if(!Number.isFinite(options.dt)||options.dt<=0||options.dt>.25)
    throw new RangeError('dt must be in (0, 0.25] seconds');
  if(!Number.isSafeInteger(options.traceCapacity)||options.traceCapacity<16||options.traceCapacity>65536)
    throw new RangeError('traceCapacity must be in 16..65536');
  if(!Number.isFinite(options.tickBudgetMs)||options.tickBudgetMs<.001||options.tickBudgetMs>1000)
    throw new RangeError('tickBudgetMs must be in [0.001, 1000]');
  if(!Number.isSafeInteger(options.sampleEvery)||options.sampleEvery<1||options.sampleEvery>1024)
    throw new RangeError('sampleEvery must be in 1..1024');
  if(options.maxP95Ms!==undefined&&(!Number.isFinite(options.maxP95Ms)||options.maxP95Ms<=0))
    throw new RangeError('maxP95Ms must be positive');
  if(!Array.isArray(options.assertions)||options.assertions.length>128)
    throw new TypeError('assertions must be an array with at most 128 entries');
  for(const assertion of options.assertions){
    if(!assertion||typeof assertion!=='object')throw new TypeError('Invalid assertion');
    switch(assertion.type){
      case 'entity-present':
      case 'entity-absent':
        if(typeof assertion.id!=='string'||!assertion.id)throw new TypeError('Entity assertion requires id');
        break;
      case 'event-count':
        if(!allowedEvents.has(assertion.event))throw new TypeError('Unknown event type');
        if(!Number.isSafeInteger(assertion.min)||assertion.min<0)
          throw new TypeError('event-count requires a nonnegative integer min');
        break;
      case 'interaction-count':
        if(!allowedEffects.has(assertion.effect))throw new TypeError('Unknown interaction effect');
        if(!Number.isSafeInteger(assertion.min)||assertion.min<0)
          throw new TypeError('interaction-count requires a nonnegative integer min');
        break;
      default:throw new TypeError('Unknown assertion type: '+String(assertion.type));
    }
  }
  if(options.outputDirectory!==undefined&&typeof options.outputDirectory!=='string')
    throw new TypeError('outputDirectory must be a path');
  return options;
}

function nonFinite(value,path='$'){
  if(typeof value==='number')return Number.isFinite(value)?null:{path,value:String(value)};
  if(value&&typeof value==='object'){
    for(const [key,child] of Object.entries(value)){
      const hit=nonFinite(child,path+(Array.isArray(value)?'['+key+']':'.'+key));
      if(hit)return hit;
    }
  }
  return null;
}

function firstDifference(a,b,path='$'){
  if(Object.is(a,b))return null;
  if(a===null||b===null||typeof a!=='object'||typeof b!=='object')
    return {path,expected:a,actual:b};
  if(Array.isArray(a)!==Array.isArray(b))return {path,expected:a,actual:b};
  const keysA=Object.keys(a),keysB=Object.keys(b);
  if(keysA.length!==keysB.length)return {path:path+'.length',expected:keysA.length,actual:keysB.length};
  for(const key of keysA){
    if(!Object.hasOwn(b,key))return {path:path+'.'+key,expected:a[key],actual:'<missing>'};
    const hit=firstDifference(a[key],b[key],path+(Array.isArray(a)?'['+key+']':'.'+key));
    if(hit)return hit;
  }
  return null;
}

function evaluate(assertions,snapshot,events,effects){
  const ids=new Set(snapshot.entities.map(e=>e.id));
  return assertions.map(assertion=>{
    let observed,passed;
    if(assertion.type==='entity-present'){observed=ids.has(assertion.id);passed=observed;}
    if(assertion.type==='entity-absent'){observed=!ids.has(assertion.id);passed=observed;}
    if(assertion.type==='event-count'){observed=events[assertion.event]??0;passed=observed>=assertion.min;}
    if(assertion.type==='interaction-count'){observed=effects[assertion.effect]??0;passed=observed>=assertion.min;}
    return {...assertion,observed,passed};
  });
}

function briefCause(record){
  if(!record)return null;
  const effect=record.effect;
  return {id:record.id,law:record.law,tick:record.tick,source:record.source,
    ...(record.target?{target:record.target}:{}),
    ...(effect.kind==='contact'?{pointM:effect.pointM,normalImpulseNs:effect.normalImpulseNs,
      normalEnergyJ:effect.normalEnergyJ}:{}),
  };
}

/**
 * Opt-in agent experiment: replay parity + committed cause stream + CPU evidence.
 * Reads only existing authorities; no changes to the Scene hot path.
 */
export function runAgentExperiment(sceneInput,input={}){
  const options=checkedOptions(input);
  const reference=new Scene(sceneInput),observed=new Scene(sceneInput);
  observed.enableWorldInteractions(options.traceCapacity);
  observed.enablePerformanceProfiling({
    tickBudgetMs:options.tickBudgetMs,sampleEvery:options.sampleEvery,
    history:Math.min(4096,Math.max(8,Math.ceil(options.ticks/options.sampleEvery))),
  });
  const hashA=createHash('sha256'),hashB=createHash('sha256');
  const eventCounts=Object.create(null),effectCounts=Object.create(null);
  const examples=[],recent=new Map();
  let ticksCompleted=0,cursor=0,firstFailure=null;
  let snapshotsMatch=true,eventsMatch=true,causalEventsMatch=true,traceComplete=true;
  const out=options.outputDirectory===undefined?null:resolve(options.outputDirectory);
  if(out)mkdirSync(out,{recursive:true});
  const tracePath=out?join(out,'trace.jsonl'):null,reportPath=out?join(out,'report.json'):null;
  const fd=tracePath?openSync(tracePath,'w'):null;
  try{
    for(let tick=1;tick<=options.ticks;tick++){
      try{reference.step(options.dt);observed.step(options.dt);}
      catch(error){
        firstFailure={tick,code:'runtime-error',message:String(error)};
        break;
      }
      ticksCompleted=tick;
      const expected=reference.snapshot(),actual=observed.snapshot();
      const invalid=nonFinite(actual)??nonFinite(expected);
      if(invalid){
        firstFailure={tick,code:'non-finite-state',...invalid};
        snapshotsMatch=false;break;
      }
      const serializedA=JSON.stringify(expected),serializedB=JSON.stringify(actual);
      hashA.update(serializedA+'\n');hashB.update(serializedB+'\n');
      if(serializedA!==serializedB){
        firstFailure={tick,code:'state-divergence',...firstDifference(expected,actual)};
        snapshotsMatch=false;break;
      }
      const eventsA=reference.drainEvents(),eventsB=observed.drainEvents();
      if(JSON.stringify(eventsA)!==JSON.stringify(eventsB)){
        firstFailure={tick,code:'event-divergence',...firstDifference(eventsA,eventsB)};
        eventsMatch=false;break;
      }
      const graph=observed.worldInteractionGraph(cursor);
      try{validateWorldInteractionGraph(graph);}
      catch(error){
        firstFailure={tick,code:'invalid-causal-graph',message:String(error)};
        traceComplete=false;break;
      }
      const first=graph.interactions[0]?.sequence??graph.nextSequence;
      if(first!==cursor+1){
        firstFailure={tick,code:'missing-causal-history',expectedSequence:cursor+1,
          actualSequence:first,traceCapacity:options.traceCapacity};
        traceComplete=false;break;
      }
      const causalEvents=graph.interactions.filter(record=>record.effect.kind==='event')
        .map(record=>record.effect.event);
      if(JSON.stringify(causalEvents)!==JSON.stringify(eventsB)){
        firstFailure={tick,code:'causal-event-divergence',
          ...firstDifference(eventsB,causalEvents)};
        causalEventsMatch=false;break;
      }
      for(const event of eventsB)increment(eventCounts,event.type);
      for(const record of graph.interactions){
        increment(effectCounts,record.effect.kind);
        if(fd!==null)writeSync(fd,JSON.stringify(record)+'\n');
        if(record.effect.kind==='event'&&examples.length<16){
          examples.push({id:record.id,tick:record.tick,type:record.effect.event.type,
            causeId:record.causeId??null,cause:briefCause(recent.get(record.causeId))});
        }
        recent.set(record.id,record);
        if(recent.size>256)recent.delete(recent.keys().next().value);
      }
      cursor=graph.nextSequence-1;
    }
  }finally{if(fd!==null)closeSync(fd);}
  const perf=observed.performanceReport();
  const assertions=firstFailure?[]:evaluate(options.assertions,observed.snapshot(),eventCounts,effectCounts);
  if(!firstFailure){
    const failed=assertions.find(assertion=>!assertion.passed);
    if(failed)firstFailure={tick:ticksCompleted,code:'assertion-failed',assertion:failed};
  }
  if(!firstFailure&&options.maxP95Ms!==undefined&&
      (!perf?.recordedTicks||perf.tick.p95Ms>options.maxP95Ms)){
    firstFailure={tick:ticksCompleted,code:'cpu-p95-budget',
      observedMs:perf?.tick.p95Ms??null,maxP95Ms:options.maxP95Ms};
  }
  const topSystems=perf?Object.entries(perf.systems)
    .map(([system,stats])=>({system,p95Ms:stats.p95Ms,meanMs:stats.meanMs}))
    .sort((a,b)=>b.p95Ms-a.p95Ms).slice(0,8):[];
  const report={
    schema:'game-engine.agent-experiment.v1',status:firstFailure?'fail':'pass',
    input:{ticks:options.ticks,dt:options.dt,traceCapacity:options.traceCapacity,
      tickBudgetMs:options.tickBudgetMs,sampleEvery:options.sampleEvery,
      ...(options.maxP95Ms!==undefined?{maxP95Ms:options.maxP95Ms}:{})},
    replay:{ticksCompleted,referenceSha256:hashA.digest('hex'),observedSha256:hashB.digest('hex'),
      stateParity:snapshotsMatch,eventParity:eventsMatch,causalEventParity:causalEventsMatch,
      complete:traceComplete&&ticksCompleted===options.ticks},
    observations:{interactions:cursor,byEffect:effectCounts,events:eventCounts,
      causalExamples:examples,finalEntities:observed.entities.size},
    performance:perf?{...perf,topSystems}:null,
    assertions,firstFailure,
    artifacts:out?{trace:tracePath,report:reportPath}:null,
  };
  if(reportPath)writeFileSync(reportPath,JSON.stringify(report,null,2)+'\n');
  return report;
}

function loadScene(path){
  if(extname(path)==='.json')return JSON.parse(readFileSync(path,'utf8'));
  if(extname(path)==='.wscn')return new Uint8Array(readFileSync(path));
  if(extname(path)!=='.world')throw new TypeError('Scene must be .json, .world or .wscn');
  const temp=mkdtempSync(join(tmpdir(),'engine-agent-'));
  try{
    const binary=join(temp,'scene.wscn');
    const result=spawnSync('cargo',['run','--quiet','--manifest-path',
      join(root,'compiler/Cargo.toml'),'--','compile',path,'-o',binary],
      {cwd:root,encoding:'utf8'});
    if(result.status!==0)throw new Error('worldc: '+(result.stderr||result.error?.message||'failed'));
    return new Uint8Array(readFileSync(binary));
  }finally{rmSync(temp,{recursive:true,force:true});}
}

async function main(){
  const file=resolve(process.argv[2]??join(root,'examples/agent/glass.experiment.json'));
  const config=JSON.parse(readFileSync(file,'utf8'));
  if(!config||typeof config.scene!=='string'||!config.scene)
    throw new TypeError('Experiment config requires a scene path');
  const {scene,outputDirectory:configuredOutput,...settings}=config;
  const outputDirectory=process.argv[3]
    ?resolve(process.argv[3])
    :configuredOutput?resolve(dirname(file),configuredOutput)
    :join(root,'artifacts/agent',basename(file,'.experiment.json'));
  const result=runAgentExperiment(loadScene(resolve(dirname(file),scene)),
    {...settings,outputDirectory});
  const diagnosis=await diagnoseAgentReport(result.artifacts.report,file);
  process.stdout.write(JSON.stringify({
    diagnosis:diagnosis.artifact,
    status:result.status,firstFailure:result.firstFailure,
    report:result.artifacts.report,trace:result.artifacts.trace,
    stateParity:result.replay.stateParity,ticks:result.replay.ticksCompleted,
    p95Ms:result.performance?.tick.p95Ms,
  })+'\n');
  if(result.status!=='pass')process.exitCode=1;
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  main().catch(error=>{process.stderr.write(String(error?.stack??error)+'\n');process.exitCode=2;});
}
