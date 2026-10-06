import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {performance,PerformanceObserver} from 'node:perf_hooks';
import {cpus,availableParallelism,platform,arch} from 'node:os';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {resolve} from 'node:path';
import {setImmediate as yieldTurn} from 'node:timers/promises';
import {StructuralBody} from '../../dist/physics/structure.js';
import {passengerStructuralDefinition} from '../../dist/vehicles/passenger.js';
import {M3_PARAMETRIC_PROFILE} from '../../dist/vehicles/m3.js';
import {material} from '../../dist/materials/catalog.js';
import {fields,wasmBody} from './adapter.mjs';
import {buildKernels} from './build.mjs';

const root=fileURLToPath(new URL('../../',import.meta.url)),directory=resolve(root,'artifacts/structural-wasm');
const hash=value=>createHash('sha256').update(typeof value==='string'||Buffer.isBuffer(value)?value:JSON.stringify(value)).digest('hex');
const quick=process.argv.includes('--quick'),verifyOnly=process.argv.includes('--verify-only');
const settings={dt:1/120,warmupTicks:quick?60:120,measuredTicks:quick?96:240,rounds:quick?2:5,parityTicks:240};
settings.parityTicks=Math.max(settings.parityTicks,settings.warmupTicks+settings.measuredTicks);
const build=buildKernels();
const modules=Object.fromEntries(['strict','sqrt'].map(name=>[name,new WebAssembly.Module(readFileSync(resolve(directory,`${name}.wasm`)))]));
for(const module of Object.values(modules))assert.ok(WebAssembly.Module.imports(module).every(item=>item.module==='math'), 'Unexpected runtime import');
// Same production JS, with only norm evaluation changed. This separates Math.hypot
// cost from language/backend effects; it is never installed into the engine.
const controlSource=readFileSync(resolve(root,'dist/physics/structure.js'),'utf8').replaceAll("'../math.js'",JSON.stringify(pathToFileURL(resolve(root,'dist/math.js')).href)).replaceAll('Math.hypot','hypot3')+'\nfunction hypot3(x,y,z){return Math.sqrt(x*x+y*y+z*z);}\n';
const controlPath=resolve(directory,'structure-sqrt-control.mjs');writeFileSync(controlPath,controlSource);
const {StructuralBody:SqrtBody}=await import(pathToFileURL(controlPath).href);
const names=['js','js-sqrt-control','wasm-strict','wasm-sqrt'];
const make=(name,definition)=>{
  if(name==='js')return {body:new StructuralBody(definition)};
  if(name==='js-sqrt-control'){
    const body=new StructuralBody(definition);Object.setPrototypeOf(body,SqrtBody.prototype);return {body};
  }
  return wasmBody(modules[name.slice(5)],definition);
};

const steel=material('steel').mechanical;
const car=passengerStructuralDefinition(M3_PARAMETRIC_PROFILE,1700,steel);
function lattice(size){
  const nodes=[],constraints=[],edges=new Set(),index=(x,y,z)=>(x*size+y)*size+z;
  for(let x=0;x<size;x++)for(let y=0;y<size;y++)for(let z=0;z<size;z++)nodes.push({position:[x*.25,y*.25,z*.25],mass:1});
  const edge=(a,b)=>{const key=a<b?`${a}:${b}`:`${b}:${a}`;if(edges.has(key))return;edges.add(key);constraints.push({kind:'distance',a,b,areaM2:1e-5,material:steel});};
  for(let x=0;x<size-1;x++)for(let y=0;y<size-1;y++)for(let z=0;z<size-1;z++){
    const corners=[[0,0,0],[1,0,0],[0,1,0],[0,0,1],[1,1,0],[1,0,1],[0,1,1],[1,1,1]].map(([dx,dy,dz])=>index(x+dx,y+dy,z+dz));
    for(const ids of [[0,1,2,3],[1,2,4,7],[1,3,5,7],[2,3,6,7],[1,2,3,7]]){
      const [a,b,c,d]=ids.map(i=>corners[i]);for(const pair of [[a,b],[a,c],[a,d],[b,c],[b,d],[c,d]])edge(...pair);
      constraints.push({kind:'volume',a,b,c,d,compliance:2.5e-10,yieldRatio:.1,breakRatio:.55,plasticity:.22});
    }
  }
  return {nodes,constraints,iterations:10,sleepSpeed:.025,sleepDelay:10,internalDamping:11};
}
const grid=lattice(8);
function activate(body){body.activateFromRigid(body.centerOfMass(),[.3,-.1,.2],[0,0,0]);}
function input(body,tick,ordinal=0){
  // A reproducible balanced nodal force. No contact callback, readback, copying,
  // renderer or network traffic is hidden in the timed solver call.
  body.wake();const j=((tick*7+ordinal)%body.nodeCount)*3,last=(body.nodeCount-1)*3;
  const f=40*Math.sin(tick*.13+ordinal*.17);body.force[j]+=f;body.force[last]-=f;
}
const measuredFields=['position','previous','velocity','force','rest','lambda','predictedMeasure','broken'];
function compare(reference,candidate,tick,name,maxima){
  const strict=name==='wasm-strict';
  for(const field of measuredFields){
    assert.equal(candidate[field].length,reference[field].length);
    for(let i=0;i<reference[field].length;i++){
      const a=reference[field][i],b=candidate[field][i],error=Math.abs(a-b);
      assert.ok(Number.isFinite(a)&&Number.isFinite(b),`${name}: non-finite ${field}[${i}] at tick ${tick}`);
      maxima[field]=Math.max(maxima[field]??0,error);
      const absolute=strict?1e-10:field==='velocity'?1e-6:1e-7,relative=strict?1e-11:1e-8;
      assert.ok(field==='broken'?a===b:error<=absolute+relative*Math.max(Math.abs(a),Math.abs(b)),`${name}: first divergence tick=${tick} field=${field} index=${i} js=${a} candidate=${b} error=${error}`);
    }
  }
  for(const field of ['plasticWorkJ','quietTime']){
    const a=reference[field],b=candidate[field],error=Math.abs(a-b);maxima[field]=Math.max(maxima[field]??0,error);
    assert.ok(error<=1e-7+1e-8*Math.max(Math.abs(a),Math.abs(b)),`${name}: ${field} diverged at tick ${tick}`);
  }
  assert.equal(candidate.steps,reference.steps);assert.equal(candidate.mode,reference.mode);
}
function parity(definition,label,destructive=false,thermal=false){
  const baseline=make('js',definition).body,candidates=names.slice(1).map(name=>({name,body:make(name,definition).body,maxima:{}}));
  for(const item of candidates)for(const field of fields)assert.deepEqual(item.body[field],baseline[field],`${item.name}: initial ${field} differs`);
  activate(baseline);for(const item of candidates)activate(item.body);
  let peakPlasticWorkJ=0,peakBroken=0,firstFracture;const brokenPerTick=[];
  for(let tick=0;tick<settings.parityTicks;tick++){
    for(const body of [baseline,...candidates.map(item=>item.body)]){
      input(body,tick);
      if(destructive&&[20,80,140].includes(tick)){body.velocity[0]+=tick===140?60:6;body.velocity[3]-=tick===140?60:6;}
      if(thermal&&tick===100)body.setThermalScale(1.0004);
      body.step(settings.dt,[0,0,0]);
    }
    for(const item of candidates){
      if(item.firstDivergence)continue;
      try{compare(baseline,item.body,tick,item.name,item.maxima);}
      catch(error){
        if(item.name==='wasm-strict')throw error;
        // Norm changes are experimental controls. A failed control is recorded
        // and excluded from timing this definition, without relaxing the gate.
        item.firstDivergence={tick,message:error.message};
      }
    }
    peakPlasticWorkJ=Math.max(peakPlasticWorkJ,baseline.plasticWorkJ);peakBroken=Math.max(peakBroken,baseline.stats.broken);
    brokenPerTick.push(baseline.stats.broken);
    if(!firstFracture&&baseline.stats.broken){
      const index=baseline.broken.findIndex(Boolean),volume=definition.constraints[index].kind==='volume';
      firstFracture={tick,index,kind:definition.constraints[index].kind,trial:baseline.predictedMeasure[index],originalRest:baseline.originalRest[index],originalStrain:(baseline.predictedMeasure[index]-baseline.originalRest[index])/Math.max(volume?1e-12:1e-9,Math.abs(baseline.originalRest[index])),failureLimit:baseline.breakLimit[index]};
    }
  }
  if(destructive){assert.ok(peakPlasticWorkJ>0,'Destructive fixture failed to exercise plasticity');assert.ok(peakBroken>0,'Destructive fixture failed to exercise fracture');}
  return {label,definitionSha256:hash(definition),ticks:settings.parityTicks,peakPlasticWorkJ,peakBroken,firstFracture,brokenPerTick,backends:candidates.map(({name,maxima,firstDivergence})=>({name,accepted:!firstDivergence,maxima,...(firstDivergence?{firstDivergence}:{})}))};
}
function invariants(name){
  const definition={nodes:[{position:[-.5,0,0],mass:1},{position:[.5,0,0],mass:1}],constraints:[{kind:'distance',a:0,b:1,areaM2:1e-5,material:{...steel,plasticity:0}}],sleepDelay:10,internalDamping:11};
  const body=make(name,definition).body;activate(body);body.velocity[0]-=1;body.velocity[3]+=1;
  const initialMomentum=body.linearMomentum(),initialEnergy=body.kineticEnergy();let maxMomentumResidualNs=0,maxEnergy=initialEnergy;
  for(let tick=0;tick<240;tick++){
    body.wake();body.step(settings.dt,[0,0,0]);
    const momentum=body.linearMomentum();maxMomentumResidualNs=Math.max(maxMomentumResidualNs,...momentum.map((v,i)=>Math.abs(v-initialMomentum[i])));
    const length=Math.abs(body.position[3]-body.position[0]),elastic=.5*(length-body.rest[0])**2/body.compliance[0];
    maxEnergy=Math.max(maxEnergy,body.kineticEnergy()+elastic);
  }
  assert.ok(maxMomentumResidualNs<1e-8,`${name}: momentum drift ${maxMomentumResidualNs}`);
  assert.ok(maxEnergy<=initialEnergy+1e-8,`${name}: unforced damped system gained energy`);
  // Uniform free fall has an analytical semi-implicit Euler centre trajectory.
  const free=make(name,definition).body;activate(free);const origin=free.centerOfMass(),v0=[.3,-.1,.2],gravity=[0,-9.81,0],ticks=120;
  for(let tick=0;tick<ticks;tick++){free.wake();free.step(settings.dt,gravity);}
  const center=free.centerOfMass(),expected=origin.map((p,i)=>p+ticks*settings.dt*v0[i]+gravity[i]*settings.dt**2*ticks*(ticks+1)/2);
  const ballisticErrorM=Math.max(...center.map((p,i)=>Math.abs(p-expected[i])));assert.ok(ballisticErrorM<1e-8,`${name}: ballistic centre error ${ballisticErrorM}`);
  // Shared bake lifecycle is also exercised, outside throughput measurements.
  const sleeper=make(name,{...definition,sleepDelay:.01}).body;sleeper.wake();sleeper.step(settings.dt,[0,0,0]);sleeper.step(settings.dt,[0,0,0]);
  assert.equal(sleeper.mode,'dormant');assert.ok(sleeper.takeBakedState());assert.equal(sleeper.takeBakedState(),undefined);
  return {name,maxMomentumResidualNs,initialEnergyJ:initialEnergy,maxEnergyJ:maxEnergy,ballisticErrorM,bake:'passed'};
}
const workloads=[{id:'m3-1',definition:car,bodies:1},{id:'m3-16',definition:car,bodies:16},{id:'m3-64',definition:car,bodies:64},{id:'lattice-512-1',definition:grid,bodies:1},{id:'lattice-512-8',definition:grid,bodies:8}];
const quantile=(values,q)=>{const sorted=[...values].sort((a,b)=>a-b);return sorted[Math.min(sorted.length-1,Math.ceil(sorted.length*q)-1)];};
const stats=values=>({samples:values.length,meanMs:values.reduce((a,b)=>a+b,0)/values.length,p50Ms:quantile(values,.5),p95Ms:quantile(values,.95),p99Ms:quantile(values,.99),maxMs:Math.max(...values)});
async function measure(name,workload){
  global.gc?.();const before=process.memoryUsage(),created=performance.now();
  const expectedTrace=proof.parity.find(item=>item.definitionSha256===hash(workload.definition)).brokenPerTick;
  const handles=Array.from({length:workload.bodies},()=>make(name,workload.definition)),bodies=handles.map(handle=>handle.body),setupMs=performance.now()-created;
  for(const body of bodies)activate(body);
  for(let tick=0;tick<settings.warmupTicks;tick++)for(let i=0;i<bodies.length;i++){input(bodies[i],tick);bodies[i].step(settings.dt,[0,0,0]);}
  await yieldTurn();const gcEvents=[];
  const observer=new PerformanceObserver(list=>{for(const event of list.getEntries())gcEvents.push({startTime:event.startTime,durationMs:event.duration});});observer.observe({entryTypes:['gc']});
  const samples=[],started=performance.now();let activeBodyTicks=0;
  for(let tick=0;tick<settings.measuredTicks;tick++){
    for(let i=0;i<bodies.length;i++)input(bodies[i],settings.warmupTicks+tick);
    const start=performance.now();for(const body of bodies)body.step(settings.dt,[0,0,0]);samples.push(performance.now()-start);
    const expectedBroken=expectedTrace[settings.warmupTicks+tick];
    for(const body of bodies){assert.equal(body.mode,'active');assert.equal(body.stats.broken,expectedBroken,'Throughput replay diverged from verified fracture timeline');activeBodyTicks++;}
    if(tick%32===31)await yieldTurn();
  }
  const ended=performance.now();await yieldTurn();observer.disconnect();
  const live=process.memoryUsage(),logicalBufferBytes=bodies.reduce((sum,body)=>sum+fields.reduce((n,field)=>n+body[field].byteLength,0),0);
  const linearMemoryBytes=handles.reduce((sum,handle)=>sum+(handle.memory?.buffer.byteLength??0),0);
  const events=gcEvents.filter(event=>event.startTime>=started&&event.startTime<=ended);
  return {samples,setupMs,activeBodyTicks,logicalBufferBytes,linearMemoryBytes,heapUsedDeltaBytes:live.heapUsed-before.heapUsed,arrayBuffersDeltaBytes:live.arrayBuffers-before.arrayBuffers,gcEvents:events.length,gcTotalMs:events.reduce((sum,event)=>sum+event.durationMs,0),gcMaxMs:Math.max(0,...events.map(event=>event.durationMs))};
}

const proof={parity:[parity(car,'M3 benchmark replay'),parity(car,'M3 plasticity/fracture',true),parity(car,'M3 thermal',false,true),parity(grid,'512-node mixed lattice benchmark replay')],invariants:names.map(invariants)};
console.error('Strict Wasm per-tick parity, momentum, energy, free fall and bake checks passed.');
const acceptedFor=(definition,name)=>name==='js'||proof.parity.filter(item=>item.definitionSha256===hash(definition)).every(item=>item.backends.find(backend=>backend.name===name).accepted);
const measurements=[];
if(!verifyOnly)for(const workload of workloads){
  const acceptedNames=names.filter(name=>acceptedFor(workload.definition,name)),excludedNames=names.filter(name=>!acceptedNames.includes(name));
  const rounds=Object.fromEntries(acceptedNames.map(name=>[name,[]]));
  for(let round=0;round<settings.rounds;round++)for(let offset=0;offset<acceptedNames.length;offset++){
    const name=acceptedNames[(round+offset)%acceptedNames.length];rounds[name].push(await measure(name,workload));
  }
  const backends=acceptedNames.map(name=>{
    const runs=rounds[name],timing=stats(runs.flatMap(run=>run.samples));
    return {name,...timing,roundP50Ms:runs.map(run=>quantile(run.samples,.5)),setupMs:runs.map(run=>run.setupMs),logicalBufferBytes:runs[0].logicalBufferBytes,linearMemoryBytes:runs[0].linearMemoryBytes,heapUsedDeltaBytes:runs.map(run=>run.heapUsedDeltaBytes),arrayBuffersDeltaBytes:runs.map(run=>run.arrayBuffersDeltaBytes),gcEvents:runs.reduce((sum,run)=>sum+run.gcEvents,0),gcTotalMs:runs.reduce((sum,run)=>sum+run.gcTotalMs,0),gcMaxMs:Math.max(...runs.map(run=>run.gcMaxMs)),activeBodyTicks:runs.reduce((sum,run)=>sum+run.activeBodyTicks,0)};
  });
  const baseline=backends[0];for(const backend of backends)backend.p50SpeedupVsJs=baseline.p50Ms/backend.p50Ms;
  const result={id:workload.id,bodies:workload.bodies,nodesPerBody:workload.definition.nodes.length,constraintsPerBody:workload.definition.constraints.length,definitionSha256:hash(workload.definition),excludedNames,backends};measurements.push(result);
  console.error(`${workload.id}: ${backends.map(item=>`${item.name} ${item.p50Ms.toFixed(3)} ms (${item.p50SpeedupVsJs.toFixed(2)}x)`).join('; ')}`);
}
const report={schema:1,createdAt:new Date().toISOString(),sourceCommit:process.env.GITHUB_SHA??null,solverBaselineCommit:process.env.SOURCE_COMMIT??null,environment:{node:process.version,v8:process.versions.v8,cpu:cpus()[0]?.model,visibleCpuCount:cpus().length,availableParallelism:availableParallelism(),platform:platform(),arch:arch(),execArgv:process.execArgv,forcedGcAvailable:typeof global.gc==='function'},settings,build,provenance:{solverTsSha256:hash(readFileSync(resolve(root,'src/physics/structure.ts'))),kernelCSha256:hash(readFileSync(resolve(root,'tools/structural-wasm/kernel.c'))),harnessSha256:hash(readFileSync(fileURLToPath(import.meta.url))),adapterSha256:hash(readFileSync(resolve(root,'tools/structural-wasm/adapter.mjs'))),wasmSha256:Object.fromEntries(['strict','sqrt'].map(name=>[name,hash(readFileSync(resolve(directory,`${name}.wasm`)))])),replay:'balanced sinusoidal nodal forces; fixed 1/120 s; same initial rigid velocity; input() version is identified by harness hash'},proof,measurements,limitations:['CPU active structural step only, not full game FPS or a native executable comparison.','No external contact-projector callbacks. Activation, validation, thermal setup and bake use production JS.','sqrt variants change norm evaluation; compare JS sqrt control before attributing gains to Wasm.','exp and pow remain host Math imports in both Wasm variants.','Warmup and setup are outside timed ticks; setup is reported separately.','GC events cover the measurement phase including yields and harness checks; they are not an allocation-rate estimate.','Heap deltas include temporary allocations and harness objects; logical buffer bytes and Wasm memory capacity are separate.','Shared host CPU timings are observations, not hardware-independent performance guarantees.']};
mkdirSync(directory,{recursive:true});const output=resolve(directory,verifyOnly?'proof.json':'result.json');writeFileSync(output,JSON.stringify(report,null,2)+'\n');console.log(output);
