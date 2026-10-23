const assert=(condition,message)=>{if(!condition)throw new Error(message);};
// Verification measures submitted renderer work. Avoid background-tab rAF throttling.
const settle=async renderer=>{await renderer.flush();await new Promise(resolve=>setTimeout(resolve,0));};
async function save(name,body){const response=await fetch('/__verify/'+name,{method:'POST',body});if(!response.ok)throw new Error('Запусти сервер с --verify для сохранения эталона ('+response.status+')');}

/** Fixed input/ticks, fixed cameras, fixed temporal sampling. No wall-clock simulation. */
export async function verifyWinter(runtime,episode,controls,canvas){
 assert(runtime.scene.tick===0,'Перезагрузи страницу перед повторной проверкой');
 runtime.pause();controls.enter(false);
 const walk=(code,ticks)=>{
  canvas.dispatchEvent(new KeyboardEvent('keydown',{code,bubbles:true}));
  try{runtime.step(ticks);}finally{window.dispatchEvent(new KeyboardEvent('keyup',{code,bubbles:true}));}
 };
 const views=[],renderer=runtime.renderer,scene=runtime.scene;
 const capture=async(id,camera)=>{
  document.getElementById('status').textContent='Контрольный ракурс: '+id;
  scene.camera=camera;renderer.resetTemporalHistory();
  for(let i=0;i<24;i++){renderer.setTimelineFrame(i);renderer.render(scene);await settle(renderer);}
  await renderer.flush();renderer.resetProfile();
  for(let i=24;i<84;i++){renderer.setTimelineFrame(i);renderer.render(scene);await settle(renderer);}
  await renderer.flush();
  const stats=renderer.inspect(),profile=renderer.profile();assert(stats.errors.length===0,stats.errors.join('\n'));
  assert(profile.cpuFrames===60,'Unexpected profiling frame count');
  const points=[];for(let y=0;y<16;y++)for(let x=0;x<24;x++)points.push([Math.round((x+.5)*1280/24),Math.round((y+.5)*720/16)]);
  const pixels=await renderer.sampleLinearPixels(points,'taa');
  assert(pixels.every(p=>p.rgba.every(Number.isFinite)),'Non-finite scene-linear pixels');
  assert(pixels.some(p=>p.rgba.slice(0,3).some(v=>v>.02)),'Empty or black frame');
  // Readback holds the resolved image; present it once more before canvas export.
  renderer.setTimelineFrame(83);renderer.render(scene);await renderer.flush();
  const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/png'));assert(blob,'Canvas capture failed');await save(id+'.png',blob);
  views.push({id,camera,tick:scene.tick,width:1280,height:720,pixels,profile,drawCalls:stats.drawCalls,triangles:stats.triangles});
 };
 await capture('courtyard',{position:[-9.3,3.3,4.3],target:[-1,.8,1.3],fov:58});
 assert(!episode.interact(),'Interaction must fail before approaching the car');
 walk('KeyW',225);walk('KeyA',55);
 assert(episode.inspect().footprints>=8,'Walking did not leave footprints');
 await capture('footprints',{position:[-3,.68,3.85],target:[-4,.13,2.8],fov:53});
 assert(episode.interact(),'Car interaction unavailable from the path');runtime.step(120);
 assert(episode.inspect().sprayEmitted>=12,'Wet wheels did not produce spray');
 await capture('wet-tyres',{position:[5,1.12,1.05],target:[2.8,.55,-1.2],fov:52});
 walk('KeyW',337);walk('KeyD',45);
 assert(episode.inspect().complete,'The walk did not reach its final goal');
 await capture('finish',{position:[3.4,2.3,4.8],target:[7,1,3],fov:53});
 controls.setActive(false);
 const report={version:1,scene:'winter-courtyard',input:'W225,A55,idle120,W337,D45 at 60 Hz',userAgent:navigator.userAgent,state:episode.inspect(),views};
 await save('report.json',JSON.stringify(report,null,2));return report;
}
