import test from 'node:test';
import assert from 'node:assert/strict';
import {AnimationSystem,bindHumanoid,humanoidMeasurements,sampleWalker} from '../dist/animation/locomotion.js';
import {Scene} from '../dist/scene/scene.js';

const distance=(a,b)=>Math.hypot(...a.map((v,i)=>v-b[i]));
const near=(actual,expected,tolerance=1e-9)=>assert.ok(Math.abs(actual-expected)<tolerance,`${actual} != ${expected}`);
const pointNear=(actual,expected)=>actual.forEach((value,i)=>near(value,expected[i]));
const factors=['shoulders','hips','torso','arms','legs'];
const extremes=Array.from({length:32},(_,mask)=>Object.fromEntries(factors.map((name,bit)=>[name,mask&(1<<bit)?1.3:.7])));

test('body measurements separate limb length, body width and torso height in metres',()=>{
 const base=humanoidMeasurements();
 near(base.upperArm,.295);near(base.forearm,.27);near(base.thigh,.425);near(base.shin,.42);
 near(base.pelvisRestHeight,.88);near(base.headHeight,1.57);near(base.neckHeight,1.435);
 near(base.hipHalfWidth,.125);near(base.shoulderHalfWidth,.22);near(base.footSpacing,.26);
 for(const proportions of extremes){
  const m=humanoidMeasurements(proportions),scaled=humanoidMeasurements(proportions,1.75);
  for(const key of Object.keys(m))near(scaled[key],m[key]*1.75);
  // A longer leg raises every upper-body joint by the added segment lengths.
  near(m.pelvisRestHeight-base.pelvisRestHeight,(m.thigh+m.shin)-(base.thigh+base.shin));
  near(m.neckOffset,base.neckOffset*proportions.torso);
  near(m.shoulderOffset,base.shoulderOffset*proportions.torso);
  near(m.headOffset-m.neckOffset,.135);
  near(m.shoulderOffset-m.handRestOffset,.519*proportions.arms);
  near(m.handHalfSpacing-m.shoulderHalfWidth,.067);
  near(m.footHalfSpacing-m.hipHalfWidth,.005*proportions.hips);
  near(m.stepReachLimit,base.stepReachLimit*proportions.legs);
 }
});

test('default proportions retain the original walker pose snapshot and explicit defaults are identical',()=>{
 const walker={id:'legacy',root:[10,.2,-3],heightScale:.82,heading:.73,speed:.86,period:1.3};
 const terrain=p=>({height:.23+(p[0]-10)*.025,snowDepth:.05});
 const pose=sampleWalker(walker,1.7,terrain);
 // Recorded from the original rig before introducing body proportions.
 const snapshot={
  pelvis:[11.0894449762282,.9617395065218965,-3.9749634063754065],
  neck:[11.102887922446502,1.4168395065218966,-3.986993734590873],
  head:[11.105332094486194,1.5275395065218964,-3.989181066993685],
  leftKnee:[11.157286329905988,.666082496830153,-4.175802493757405],
  rightKnee:[11.136993924591266,.6145334150131005,-3.8769653493967073],
  leftAnkle:[11.211857600542505,.32999644001356276,-4.227566369526049],
  rightAnkle:[10.999629260970071,.32469073152425176,-3.7515319885383644],
  leftShoulder:[10.975252124172762,1.3315595065218966,-4.114861199565452],
  rightShoulder:[11.215858688482097,1.3315595065218966,-3.8460022751994223],
  leftHand:[10.897794691589999,.9059795065218965,-4.119270892376783],
  rightHand:[11.246876852310727,.9059795065218965,-3.8000332667346597],
 };
 for(const [joint,expected] of Object.entries(snapshot))pointNear(pose.joints[joint],expected);
 const defaults=Object.fromEntries(factors.map(name=>[name,1]));
 for(const heightScale of [.25,.82,1,3])for(const speed of [0,.86,12])for(const time of [0,.1,.49,1.7,4.3]){
  const spec={...walker,heightScale,speed};
  assert.deepEqual(sampleWalker({...spec,proportions:{}},time,terrain),sampleWalker(spec,time,terrain));
  assert.deepEqual(sampleWalker({...spec,proportions:defaults},time,terrain),sampleWalker(spec,time,terrain));
 }
});

test('all body extremes keep measured limb lengths and world foot contacts across headings and gait phases',()=>{
 for(let profile=0;profile<extremes.length;profile++)for(const heading of [0,.73,-Math.PI/2])for(const speed of [.86,12]){
  const proportions=extremes[profile],heightScale=[.25,1,1.8][profile%3],m=humanoidMeasurements(proportions,heightScale);
  const walker={id:'body',root:[2,.2,-3],heading,speed,heightScale,proportions};
  const terrain=p=>({height:.2+(p[0]-2)*.015,snowDepth:.025}),period=Math.min(1.3,m.stepReachLimit/speed);let previous;
  for(let tick=0;tick<90;tick++){
   // Resolve swing even at maximum speed and minimum height: two samples
   // marked grounded can otherwise belong to different stance cycles.
   const pose=sampleWalker(walker,tick*period/30,terrain,previous),j=pose.joints;
   assert.ok(Object.values(j).flat().every(Number.isFinite));
   for(const side of ['left','right']){
    near(distance(j[side+'Hip'],j[side+'Knee']),m.thigh);
    near(distance(j[side+'Knee'],j[side+'Ankle']),m.shin);
    near(distance(j[side+'Shoulder'],j[side+'Elbow']),m.upperArm);
    near(distance(j[side+'Elbow'],j[side+'Hand']),m.forearm);
    const foot=pose.feet.find(contact=>contact.id===walker.id+':'+side),ankle=j[side+'Ankle'];
    // Actual IK endpoint reaches the authored sole; a footprint must never
    // remain planted while the rendered ankle is clamped somewhere else.
    near(ankle[0],foot.position[0]);near(ankle[2],foot.position[2]);
    near(ankle[1],foot.position[1]+m.ankleHeight);
    if(foot.grounded){
     near(foot.position[1],terrain(foot.position).height-Math.min(.020*heightScale,.025*.4));
     const old=previous?.feet.find(contact=>contact.id===foot.id);
     if(old?.grounded)assert.deepEqual(foot.position,old.position);
    }
   }
   near(distance(j.leftShoulder,j.rightShoulder),2*m.shoulderHalfWidth);
   near(distance(j.leftHip,j.rightHip),2*m.hipHalfWidth);
   near(j.neck[1]-j.pelvis[1],m.neckOffset);near(j.head[1]-j.pelvis[1],m.headOffset);
   near(distance(j.head,j.neck),Math.hypot(.004,.135)*heightScale);
   previous=pose;
  }
 }
});

test('rest pose and bound head and bones use the same body measurements without stretching the face',()=>{
 for(const proportions of extremes){
  const heightScale=.9,m=humanoidMeasurements(proportions,heightScale);
  const pose=sampleWalker({id:'standing',root:[3,.4,-2],speed:0,heightScale,proportions,heading:.9},0);
  for(const joint of ['chest','neck','head'])near(pose.joints[joint][1],.4+m[joint+'Height']);
  near(pose.joints.pelvis[1],.4+m.pelvisRestHeight);
  near(pose.joints.leftShoulder[1],.4+m.shoulderHeight);
  near(distance(pose.joints.leftFoot,pose.joints.rightFoot),m.footSpacing);
  const transforms=bindHumanoid(pose,[
   {entity:'face',joint:'head',offset:[.04,.03,0],scale:[.2,.2,.2]},
   {entity:'thigh',joint:'leftHip',boneTo:'leftKnee',scale:[.1,1,.1]},
   {entity:'sleeve',joint:'rightShoulder',boneTo:'rightElbow',scale:[.08,1,.08]},
  ]);
  assert.deepEqual(transforms[0].scale,[.2*heightScale,.2*heightScale,.2*heightScale]);
  near(distance(transforms[0].position,pose.joints.head),.05*heightScale);
  near(transforms[1].scale[1],m.thigh);near(transforms[2].scale[1],m.upperArm);
 }
});

test('invalid body factors are rejected before a rig is registered or sampled',()=>{
 for(const factor of factors)for(const value of [NaN,Infinity,-Infinity,-1,0,.699999,1.300001,10,null,'1']){
  const proportions={[factor]:value},spec={id:'invalid',root:[0,0,0],speed:0,proportions},animation=new AnimationSystem();
  assert.throws(()=>humanoidMeasurements(proportions),/proportion/);
  assert.throws(()=>sampleWalker(spec,0),/proportion/);
  assert.throws(()=>animation.addWalker(spec),/proportion/);
  assert.doesNotThrow(()=>animation.addWalker({...spec,proportions:undefined}));
 }
 for(const proportions of [null,[],1,'body'])assert.throws(()=>humanoidMeasurements(proportions),/object/);
 for(const scale of [NaN,Infinity,0,.24999,3.00001])assert.throws(()=>humanoidMeasurements({},scale),/height scale/);
});

test('neutral stance uses nearly extended measured legs and relaxed elbows without moving grounded soles',()=>{
 const flexion=(a,joint,b)=>{
  const u=a.map((value,i)=>value-joint[i]),v=b.map((value,i)=>value-joint[i]);
  const cosine=u.reduce((sum,value,i)=>sum+value*v[i],0)/(Math.hypot(...u)*Math.hypot(...v));
  return Math.PI-Math.acos(Math.max(-1,Math.min(1,cosine)));
 };
 for(const proportions of extremes)for(const heading of [0,.73,-Math.PI/2]){
  const walker={id:'neutral',root:[3,.4,-2],speed:0,heightScale:.9,heading,proportions,stance:'neutral'};
  const pose=sampleWalker(walker,0),m=humanoidMeasurements(proportions,.9),j=pose.joints;
  for(const side of ['left','right']){
   near(flexion(j[side+'Hip'],j[side+'Knee'],j[side+'Ankle']),8*Math.PI/180);
   near(flexion(j[side+'Shoulder'],j[side+'Elbow'],j[side+'Hand']),12*Math.PI/180);
   near(distance(j[side+'Hip'],j[side+'Knee']),m.thigh);near(distance(j[side+'Knee'],j[side+'Ankle']),m.shin);
   near(distance(j[side+'Shoulder'],j[side+'Elbow']),m.upperArm);near(distance(j[side+'Elbow'],j[side+'Hand']),m.forearm);
   const foot=pose.feet.find(value=>value.id===walker.id+':'+side);
   assert.ok(foot.grounded);near(foot.position[1],walker.root[1]);
   pointNear(j[side+'Ankle'],[foot.position[0],foot.position[1]+m.ankleHeight,foot.position[2]]);
  }
  near(j.neck[1]-j.pelvis[1],m.neckOffset);near(j.head[1]-j.pelvis[1],m.headOffset);
  for(const time of [.2,1.7,60])assert.deepEqual(sampleWalker(walker,time),pose,'a standing pose has no gait bob or route drift');
 }
});

test('neutral stance is explicitly validated and leaves every moving gait bit-identical',()=>{
 for(const stance of [null,'legacy','crouch',false,1]){
  const walker={id:'stance',root:[0,0,0],speed:0,stance};
  assert.throws(()=>sampleWalker(walker,0),/stance/);
  assert.throws(()=>new AnimationSystem().addWalker(walker),/stance/);
  assert.throws(()=>new Scene({version:1,entities:[],animation:{walkers:[walker]}}),/stance/);
 }
 for(const proportions of [undefined,...extremes])for(const heading of [0,.73,-Math.PI/2])for(const speed of [.01,.86,12])for(const time of [0,.17,.51,1.29,4.2]){
  const walker={id:'legacy-moving',root:[3,.2,-2],heightScale:.82,heading,speed,proportions};
  assert.deepEqual(sampleWalker({...walker,stance:'neutral'},time),sampleWalker(walker,time));
 }
});

test('neutral stance survives scene JSON export and remains the sole static animation pose',()=>{
 const walker={id:'exported',root:[3,.25,-2],heading:.73,speed:0,heightScale:1.1,proportions:{shoulders:.7,hips:1.3,arms:1.3,legs:.7,torso:1.3},stance:'neutral',bindings:[
  {entity:'head',joint:'head'},
  {entity:'thigh',joint:'leftHip',boneTo:'leftKnee'},
  {entity:'hand',joint:'rightHand',orientFrom:'rightElbow'},
 ]};
 const scene=new Scene(JSON.parse(JSON.stringify({version:1,ground:.25,entities:walker.bindings.map(binding=>({id:binding.entity,renderOnly:true})),animation:{walkers:[walker]}})));
 const expected=sampleWalker(walker,0),transforms=bindHumanoid(expected,walker.bindings);
 for(let tick=0;tick<12;tick++){
  scene.step(1/60);assert.deepEqual(scene.animation.pose(walker.id),expected);
  for(const transform of transforms){const entity=scene.entities.get(transform.entity);assert.deepEqual(entity.position,transform.position);assert.deepEqual(entity.rotation,transform.rotation);assert.deepEqual(entity.scale,transform.scale);}
 }
});
