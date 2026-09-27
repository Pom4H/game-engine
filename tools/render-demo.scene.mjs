import scene from './promo/clear-day.scene.mjs';
export {scene};
if(typeof window!=='undefined'){
  try{
    const {BrowserRuntime}=await import('/dist/runtime/browser.js');
    const canvas=document.getElementById('c');
    canvas.width=innerWidth;canvas.height=innerHeight;
    const runtime=await BrowserRuntime.create(canvas,scene,{autoplay:false,audio:false,exposeBridge:true});
    globalThis.__CAPTURE__=()=>runtime.capture('image/png');
    document.documentElement.dataset.engineReady='1';
  }catch(error){window.__ENGINE_ERROR__=error?.stack??String(error);throw error}
}
