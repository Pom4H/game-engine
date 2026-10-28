import {mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {Scene} from '../../dist/scene/scene.js';
import {CpuRenderer,encodePng} from '../../dist/render/cpu.js';
import {ConversationFaceRig,conversationFaceEntities,conversationHeadMesh} from '../../dist/animation/conversation-face.js';
import {NPC_NEEDS,ActingRig,createNpcMind,stepNpcMind,perceiveNpcOutcome,makeActingCue} from '../../dist/acting/index.js';

// A small native rig, with no dependency on a game population or dialogue service.
export function createActingDemo(){
 const skin=[.65,.43,.31,1],cloth=[.20,.39,.51,1],entities=[],bindings=[];
 const part=(id,joint,mesh,scale,color,extra={})=>{
  entities.push({id,mesh,material:{color,roughness:.8}});
  bindings.push({entity:id,joint,scale,...extra});
 };
 part('torso','chest',{kind:'box',size:[1,1,1]},[.25,.53,.40],cloth,{offset:[0,-.06,0]});
 part('neck','neck',{kind:'cylinder',radius:.5,height:1,segments:12},[.09,.15,.09],skin);
 part('head','head',conversationHeadMesh(),[.185,.225,.178],skin);
 part('nose','head',{kind:'sphere',radius:.5,segments:12},[.035,.04,.03],skin,{offset:[.094,-.005,0]});
 for(const side of ['left','right']){
  for(const [label,from,to,width,color] of [
   ['upper-arm','Shoulder','Elbow',.11,cloth],['forearm','Elbow','Hand',.09,cloth],
   ['thigh','Hip','Knee',.14,[.16,.19,.24,1]],['shin','Knee','Ankle',.11,[.16,.19,.24,1]],
  ])part(`${side}-${label}`,side+from,{kind:'cylinder',radius:.5,height:1,segments:12},[width,1,width],color,{boneTo:side+to});
  part(`${side}-hand`,side+'Hand',{kind:'sphere',radius:.5,segments:12},[.085,.12,.075],skin,{offset:[0,-.025,0],orientFrom:side+'Elbow'});
  part(`${side}-boot`,side+'Foot',{kind:'box',size:[1,1,1]},[.26,.12,.13],[.11,.10,.09,1],{offset:[.045,.06,0],foot:side});
 }
 const scene=new Scene({version:1,gravity:[0,0,0],ground:-100,
  camera:{position:[3,1.9,2.9],target:[0,1.05,0],fov:35},
  rendering:{sunDirection:[-.7,-1,-.6],sunIntensity:2,skyColor:[.18,.23,.29],exposure:1.1},
  entities:[...entities,...conversationFaceEntities({id:'anna',skin}),
   {id:'floor',position:[0,-.03,0],mesh:{kind:'box',size:[10,.05,10]},material:{color:[.18,.22,.25,1],roughness:1}}],
  animation:{walkers:[{id:'anna',root:[0,0,0],heading:0,speed:0,stance:'neutral',bindings}],vehicles:[]},
 });
 return {scene,rig:new ActingRig(scene.animation,'anna'),face:new ConversationFaceRig(scene,{id:'anna',speakerId:'anna',turns:[]})};
}

export async function runActingDemo(output=resolve(fileURLToPath(new URL('../../artifacts/acting/',import.meta.url)))){
 await mkdir(output,{recursive:true});
 const {scene,rig,face}=createActingDemo();
 let mind=createNpcMind('anna',NPC_NEEDS.map(id=>({id,urgency:id==='company'?.9:0,growthPerS:0,importance:1})));
 const affordance={id:'conversation',need:'company',subject:'tea-break',partnerId:'ilya',available:true,distanceM:1,expectedRelief:1,confidence:1,position:[2,1.6,0]};
 const trace=[];
 for(let tick=0;tick<=180;tick++){
  const time=tick/60;
  if(tick===48||tick===96){
   const success=tick===96;
   // Synthetic receipts stand in for an authority result in this example only.
   mind=perceiveNpcOutcome(mind,{sequence:success?2:1,id:`demo:${tick}`,goalId:'company',subject:'tea-break',otherId:'ilya',
    atS:time,progress:success?1:0,expectedProgress:1,certainty:1,attribution:success?'help':'unable',confirmedResolution:success});
  }
  const result=stepNpcMind(mind,time,[affordance]);mind=result.mind;
  if(result.cue)rig.submit(result.cue);
  if(result.cue||result.request)trace.push({timeS:time,action:result.cue?.action??null,request:result.request,
   affect:mind.acting.affect,company:mind.needs.find(n=>n.id==='company').urgency});
  if(tick>0)scene.step(1/60);else scene.animation.step(0,scene.entities);
  rig.stepFace(face,scene.animation.timeSeconds,tick?1/60:0);
 }
 rig.dispose();
 const actions=['greet','think','celebrate','comfort','startle','tired'];
 const width=320,height=400,pixels=new Uint8Array(width*actions.length*height*4),frames=[];
 const renderer=new CpuRenderer({width,height});
 for(let index=0;index<actions.length;index++){
  const demo=createActingDemo();demo.rig.submit(makeActingCue(mind.acting,1,actions[index],3));
  // Advance the original Scene clock and native face springs together.
  for(let tick=1;tick<=228;tick++){
   demo.scene.step(1/60);demo.rig.stepFace(demo.face,demo.scene.animation.timeSeconds,1/60);
  }
  renderer.render(demo.scene);const stats=renderer.inspect();
  if(stats.errors.length||stats.drawCalls===0)throw new Error('Acting demo render failed');
  const frame=renderer.framebuffer();
  for(let y=0;y<height;y++)pixels.set(frame.subarray(y*width*4,(y+1)*width*4),(y*width*actions.length+index*width)*4);
  frames.push({action:actions[index],timeS:3.8,renderer:stats});demo.rig.dispose();
 }
 renderer.dispose();
 await writeFile(resolve(output,'gestures.png'),encodePng(pixels,width*actions.length,height));
 const report={backend:'cpu',syntheticReceipts:true,actionsLeftToRight:actions,trace,finalMind:mind,frames};
 await writeFile(resolve(output,'report.json'),JSON.stringify(report,null,2)+'\n');
 return {output,actions,trace};
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 console.log(JSON.stringify(await runActingDemo(process.argv[2]?resolve(process.argv[2]):undefined),null,2));
}
