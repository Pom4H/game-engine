import test from 'node:test';
import assert from 'node:assert/strict';
import {sampleCharacterPose} from '../dist/characters/pose.js';
import {compileCharacter} from '../dist/characters/character.js';
import {AnimationSystem,bindHumanoid,humanoidMeasurements} from '../dist/animation/locomotion.js';
import {compose,V3} from '../dist/math.js';

const near=(actual,expected,tolerance=1e-9)=>assert.ok(Math.abs(actual-expected)<=tolerance,`${actual} != ${expected}`);
const pointNear=(actual,expected,tolerance=1e-9)=>actual.forEach((value,i)=>near(value,expected[i],tolerance));
const distance=(a,b)=>V3.length(V3.sub(a,b));
const factors=['shoulders','hips','torso','arms','legs'];
const extremes=Array.from({length:32},(_,mask)=>Object.fromEntries(factors.map((name,bit)=>[name,mask&(1<<bit)?1.3:.7])));
const modes=['idle','walk','reach','t-pose'];
const rotate=(p,heading)=>[Math.cos(heading)*p[0]+Math.sin(heading)*p[2],p[1],-Math.sin(heading)*p[0]+Math.cos(heading)*p[2]];
const transformed=(transform,p)=>{
 const m=compose(transform.position,transform.rotation,transform.scale);
 return[0,1,2].map(axis=>m[axis]*p[0]+m[axis+4]*p[1]+m[axis+8]*p[2]+m[axis+12]);
};

test('all four constructor poses keep measured limbs, head size and stationary centre at every body extreme',()=>{
 for(let profile=0;profile<extremes.length;profile++)for(const heading of [0,.73,Math.PI,-Math.PI/2]){
  const walker={id:'preview',root:[4.2,.37,-2.7],heading,speed:9,heightScale:profile%2?.8:1.3,proportions:extremes[profile]};
  const m=humanoidMeasurements(walker.proportions,walker.heightScale),untouched=structuredClone(walker);
  for(const mode of modes)for(const time of [0,.19,.51,1.7,5.2,60]){
   const pose=sampleCharacterPose(walker,mode,time),j=pose.joints;
   pointNear(pose.position,walker.root);assert.ok(Object.values(j).flat().every(Number.isFinite));
   for(const side of ['left','right']){
    near(distance(j[side+'Hip'],j[side+'Knee']),m.thigh);near(distance(j[side+'Knee'],j[side+'Ankle']),m.shin);
    near(distance(j[side+'Shoulder'],j[side+'Elbow']),m.upperArm);near(distance(j[side+'Elbow'],j[side+'Hand']),m.forearm);
    const foot=pose.feet.find(f=>f.id===walker.id+':'+side);
    pointNear(j[side+'Ankle'],[foot.position[0],foot.position[1]+m.ankleHeight,foot.position[2]]);
   }
   near(distance(j.head,j.neck),Math.hypot(.004,.135)*walker.heightScale);
   near(j.head[1]-j.pelvis[1],m.headOffset);
  }
  assert.deepEqual(walker,untouched,'sampling cannot mutate the authored recipe');
 }
});

test('walking preview repeats a complete gait period without accumulating route translation',()=>{
 for(const proportions of extremes)for(const heading of [.73,-Math.PI/2]){
  const walker={id:'loop',root:[-3.2,.8,1.4],heightScale:.91,heading,speed:0,proportions};
  const period=Math.min(1.3,humanoidMeasurements(proportions,.91).stepReachLimit/(.62*.91));
  for(const time of [0,.17,.59,1.07]){
   const a=sampleCharacterPose(walker,'walk',time),b=sampleCharacterPose(walker,'walk',time+period);
   for(const joint of Object.keys(a.joints))pointNear(b.joints[joint],a.joints[joint]);
   for(let i=0;i<a.feet.length;i++){pointNear(b.feet[i].position,a.feet[i].position);assert.equal(b.feet[i].grounded,a.feet[i].grounded);}
   near(a.footPitch.left,b.footPitch.left);near(a.footPitch.right,b.footPitch.right);
   assert.deepEqual(a,sampleCharacterPose({...walker,speed:12},'walk',time),'preview mode owns its playback speed');
  }
 }
});

test('reach moves only the right arm and T-pose spans the measured arms from their shoulder sockets',()=>{
 for(const proportions of extremes)for(const heading of [0,.73,-Math.PI/2]){
  const walker={id:'poses',root:[3,.4,-2],heightScale:1.07,heading,speed:0,proportions},m=humanoidMeasurements(proportions,1.07);
  const idle=sampleCharacterPose(walker,'idle',.51),reach=sampleCharacterPose(walker,'reach',.51),spread=sampleCharacterPose(walker,'t-pose',.51);
  for(const joint of Object.keys(idle.joints))if(!['rightElbow','rightHand'].includes(joint))assert.deepEqual(reach.joints[joint],idle.joints[joint]);
  assert.ok(distance(reach.joints.rightHand,idle.joints.rightHand)>.2);
  for(const side of ['left','right']){
   const sign=side==='left'?-1:1,expected=V3.add(spread.joints[side+'Shoulder'],rotate([0,0,sign*(m.upperArm+m.forearm)],heading));
   // The analytic solver retains its existing 0.1 µm extension margin.
   pointNear(spread.joints[side+'Hand'],expected,1.01e-7);
  }
 }
});

test('compiled sleeve endpoints meet wrist anchors in every preview mode and extreme body composition',()=>{
 for(const profile of [0,10,21,31]){
  const compiled=compileCharacter({body:{...extremes[profile],height:profile%2?2.05:1.5}});
  for(const mode of modes)for(const heading of [0,.73,Math.PI/2,-1.8]){
   const walker={...compiled.walker,root:[4,.35,-3],heading},pose=sampleCharacterPose(walker,mode,.51);
   const transforms=new Map(bindHumanoid(pose,walker.bindings).map(transform=>[transform.entity,transform]));
   for(const side of ['left','right']){
    const sleeve=transforms.get(`${walker.id}:${side}-lower-sleeve`),hand=transforms.get(`${walker.id}:${side}-hand`);
    pointNear(transformed(sleeve,[0,-.5,0]),pose.joints[side+'Elbow'],8e-7);
    pointNear(transformed(sleeve,[0,.5,0]),pose.joints[side+'Hand'],8e-7);
    pointNear(hand.position,pose.joints[side+'Hand']);
    const towardElbow=V3.normalize(V3.sub(pose.joints[side+'Elbow'],pose.joints[side+'Hand']));
    const wristAxis=V3.normalize(V3.sub(transformed(hand,[0,1,0]),transformed(hand,[0,0,0])));
    pointNear(wristAxis,towardElbow,8e-7);
    const tip=transformed(hand,[0,-.15,0]);
    near(V3.dot(V3.sub(tip,hand.position),V3.scale(towardElbow,-1)),.15*walker.heightScale,8e-7);
    assert.deepEqual(hand.scale,[walker.heightScale,walker.heightScale,walker.heightScale]);
   }
  }
 }
});

test('oriented attachments and their local offsets follow actor heading through the renderer transform',()=>{
 const input={id:'frame',root:[0,0,0],heightScale:.87,speed:0,proportions:{arms:.7,shoulders:1.3,torso:.7,legs:1.3}};
 const root=[3.1,.43,-2.4],bindings=[
  {entity:'hand',joint:'rightHand',orientFrom:'rightElbow',scale:[.8,1,.9]},
  {entity:'offset',joint:'rightHand',orientFrom:'rightElbow',offset:[.02,.03,-.01],rotation:[.21,-.33,.47],scale:[.4,.5,.6]},
 ];
 for(const mode of modes)for(const heading of [0,.73,Math.PI/2,Math.PI,-Math.PI/2,-2.4]){
  const a=sampleCharacterPose(input,mode,.51),b=sampleCharacterPose({...input,root,heading},mode,.51);
  for(const joint of Object.keys(a.joints))pointNear(b.joints[joint],V3.add(root,rotate(a.joints[joint],heading)));
  const first=bindHumanoid(a,bindings),turned=bindHumanoid(b,bindings);
  for(let i=0;i<bindings.length;i++)for(const point of [[0,0,0],[0,.026,0],[.013,-.15,.02],[.08,.12,-.05]]){
   pointNear(transformed(turned[i],point),V3.add(root,rotate(transformed(first[i],point),heading)),8e-7);
  }
  // An offset along local +Y lies on the wrist-to-elbow direction and scales
  // with body height, independently of the attachment's own mesh scale.
  const shifted=bindHumanoid(b,[{...bindings[0],offset:[0,.03,0]}])[0];
  const expected=V3.add(b.joints.rightHand,V3.scale(V3.normalize(V3.sub(b.joints.rightElbow,b.joints.rightHand)),.03*input.heightScale));
  pointNear(shifted.position,expected);
 }
});

test('invalid preview inputs and ambiguous or degenerate attachment frames fail before publication',()=>{
 const walker={id:'checked',root:[0,0,0],speed:0},pose=sampleCharacterPose(walker);
 for(const mode of ['running','',null])assert.throws(()=>sampleCharacterPose(walker,mode),/pose/);
 for(const time of [-1,NaN,Infinity])assert.throws(()=>sampleCharacterPose(walker,'walk',time),/time/);
 const conflict={entity:'hand',joint:'rightHand',orientFrom:'rightElbow',boneTo:'rightElbow'};
 assert.throws(()=>bindHumanoid(pose,[conflict]),/combine/);
 assert.throws(()=>new AnimationSystem().addWalker({...walker,bindings:[conflict]}),/combine/);
 assert.throws(()=>bindHumanoid(pose,[{entity:'hand',joint:'rightHand',orientFrom:'rightHand'}]),/distinct finite/);
 assert.throws(()=>bindHumanoid(pose,[{entity:'hand',joint:'rightHand',orientFrom:'unknown'}]),/Unknown humanoid joint/);
 assert.throws(()=>bindHumanoid(pose,[{entity:'hand',joint:'rightHand',orientFrom:'rightElbow',offset:[NaN,0,0]}]),/finite/);
 assert.throws(()=>bindHumanoid(pose,[{entity:'hand',joint:'rightHand',orientFrom:'rightElbow',rotation:[0,Infinity,0]}]),/finite/);
});
