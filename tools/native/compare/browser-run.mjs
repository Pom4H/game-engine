import {createServer} from 'node:http';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve,join,relative,isAbsolute} from 'node:path';
import {startBrowser} from './browser.mjs';
import {encodePNG} from '../core.mjs';
import {createHash} from 'node:crypto';

const engine=resolve(process.env.ENGINE_ROOT??join(import.meta.dirname,'../../..'));
const input=resolve(process.env.COMPARE_INPUT??join(engine,'artifacts/native-game-compare/game-scene.json.gz'));
const output=resolve(process.env.COMPARE_OUTPUT??join(engine,'artifacts/native-game-compare/browser-smoke'));await mkdir(output,{recursive:true});
const frames=Number(process.env.COMPARE_FRAMES??180),warmup=Number(process.env.COMPARE_WARMUP??180),repetitions=Number(process.env.COMPARE_REPETITIONS??3);
const mode=process.env.COMPARE_MODE??'pipelined';if(!['baseline','worker','pipelined'].includes(mode))throw new Error('Invalid COMPARE_MODE');
const page=`<!doctype html><html><meta charset="utf-8"><style>html,body{margin:0;overflow:hidden;background:#000}canvas{display:block;width:1280px;height:720px}</style><canvas width="1280" height="720"></canvas><script type="module">
import {Scene} from '/engine/scene/scene.js';import {WebGPURenderer} from '/engine/render/webgpu.js';
import {assertComparisonAPI,restoreScene,installAssets,rendererOptions,postOptions,measure,settleCanonical,readPresentation} from '/common.mjs';
try{
 assertComparisonAPI(Scene,WebGPURenderer);
 const began=performance.now();
 const canvas=document.querySelector('canvas'),configure=GPUCanvasContext.prototype.configure;GPUCanvasContext.prototype.configure=function(o){return configure.call(this,{...o,usage:(o.usage??16)|1});};
 const request=navigator.gpu.requestAdapter.bind(navigator.gpu);let adapterInfo;
 navigator.gpu.requestAdapter=async o=>{const a=await request(o),i=a.info;adapterInfo={vendor:i.vendor,architecture:i.architecture,device:i.device,description:i.description,isFallbackAdapter:i.isFallbackAdapter??a.isFallbackAdapter??false};return a;};
 const packed=await(await fetch('/scene.gz')).arrayBuffer(),json=await new Response(new Blob([packed]).stream().pipeThrough(new DecompressionStream('gzip'))).text(),packet=JSON.parse(json);
 const scene=restoreScene(packet,Scene),renderer=await WebGPURenderer.create(canvas,rendererOptions);renderer.setResolution(1280,720);renderer.configurePostProcessing(postOptions);renderer.setBackgroundEnvironmentMaps(${mode!=='baseline'});await installAssets(renderer,packet.assets);
 const startupMs=performance.now()-began;window.compareReady=true;const runs=[];
 for(let repetition=0;repetition<${repetitions};repetition++)for(const moving of repetition%2?[true,false]:[false,true])runs.push({...await measure({scene,renderer,baseCamera:packet.camera,frames:${frames},warmup:${warmup},moving,pipelined:${mode==='pipelined'},beforeFrame:()=>new Promise(requestAnimationFrame)}),repetition});
 await settleCanonical({scene,renderer,baseCamera:packet.camera,beforeFrame:()=>new Promise(requestAnimationFrame)});
 await new Promise(requestAnimationFrame);renderer.setTimelineFrame(64);renderer.render(scene);
 const rgba=await readPresentation(renderer.device,canvas.getContext('webgpu').getCurrentTexture(),1280,720,navigator.gpu.getPreferredCanvasFormat());await renderer.flush();
 await fetch('/frame',{method:'POST',body:rgba});
 const report={status:'success',runtime:'browser',mode:${JSON.stringify(mode)},width:1280,height:720,startupMs,adapter:adapterInfo,entities:scene.entities.size,options:rendererOptions,postOptions,runs};
 await fetch('/report',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(report)});window.compareDone=true;
}catch(e){window.compareError=e.stack??String(e);console.error(e);}
</script></html>`;
const server=createServer(async(req,res)=>{
 try{
  if(req.method==='POST'){const chunks=[];for await(const c of req)chunks.push(c);const bytes=Buffer.concat(chunks);
   if(req.url==='/frame'){await writeFile(join(output,'frame.rgba'),bytes);await writeFile(join(output,'frame.png'),encodePNG(bytes,1280,720));}
   else if(req.url==='/report'){const r=JSON.parse(bytes);r.sceneSha256=createHash('sha256').update(await readFile(input)).digest('hex');await writeFile(join(output,'report.json'),JSON.stringify(r,null,2));}
   else throw new Error('Invalid comparison output');res.end('ok');return;
  }
  if(req.url==='/'){res.setHeader('content-type','text/html');res.end(page);return;}
  if(req.url==='/scene.gz'){res.end(await readFile(input));return;}
  let path;if(req.url==='/common.mjs')path=join(import.meta.dirname,'common.mjs');
  else if(req.url==='/frame-queue.mjs')path=join(import.meta.dirname,'../frame-queue.mjs');
  else if(req.url.startsWith('/engine/')){const root=join(engine,'dist');path=resolve(root,req.url.slice(8));const rel=relative(root,path);if(isAbsolute(rel)||rel.startsWith('..'))throw new Error('Outside engine build');}
  else {res.writeHead(404);res.end();return;}
  res.setHeader('content-type','text/javascript');res.end(await readFile(path));
 }catch(e){res.writeHead(500);res.end(String(e));}
});await new Promise(r=>server.listen(0,'127.0.0.1',r));
const browser=await startBrowser({headful:process.env.COMPARE_HEADFUL!=='0'});const diagnostics=[];
browser.onEvent(m=>{if(m.method==='Runtime.exceptionThrown')diagnostics.push(m.params.exceptionDetails);});
try{
 await browser.send('Page.navigate',{url:`http://127.0.0.1:${server.address().port}/`});await browser.send('Page.bringToFront');
 console.log('Waiting for browser game replay');
 await browser.waitFor('window.compareReady||window.compareError',300);const first=await browser.evaluate('window.compareError??null');if(first)throw new Error(first);
 console.log('browser-game-ready');await browser.waitFor('window.compareDone||window.compareError',300);const error=await browser.evaluate('window.compareError??null');if(error)throw new Error(error);
 if(diagnostics.length)throw new Error(JSON.stringify(diagnostics));
 const report=JSON.parse(await readFile(join(output,'report.json'),'utf8'));report.browser={executable:browser.executable,args:browser.args,version:await browser.send('Browser.getVersion')};await writeFile(join(output,'report.json'),JSON.stringify(report,null,2));
 console.log(JSON.stringify(report.runs.map(r=>({moving:r.moving,summary:r.summary}))));
}finally{await browser.close();server.closeAllConnections();await new Promise(r=>server.close(r));}
