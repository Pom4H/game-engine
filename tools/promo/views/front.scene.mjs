import base from '../clear-day.scene.mjs';

const scene={...base,camera:{...base.camera,position:[-14.2,1.05,-1.38],target:[-20.55,.72,-1.38],fov:30,focusDistance:6.2,aperture:.06}};
export {scene};
export default scene;

if(typeof window!=='undefined'){
  try{
    const {BrowserRuntime}=await import('/dist/runtime/browser.js');
    const canvas=document.getElementById('c');
    canvas.width=innerWidth;canvas.height=innerHeight;
    await BrowserRuntime.create(canvas,scene,{autoplay:false,audio:false,exposeBridge:true});
    document.documentElement.dataset.engineReady='1';
  }catch(error){window.__ENGINE_ERROR__=error?.stack??String(error);throw error}
}
