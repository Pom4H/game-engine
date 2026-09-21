import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';

const file=resolve(process.argv[2]??'artifacts/performance/clear-day.json');
const report=JSON.parse(await readFile(file,'utf8'));
const single=report.results?.length===1?report.results[0]:undefined;
const width=Number(process.env.PERF_WIDTH??single?.width??1920),height=Number(process.env.PERF_HEIGHT??single?.height??1080);
const minFps=Number(process.env.MIN_COMPLETED_FPS??59);
const maxP95=Number(process.env.MAX_P95_FRAME_MS??18);
const minRealtime=Number(process.env.MIN_SIMULATION_TO_WALL??.97);
const maxGpuP95=Number(process.env.MAX_GPU_P95_MS??16.67);
const result=report.results?.find(r=>r.width===width&&r.height===height);
if(!result)throw new Error(`No ${width}x${height} benchmark result in ${file}`);
const failures=[];
if(result.completedFps<minFps)failures.push(`completedFps ${result.completedFps.toFixed(2)} < ${minFps}`);
if(result.submittedFps<minFps)failures.push(`submittedFps ${result.submittedFps.toFixed(2)} < ${minFps}`);
if(result.p95FrameMs>maxP95)failures.push(`p95FrameMs ${result.p95FrameMs.toFixed(2)} > ${maxP95}`);
if(result.simulationToWallRatio<minRealtime)failures.push(`simulationToWallRatio ${result.simulationToWallRatio.toFixed(3)} < ${minRealtime}`);
const gpuP95=result.renderProfile?.gpuTotal?.p95Ms;
if(Number.isFinite(gpuP95)&&gpuP95>maxGpuP95)failures.push(`GPU p95 ${gpuP95.toFixed(2)} ms > ${maxGpuP95} ms`);
const errors=result.renderer?.errors??[];
if(errors.length)failures.push(`renderer errors: ${errors.join('; ')}`);
console.log(JSON.stringify({
  scene:report.scene,resolution:`${width}x${height}`,
  submittedFps:result.submittedFps,completedFps:result.completedFps,p95FrameMs:result.p95FrameMs,
  gpuP95Ms:gpuP95??null,simulationToWallRatio:result.simulationToWallRatio,
  gpu:result.renderProfile?.gpu??null,cpu:result.renderProfile?.cpu??null,
},null,2));
if(failures.length)throw new Error('60 fps gate failed: '+failures.join(', '));
