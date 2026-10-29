// CPU numerical benchmarks only. This does not render on the CPU and does not
// claim whole-engine FPS, whole-physics-tick speedup or GPU-runner evidence.
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {cpus,platform,arch} from 'node:os';
import {createHash} from 'node:crypto';
import {createRustKernelRuntime,RustKernelPass as P} from '../../dist/rust.js';
import {solveWheelContact} from '../../dist/physics/wheel-contact.js';
import {applyStructuralSkin} from '../../dist/physics/structural-skin.js';
import {m3StructuralBlueprint} from '../../dist/vehicles/m3.js';
import {material} from '../../dist/materials/catalog.js';
const wasm=await readFile(process.env.ROM4_RUST_WASM??new URL('../../artifacts/rust-engine/rom4-engine.scalar.wasm',import.meta.url));
const runtime=await createRustKernelRuntime(wasm),results=[];let checksum=0;
const time=fn=>{const start=process.hrtime.bigint();fn();return Number(process.hrtime.bigint()-start)/1e6;};
const quantile=(a,q)=>{const s=[...a].sort((x,y)=>x-y);return s[Math.floor((s.length-1)*q)];};
function measure(name,js,native,consume,meta){
  for(let i=0;i<100;i++){js();native();}
  let repetitions=1;
  while(repetitions<4096){const n=repetitions;if(time(()=>{for(let i=0;i<n;i++)js();})>=15)break;repetitions*=2;}
  const a=[],b=[],ratios=[];
  for(let sample=0;sample<21;sample++){
    let ta,tb;const run=f=>time(()=>{for(let i=0;i<repetitions;i++)f();})/repetitions;
    if(sample%2){tb=run(native);ta=run(js);}else{ta=run(js);tb=run(native);}
    a.push(ta);b.push(tb);ratios.push(ta/tb);checksum+=consume();
  }
  results.push({name,...meta,repetitions,samples:21,jsMs:{median:quantile(a,.5),p95:quantile(a,.95)},
    rustMs:{median:quantile(b,.5),p95:quantile(b,.95)},pairedSpeedup:{median:quantile(ratios,.5),p05:quantile(ratios,.05),p95:quantile(ratios,.95)},raw:{js:a,rust:b}});
}
try {
  for(const count of [4,64,1024]){
    const b=runtime.createBatch({wheelCount:count}),a=b.buffers.wheelInput,reference=new Float64Array(count*7),o={};
    for(let i=0;i<count;i++)a.set([1/120,.33,1.2,(i%29)-10,8,.15,4000,550,100,.001,0,0,.2,12,9.5],i*15);
    const js=()=>{for(let i=0;i<count;i++){const j=i*15;solveWheelContact(o,a[j],a[j+1],a[j+2],a[j+3],a[j+4],a[j+5],a[j+6],a[j+7],a[j+8],a[j+9],a[j+10],a[j+11],a[j+12],a[j+13],a[j+14]);const k=i*7;reference[k]=o.force;reference[k+1]=o.sideForce;reference[k+2]=o.speed;reference[k+3]=o.slip;reference[k+4]=o.brake;reference[k+5]=o.targetForce;reference[k+6]=o.targetSide;}};
    const native=()=>b.execute(P.Wheels);js();native();
    for(let i=0;i<reference.length;i++)if(Math.abs(reference[i]-b.buffers.wheelOutput[i])>1e-7+Math.abs(reference[i])*1e-9)throw new Error('Wheel benchmark parity failed');
    measure(`wheel-batch-${count}`,js,native,()=>reference[0]+b.buffers.wheelOutput[0],{kind:'independent numerical batch',count,includesAbi:true,includesInputCopy:false});b.dispose();
  }
  const blueprint=m3StructuralBlueprint(1700,material('steel').mechanical),skin=blueprint.skin;
  const b=runtime.createBatch({nodeCount:blueprint.definition.nodes.length,vertexCount:skin.vertexCount,influences:skin.influences}),v=b.buffers;
  const nodeRest=Float64Array.from(blueprint.definition.nodes.flatMap(n=>n.position)),pose=new Float64Array(nodeRest),output=new Float64Array(skin.rest.length);
  for(let i=0;i<pose.length;i++)pose[i]+=.03*Math.sin(i*1.7);
  v.nodeRest.set(nodeRest);v.skinRest.set(skin.rest);v.skinNodes.set(skin.nodes);v.skinWeights.set(skin.weights);
  const js=()=>applyStructuralSkin(skin,nodeRest,pose,output);
  const native=()=>{b.buffers.positions.set(pose);b.execute(P.Skin);};js();native();
  for(let i=0;i<output.length;i++)if(Math.abs(output[i]-v.skinPositions[i])>1e-9)throw new Error('M3 benchmark parity failed');
  measure('M3-skin-with-node-transfer',js,native,()=>output[0]+b.buffers.skinPositions[0],
    {kind:'actual M3 geometry projection, not physics tick',vertices:skin.vertexCount,nodes:nodeRest.length/3,includesAbi:true,includesInputCopy:true});b.dispose();
} finally {runtime.dispose();}
const report={schema:1,at:new Date().toISOString(),claimScope:'numerical batches and M3 skin projection only; no whole-engine or FPS claim',
  environment:{node:process.version,platform:platform(),arch:arch(),cpu:cpus()[0]?.model},
  wasm:{bytes:wasm.length,sha256:createHash('sha256').update(wasm).digest('hex')},checksum,results};
if(!Number.isFinite(checksum))throw new Error('Non-finite benchmark output');
const directory=new URL('../../artifacts/rust-engine/',import.meta.url);await mkdir(directory,{recursive:true});
const path=new URL(process.env.ROM4_BENCHMARK_NAME??'benchmark.json',directory);await writeFile(path,JSON.stringify(report,null,2)+'\n');
console.table(results.map(r=>({case:r.name,jsMedianMs:r.jsMs.median,rustMedianMs:r.rustMs.median,medianSpeedup:r.pairedSpeedup.median})));
console.log(path.pathname);
