import {BrowserRuntime} from './runtime/browser.js';
import {demoScene} from './demo.js';
import {sceneFromURL} from './scene/url.js';
import type {SceneSpec} from './scene/types.js';

async function main(){
  const canvas=document.querySelector<HTMLCanvasElement>('canvas[data-game-engine]')??document.querySelector<HTMLCanvasElement>('canvas');
  if(!canvas)throw new Error('Expected <canvas data-game-engine>');
  let scene:SceneSpec=demoScene; let options:{time:number;paused:boolean;camera?:import('./scene/types.js').CameraSpec}={time:0,paused:false};
  try{const loaded=await sceneFromURL(location.href);scene=loaded.scene;options=loaded.options;}catch(error){if(new URL(location.href).searchParams.has('src')||location.hash.includes('scene='))throw error;}
  const runtime=await BrowserRuntime.create(canvas,scene,{autoplay:false,exposeBridge:true});
  if(options.camera)runtime.setCamera(options.camera);
  if(options.time>0)runtime.seek(options.time);
  if(!options.paused)runtime.resume();
  document.documentElement.dataset.engineReady='true';
}
main().catch(error=>{console.error(error);document.documentElement.dataset.engineError=error instanceof Error?error.message:String(error);});
