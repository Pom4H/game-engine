import {readFile,writeFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {aggregate,comparePixels} from './analyze.mjs';
import {encodePNG} from '../core.mjs';

const engine=resolve(process.env.ENGINE_ROOT??join(import.meta.dirname,'../../..'));
const root=resolve(process.env.COMPARE_BACKEND_ROOT??join(engine,'artifacts/native-game-compare/native-backends'));
const reports={};for(const backend of ['d3d12','vulkan'])reports[backend]=JSON.parse(await readFile(join(root,backend,'report.json')));
const a=reports.d3d12,b=reports.vulkan;
if(a.status!=='success'||b.status!=='success'||!a.compiled||!b.compiled||a.adapter.backend!=='d3d12'||b.adapter.backend!=='vulkan')throw new Error('Completed compiled hardware runs with explicit backends are required');
if(!a.exeSha256||a.exeSha256!==b.exeSha256||a.sceneSha256!==b.sceneSha256||a.width!==b.width||a.height!==b.height||JSON.stringify(a.options)!==JSON.stringify(b.options)||JSON.stringify(a.postOptions)!==JSON.stringify(b.postOptions)||a.entities!==b.entities)throw new Error('Backend comparison inputs/builds differ');
if(JSON.stringify(a.runs.map(r=>[r.moving,r.frames,r.warmup,r.repetition]))!==JSON.stringify(b.runs.map(r=>[r.moving,r.frames,r.warmup,r.repetition])))throw new Error('Backend measurement protocols differ');
for(const report of Object.values(reports))if(report.adapter.isFallbackAdapter||report.runs.some(r=>r.renderer.errors.length))throw new Error('Fallback adapter or GPU error');
const pixels={};for(const backend of ['d3d12','vulkan'])pixels[backend]=await readFile(join(root,backend,'frame.rgba'));
const {metrics,diff}=comparePixels(pixels.d3d12,pixels.vulkan,a.width,a.height);
await writeFile(join(root,'difference-x255.png'),encodePNG(diff,a.width,a.height));
const pair=Buffer.alloc(a.width*2*a.height*4),row=a.width*4;for(let y=0;y<a.height;y++){pixels.d3d12.copy(pair,y*row*2,y*row,(y+1)*row);pixels.vulkan.copy(pair,y*row*2+row,y*row,(y+1)*row);}
await writeFile(join(root,'d3d12-vulkan.png'),encodePNG(pair,a.width*2,a.height));
const report={date:new Date().toISOString(),scope:'Native D3D12 vs Vulkan, same compiled executable, recorded TheGame scene and render-loop protocol',width:a.width,height:a.height,entities:a.entities,exeSha256:a.exeSha256,sceneSha256:a.sceneSha256,
 options:a.options,postOptions:a.postOptions,quality:metrics,results:Object.fromEntries(Object.entries(reports).map(([key,r])=>[key,{adapter:r.adapter,bunVersion:r.bunVersion,startupMs:r.startupMs,static:aggregate(r,false),camera:aggregate(r,true)}])),
 limitations:['Same-machine diagnostic, one repetition per backend/case, 180 path warmup + 180 measured frames per case. Vulkan ran first, D3D12 second. No random-order or thermal control.',
  'Both backends deliberately retain synchronous environment-map baking and per-frame GPU completion/presentation/timer. These are render-loop start intervals, not externally measured display presentation or complete native gameplay.',
  'No claim that changing the backend repairs CPU stalls. GPU timestamps and CPU submission are recorded separately. Cold startup includes scene restore, pipeline compilation and assets; cache state differs.',
  'The renderer is the current local Engine build, matching the preceding recorded game comparison; its dist fingerprint and dirty working-tree provenance are preserved separately.']};
await writeFile(join(root,'summary.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({quality:metrics,results:report.results}));
