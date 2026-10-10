import {readFileSync,mkdirSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {performance} from 'node:perf_hooks';
import {fileURLToPath} from 'node:url';
import {AcousticWaveField} from '../../dist/physics/wave-field.js';
import {createWasmAcousticWaveField} from '../../dist/physics/wave-wasm.js';
const root=resolve(fileURLToPath(new URL('../..',import.meta.url)));
const wasm=await WebAssembly.compile(new Uint8Array(readFileSync(resolve(root,'kernels/world-wave/target/wasm32-unknown-unknown/release/world_wave_kernel.wasm'))));
const profile=process.argv.includes('--quick')?
  [{size:[32,8,32],ticks:100}]:
  [{size:[32,8,32],ticks:200},{size:[64,16,64],ticks:160},{size:[96,24,96],ticks:120}];
function setup(field){
 const [nx,ny,nz]=field.size;
 const x=Math.floor(nx/4),y=Math.floor(ny/2),z=Math.floor(nz/2);
 field.addPressureCell(x,y,z,100);
 const wallX=Math.floor(nx*.6);
 for(let iz=0;iz<nz;iz++)for(let iy=0;iy<ny;iy++)if((iy+iz)%11!==0)field.setSolidCell(wallX,iy,iz);
}
async function run(backend,size,ticks){
 const spec={size,cellSizeM:.5,waveSpeedMps:343,densityKgM3:1.225,velocityDampingPerSecond:4};
 const field=backend==='wasm'?await createWasmAcousticWaveField(spec,wasm):new AcousticWaveField(spec);
 try{
  setup(field);
  const dt=field.maxStableDt*.7;
  for(let i=0;i<30;i++)field.step(dt); // warm up, outside timed section
  const rounds=[];
  for(let r=0;r<5;r++){
   const start=performance.now();
   for(let i=0;i<ticks;i++)field.step(dt);
   rounds.push((performance.now()-start)/ticks);
  }
  return{roundsMs:rounds,compressionEnergyJ:field.compressionEnergyJ()};
 }finally{field.dispose();}
}
const rows=[];
for(const {size,ticks} of profile){
 const js=await run('typescript',size,ticks);
 const wasmResult=await run('wasm',size,ticks);
 const median=values=>[...values].sort((a,b)=>a-b)[Math.floor(values.length/2)];
 const jsMedian=median(js.roundsMs),wasmMedian=median(wasmResult.roundsMs);
 rows.push({size,ticks,jsMedianMs:jsMedian,wasmMedianMs:wasmMedian,
  speedup:jsMedian/wasmMedian,js,wasm:wasmResult});
 console.log(size.join('x')+' — JS '+jsMedian.toFixed(4)+'ms/tick, WASM '+wasmMedian.toFixed(4)+'ms/tick, ratio '+(jsMedian/wasmMedian).toFixed(2)+'x');
}
const report={schema:1,sourceCommit:process.env.GITHUB_SHA??null,node:process.version,platform:process.platform,arch:process.arch,
 methods:'serial JS vs Rust WASM FDTD; same grid, wall, pressure, dt; 30 warmup ticks excluded; five rounds per backend',rows};
mkdirSync(resolve(root,'artifacts/world-wave'),{recursive:true});
writeFileSync(resolve(root,'artifacts/world-wave/benchmark.json'),JSON.stringify(report,null,2)+'\n');
