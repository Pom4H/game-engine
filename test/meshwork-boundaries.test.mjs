import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync,statSync} from 'node:fs';
import {join,relative,resolve} from 'node:path';
import {contentRef,defineRenderFrame,defineRenderProgram} from '../dist/render-ir/index.js';
import {defineExecutionGraph,localProgram} from '../dist/execution/index.js';
import {decideSegmentResult,defineSegmentTask} from '../dist/meshwork/index.js';

const ROOT=resolve(process.cwd(),'src');
const filesUnder=dir=>{const out=[];const walk=p=>{for(const name of readdirSync(p)){const file=join(p,name);statSync(file).isDirectory()?walk(file):file.endsWith('.ts')&&out.push(file);}};walk(resolve(ROOT,dir));return out;};

test('render and engine hot-path packages cannot import Meshwork',()=>{
 const protectedFiles=[...filesUnder('render'),...filesUnder('scene'),...filesUnder('core'),resolve(ROOT,'runtime/browser.ts')];
 for(const file of protectedFiles){const source=readFileSync(file,'utf8');assert.doesNotMatch(source,/from\s+['"][^'"]*meshwork|import\s*\([^)]*meshwork/i,relative(ROOT,file));}
 const root=readFileSync(resolve(ROOT,'index.ts'),'utf8');assert.doesNotMatch(root,/meshwork|render-ir\/index|execution\/index/i,'root package must not re-export distributed/runtime-boundary packages');
});
test('portable render IR has no Scene/backend/placement imports',()=>{
 const source=readFileSync(resolve(ROOT,'render-ir/index.ts'),'utf8');assert.doesNotMatch(source,/from\s+['"][^'"]*(scene|render\/|meshwork|execution)/i);
 const frame=defineRenderFrame({schema:1,simulationTick:7n,frame:12n,camera:[1,0,0,0],objects:[{id:'box',mesh:contentRef('mesh','mesh:1'),material:contentRef('material','mat:1'),transform:[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1]}],lights:[],resources:{resources:[]},temporal:{},determinism:{epoch:2n,frame:12n,stochasticSequence:99n}});
 assert.ok(Object.isFrozen(frame)&&Object.isFrozen(frame.objects));
});
test('placement is outside render semantics and local execution remains synchronous metadata',()=>{
 const program=defineRenderProgram({schema:1,programHash:'program:abc',profileHash:'profile:full',partitionability:{kind:'temporal',warmupFrames:4},requiredResources:{resources:[]}});
 const graph=defineExecutionGraph({schema:1,graphHash:'graph:abc',nodes:[{id:'render.final',operation:'render.final',inputs:[],outputs:[],deterministic:true,partitionability:program.partitionability}]});
 const local=localProgram(graph);assert.equal(local.placement,'local');assert.equal(local.graph,graph);assert.equal('then' in local,false,'local program boundary must not be Promise-like');
});
test('worker-local finish time never decides a coordinator deadline',()=>{
 const task=defineSegmentTask({streamId:'stream',epoch:4n,segment:9n,attempt:1,firstOutputFrame:100n,outputFrames:24,warmupFrames:4,programHash:'program:1',checkpointHash:'checkpoint:1',resourceManifestHash:'manifest:1',cameraHash:'camera:1',renderProfileHash:'profile:1',deadlineNs:1000n});
 const result={streamId:'stream',epoch:4n,segment:9n,attempt:1,firstFrame:100n,frameCount:24,inputHash:'input:1',outputHash:'output:1',finishedNs:99_999_999n};
 assert.equal(decideSegmentResult(task,result,4n,false),'accept');assert.equal(decideSegmentResult(task,result,5n,false),'stale-epoch');assert.equal(decideSegmentResult(task,result,4n,true),'already-committed');assert.equal(decideSegmentResult(task,{...result,attempt:2},4n,false),'wrong-task');
});
