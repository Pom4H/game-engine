import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {gunzipSync} from 'node:zlib';
import {resolve,dirname} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {createHash} from 'node:crypto';
import {NativeHost} from '../host.mjs';
import {encodePNG} from '../core.mjs';
import {NativeEnvironmentWorker,nativeEnvironmentEntry} from '../environment-worker.mjs';
import {restoreScene,installAssets,rendererOptions,postOptions,measure,settleCanonical} from './common.mjs';

export async function runNative({Scene,WebGPURenderer,compiled=false}){
 const began=performance.now();
 const input=resolve(process.env.COMPARE_INPUT??(compiled?resolve(dirname(process.execPath),'game-scene.json.gz'):'artifacts/native-game-compare/game-scene.json.gz'));
 const output=resolve(process.env.COMPARE_OUTPUT??'artifacts/native-game-compare/native');await mkdir(output,{recursive:true});
 const bytes=await readFile(input),packet=JSON.parse(gunzipSync(bytes)),width=1280,height=720;
 const mode=process.env.COMPARE_MODE??'pipelined';if(!['baseline','worker','pipelined'].includes(mode))throw new Error('COMPARE_MODE must be baseline, worker or pipelined');
 const renderFps=Number(process.env.COMPARE_RENDER_FPS??60);if(!Number.isInteger(renderFps)||renderFps<0||renderFps>240)throw new Error('Invalid COMPARE_RENDER_FPS');
 const scene=restoreScene(packet,Scene);let host,renderer,environmentWorker;
 try{
  host=await NativeHost.create({compiled,headless:false,width,height,backend:process.env.COMPARE_BACKEND??'auto'});
  renderer=await WebGPURenderer.create(host.canvas,rendererOptions);renderer.setResolution(width,height);renderer.configurePostProcessing(postOptions);
  renderer.setBackgroundEnvironmentMaps(mode!=='baseline',()=>environmentWorker=new NativeEnvironmentWorker(nativeEnvironmentEntry(compiled),error=>host.errors.push(error.message)));
  if(mode!=='baseline'&&(!environmentWorker||renderer.inspect().environmentBaking?.failed))throw new Error('Renderer needs the native environment worker factory hook');
  await installAssets(renderer,packet.assets);
  const startupMs=performance.now()-began;console.log('native-game-ready',host.adapterInfo.backend,scene.entities.size,'startupMs',startupMs.toFixed(1));
  const runs=[];
  for(let repetition=0;repetition<Number(process.env.COMPARE_REPETITIONS??3);repetition++)for(const moving of repetition%2?[true,false]:[false,true]){
   const run=await measure({scene,renderer,baseCamera:packet.camera,frames:Number(process.env.COMPARE_FRAMES??180),warmup:Number(process.env.COMPARE_WARMUP??180),moving,pipelined:mode==='pipelined',
    beforeFrame:async queue=>{if(host.needsResize())await queue?.drain();if(!host.syncSize()||host.canvas.width!==width||host.canvas.height!==height)throw new Error('Native window size changed during measurement');},
    present:()=>{host.assertHealthy();host.present();},afterFrame:start=>delay(renderFps?Math.max(1,1000/renderFps-(performance.now()-start)):0)});
   runs.push({...run,repetition});console.log('native measured',repetition,moving?'camera':'static',JSON.stringify(run.summary));
   await writeFile(resolve(output,'progress.json'),JSON.stringify({mode,runs,environmentWorker:environmentWorker?.inspect()},null,2));
  }
  await settleCanonical({scene,renderer,baseCamera:packet.camera,present:()=>host.present()});
  renderer.setTimelineFrame(64);renderer.render(scene);const pixels=await host.captureRGBA();await renderer.flush();host.present();
  await writeFile(resolve(output,'frame.png'),encodePNG(pixels.rgba,width,height));
  await writeFile(resolve(output,'frame.rgba'),pixels.rgba);
  const report={status:'success',runtime:'bun',mode,renderFps,environmentWorker:environmentWorker?.inspect()??null,bunVersion:Bun.version,compiled,width,height,startupMs,adapter:host.adapterInfo,nativeBinding:host.bindings.compatibility,exeSha256:createHash('sha256').update(await readFile(process.execPath)).digest('hex'),
   sceneSha256:createHash('sha256').update(bytes).digest('hex'),entities:scene.entities.size,options:rendererOptions,postOptions,runs};
  await writeFile(resolve(output,'report.json'),JSON.stringify(report,null,2));
 }finally{try{await renderer?.flush();}finally{try{renderer?.dispose();await environmentWorker?.termination;}finally{host?.close();}}}
}
