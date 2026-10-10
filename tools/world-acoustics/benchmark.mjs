import {readFileSync,writeFileSync,mkdirSync,mkdtempSync,rmSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {Scene} from '../../dist/scene/scene.js';
import {AcousticWaveField} from '../../dist/physics/wave-field.js';
import {createWasmAcousticWaveField} from '../../dist/physics/wave-wasm.js';
import {attachSceneAcoustics} from '../../dist/scene/acoustic-coupling.js';

const root=resolve(fileURLToPath(new URL('../..',import.meta.url)));
const quick=process.argv.includes('--quick');
const simTicks=quick?70:160,history=quick?64:128,sampleRate=60;
const temporary=mkdtempSync(join(tmpdir(),'acoustic-bench-'));
let source;
try{
 const output=join(temporary,'physical-hearing.wscn');
 const result=spawnSync('cargo',[
  'run','--quiet','--manifest-path',resolve(root,'compiler/Cargo.toml'),'--',
  'compile',resolve(root,'examples/worlds/physical-hearing.world'),'-o',output,
 ],{cwd:root,encoding:'utf8'});
 if(result.status!==0)throw new Error('Rust World compile failed: '+result.stderr);
 source=new Uint8Array(readFileSync(output));
}finally{rmSync(temporary,{recursive:true,force:true});}

const acousticSpec={
 size:[40,10,20],cellSizeM:.5,waveSpeedMps:343,densityKgM3:1.225,origin:[-10,0,-5],
};
const wasmBytes=new Uint8Array(readFileSync(resolve(root,
 'kernels/world-wave/target/wasm32-unknown-unknown/release/world_wave_kernel.wasm')));
const wasmModule=await WebAssembly.compile(wasmBytes);

async function create(kind){
 const scene=new Scene(source);
 // All three samples use the same KernelProgram dispatch, even though
 // the optional plugin would otherwise disable the built-in direct plan.
 scene.setSystemDispatch('kernel');
 scene.enablePerformanceProfiling({tickBudgetMs:100,sampleEvery:1,history});
 let field,coupling;
 if(kind==='ts'||kind==='wasm'){
  field=kind==='ts'?new AcousticWaveField(acousticSpec):
   await createWasmAcousticWaveField(acousticSpec,wasmModule);
  scene.enableWorldInteractions(512);
  coupling=attachSceneAcoustics(scene,field,{
   fieldId:'outdoor-air',listeners:[{entityId:'listener'}],
  });
 }
 return {scene,field,coupling};
}
async function measure(kind){
 const {scene,field,coupling}=await create(kind);
 try{
  let peakListenerPa=0;
  for(let i=0;i<simTicks;i++){
   scene.step(1/sampleRate);
   peakListenerPa=Math.max(peakListenerPa,coupling?.sensor('listener')?.rmsPressurePa??0);
  }
  const report=scene.performanceReport(),waveBytes=field?[
   field.pressurePa,field.velocityXMps,field.velocityYMps,
   field.velocityZMps,field.solid,
  ].reduce((sum,view)=>sum+view.byteLength,0):0;
  return {
   backend:kind,simulatedSeconds:simTicks/sampleRate,grid:field?.size??null,
   cellSizeM:field?.cellSizeM??null,waveSpeedMps:field?.waveSpeedMps??null,
   requiredCflSubsteps:coupling?.diagnostics.substeps??0,
   pressureMemoryBytes:waveBytes,peakListenerRmsPressurePa:peakListenerPa,
   sourceContacts:coupling?.sourcesEverInjected??0,
   totalRadiatedAcousticEnergyJ:coupling?.totalRadiatedEnergyJ??0,
   interactionRecords:scene.worldInteractionStats?.retained??0,
   tick:report.tick,acousticSystem:report.systems['acoustic:outdoor-air']??null,
   physicsSystem:report.systems.physics??null,
   overhead:report.overhead,
  };
 }finally{coupling?.close();field?.dispose();}
}
const measurements=[];
for(const kind of ['baseline','ts','wasm']){
 const value=await measure(kind);
 measurements.push(value);
 console.log(kind+': tick p50 '+value.tick.p50Ms.toFixed(3)+
   'ms, p95 '+value.tick.p95Ms.toFixed(3)+
   'ms; acoustic p95 '+(value.acousticSystem?.p95Ms??0).toFixed(3)+
   'ms; actual wave sources '+value.sourceContacts+
   '; listener RMS peak '+value.peakListenerRmsPressurePa.toPrecision(5)+'Pa');
}
const report={
 schema:1,gitSha:process.env.GITHUB_SHA??null,
 platform:process.platform,arch:process.arch,node:process.version,
 method:'Production Scene.step (60Hz), 160 consecutive frames, identical KernelProgram dispatch for baseline and optional plugin, opt-in Scene profiler, history 128; single collision followed by propagating and reflecting waves. Same compiled World v3 scene and immutable medium specification. CPU runner only, wave grid 40×10×20 and CFL-compliant substeps. Benchmark reports CPU per-scene tick, not renderer FPS or end-to-end audio perceptual quality.',
 measurements,
};
mkdirSync(resolve(root,'artifacts/world-acoustics'),{recursive:true});
writeFileSync(resolve(root,'artifacts/world-acoustics/benchmark.json'),JSON.stringify(report,null,2)+'\n');
