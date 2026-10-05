import test from 'node:test';
import assert from 'node:assert/strict';
import {Scene} from '../dist/scene/scene.js';
import {compose} from '../dist/math.js';
import {NativeSpeechMotor,createVocalMotorFrame} from '../dist/audio/native-speech.js';
import {ExpressiveFaceRig,expressiveHeadMesh,expressiveFaceEntities,WINTER_FACE_IDENTITIES,blendFaceActions} from '../dist/animation/expressive-face.js';
import {createTeaPerformancePlan,TEA_PERFORMANCE_DURATION,pronounce} from '../tools/tea-performance/plan.mjs';
import {createTeaPerformance} from '../tools/tea-performance/scene.mjs';
const distance=(a,b)=>Math.hypot(...a.map((v,i)=>v-b[i]));

test('new script contains thirteen authored turns without overlapping one speaker or silently inventing unknown words',()=>{
 const p=createTeaPerformancePlan();assert.equal(p.turns.length,13);assert.equal(TEA_PERFORMANCE_DURATION,42);
 assert.equal(p.turns.reduce((n,t)=>n+t.text.match(/[a-z]+/gi).length,0),51);
 assert.throws(()=>pronounce('Unknown'),/Missing authored/);
 assert.notEqual(p.speakers[0].tractLengthM,p.speakers[1].tractLengthM);
 for(const s of p.speakers){let end=0;for(const t of p.turns.filter(t=>t.speakerId===s.id)){assert.ok(t.startS>=end);end=t.startS+t.segments.reduce((n,p)=>n+p.durationS,0);}assert.ok(end<42);}
});
test('facial identity changes actual geometry and layer mixing is bounded and asymmetric',()=>{
 const a=expressiveHeadMesh(WINTER_FACE_IDENTITIES.mike),b=expressiveHeadMesh(WINTER_FACE_IDENTITIES.anna);
 assert.notDeepEqual(a.positions,b.positions);assert.deepEqual(a.indices,b.indices);
 for(const mesh of [a,b]){
  assert.ok(mesh.positions.every(Number.isFinite));assert.equal(mesh.normals.length,mesh.positions.length);
  assert.ok(mesh.colors.every(v=>Number.isFinite(v)&&v>=0&&v<=1));
  for(let i=0;i<mesh.normals.length;i+=3)assert.ok(Math.abs(Math.hypot(...mesh.normals.slice(i,i+3))-1)<1e-5);
 }
 const expression=blendFaceActions([{weight:.7,actions:{smileLeft:.8}},{weight:.6,actions:{smileLeft:.9,browRight:.5}}]);
 assert.equal(expression.smileLeft,1);assert.equal(expression.smileRight,0);assert.equal(expression.browRight,.3);
 assert.throws(()=>blendFaceActions([{weight:NaN,actions:{}}]));
});
test('native face reads the supplied motor state rather than a second phoneme map and keeps acoustic aperture dimensions',()=>{
 const p=createTeaPerformancePlan(),identity=WINTER_FACE_IDENTITIES.anna,scene=new Scene({version:1,entities:expressiveFaceEntities('anna',identity)});
 const motor=new NativeSpeechMotor(p,'anna'),state=createVocalMotorFrame(.155),rig=new ExpressiveFaceRig(scene,'anna',identity),frame={position:[3,1.7,-2],rotation:[.05,2.9,-.03],scale:.97,gazeTarget:[2,1.8,-2]};
 for(let i=0;i<480;i++){
  const time=i/60;motor.sample(time,state);const seen=rig.step(time,i?1/60:0,frame,state,[{weight:1,actions:{smileRight:.6,browLeft:.7}}]);
  const mouth=scene.entities.get('anna-face-mouth'),visibleArea=Math.PI/4*mouth.scale[1]*mouth.scale[2];
  assert.ok(Math.abs(visibleArea-state.oralAreaCm2[43]*1e-4)<1e-10);
  assert.equal(seen.motorTimeS,state.timeS);assert.equal(seen.source,'shared-vocal-motor');
 }
 const wrong={...state,timeS:state.timeS+.2};assert.throws(()=>rig.step(state.timeS,0,frame,wrong,[]),/clocks/);
});
test('42-second performance stays finite, shares one clock and transfers the cup through visible hand contact',()=>{
 const play=createTeaPerformance();play.step(0,0);const owners=[],shots=new Set(),moved=new Set(),before=new Map(),lengths=new Map();let previousCup,shared=0,pours=0,sips=0,departed=false;
 for(let tick=0;tick<=2520;tick++){
  if(tick)play.step(tick/60,1/60);
  const state=play.inspect();assert.ok(Math.abs(state.timeS-play.scene.time)<1e-8);shots.add(state.shot);
  const {cup,teapot}=state;if(cup.owner!==owners.at(-1))owners.push(cup.owner);
  if(previousCup)assert.ok(distance(previousCup,cup.position)<.06,'cup teleports at '+state.timeS);previousCup=cup.position;
  const movers=play.scene.renderMoverIds();
  for(const [id,e] of play.scene.entities){
   const values=[...e.position,...e.rotation,...e.scale];assert.ok(values.every(Number.isFinite),id+' finite');assert.ok(e.scale.every(v=>v>0),id+' positive scale');
   if(before.has(id)&&values.some((v,i)=>Math.abs(v-before.get(id)[i])>1e-9)){assert.ok(movers.has(id),id+' missing mover ownership');moved.add(id);}before.set(id,values);
  }
  for(const actor of state.actors){
   assert.equal(actor.motor.timeS,state.timeS);assert.equal(actor.face.motorTimeS,state.timeS);
   for(const side of ['left','right'])for(const [a,b] of [['Shoulder','Elbow'],['Elbow','Hand'],['Hip','Knee'],['Knee','Ankle']]){
    const key=actor.id+side+a,len=distance(actor.joints[side+a],actor.joints[side+b]);
    if(!lengths.has(key))lengths.set(key,len);assert.ok(Math.abs(len-lengths.get(key))<1e-7,key+' changes length');
   }
   for(const side of ['left','right']){
    const target=actor.grips[side]==='cup'?cup.gripPoints[actor.id]:actor.grips[side]==='teapot'?teapot.gripPoint:null;
    if(target)assert.ok(distance(actor.joints[side+'Hand'],target)<.004,actor.id+' '+side+' loses '+actor.grips[side]+' at '+state.timeS);
   }
   if(state.timeS>40&&actor.position[2]>6)departed=true;
  }
  if(cup.owner==='both')shared++;
  if(teapot.flow>.95){pours++;assert.ok(Math.hypot(teapot.spout[0]-cup.position[0],teapot.spout[2]-cup.position[2])<.035);}
  if(cup.sip>.999){sips++;const m=compose(cup.position,cup.rotation,[1,1,1]),rim=[0,1,2].map(i=>m[i]*.035+m[i+4]*.044+m[i+12]);const lip=state.actors.find(a=>a.id==='anna').face.lowerLipWorld;assert.ok(distance(rim,lip)<.002,'sip must touch the actual lower lip, not an estimated head anchor');}
 }
 assert.deepEqual(owners,['table','mike','both','anna']);assert.ok(shared>20&&pours>60&&sips>15);assert.ok(departed);
 assert.ok(shots.size>=10);for(const prefix of ['mike-face-','anna-face-','tea-cup-','tea-pot-'])assert.ok([...moved].some(id=>id.startsWith(prefix)));
});
