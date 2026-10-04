import test from 'node:test';
import assert from 'node:assert/strict';
import {Scene} from '../dist/scene/scene.js';
import {compose} from '../dist/math.js';
import {conversationFaceEntities,conversationHeadMesh,ConversationFaceRig,sampleConversationArticulation} from '../dist/animation/conversation-face.js';

const turn={id:'tea',speakerId:'mike',text:'A ma oo',startS:1,
  segments:[{phone:'',durationS:.12},{phone:'a',durationS:.20},{phone:'m',durationS:.10},{phone:'u:',durationS:.20},{phone:'',durationS:.20}],
  pitch:[{timeS:0,hz:118},{timeS:.30,hz:143},{timeS:.82,hz:110}],pressure:[{timeS:0,pa:800}]};
const frame={position:[0,0,0],rotation:[0,0,0]};
const create=(id='mike',turns=[turn])=>{
  const scene=new Scene({version:1,gravity:[0,0,0],ground:-100,entities:conversationFaceEntities({id})});
  return{scene,rig:new ConversationFaceRig(scene,{id,speakerId:'mike',turns})};
};

test('socket head keeps the original silhouette and outward winding for GPU backface culling',()=>{
  const mesh=conversationHeadMesh();let checked=0;
  for(let i=0;i<mesh.indices.length;i+=3){
    const [a,b,c]=mesh.indices.slice(i,i+3).map(v=>mesh.positions.slice(v*3,v*3+3)),u=b.map((v,k)=>v-a[k]),v=c.map((x,k)=>x-a[k]);
    const normal=[u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0]];
    const outward=normal.reduce((sum,n,k)=>sum+n*(a[k]+b[k]+c[k]),0);
    assert.ok(outward>=-1e-12);if(outward>1e-12)checked++;
  }
  assert.ok(checked>40000);
  for(let i=0;i<mesh.positions.length;i+=3)assert.ok(Math.abs(Math.hypot(...mesh.positions.slice(i,i+3))-.5)<1e-9);
});

test('face follows the speaker motor score, including existing lead silence and distinct consonant/vowel targets',()=>{
  const at=t=>sampleConversationArticulation([turn],'mike',t);
  assert.equal(at(1.04).activity,0);
  assert.equal(sampleConversationArticulation([turn],'anna',1.20).activity,0);
  assert.ok(at(1.20).jaw>.8);
  assert.equal(at(1.35).closure,1);
  assert.ok(at(1.48).round>.85);
  assert.equal(at(1.90).activity,0);
  // Coarticulation arrives at the next target continuously at the actual
  // boundary; adding a second .12 s lead would fail the timing above.
  const before=at(1.32-1e-7),after=at(1.32+1e-7);
  for(const key of ['jaw','round','spread','closure'])assert.ok(Math.abs(before[key]-after[key])<1e-5,key);
});

test('bilabial seal survives inertial motion and cannot turn into a loudness-driven open jaw',()=>{
  const {rig}=create();let open,closed,rounded;
  for(let i=0;i<=108;i++){
    const t=i/60,pose=rig.step(t,i?1/60:0,frame);
    if(i===76)open=pose;if(i===82)closed=pose;if(i===91)rounded=pose;
    assert.ok(pose.toothClearanceM>=.0035);
    assert.ok(pose.lipGapM<.017);
  }
  assert.ok(open.lipGapM>.011);
  assert.ok(closed.lipGapM<.0018,JSON.stringify(closed));
  assert.ok(rounded.lipWidthM<open.lipWidthM-.008);
  assert.ok(rounded.lipProtrusionM>.003);
});

test('head frame rotates and scales all facial features without moving another actor',()=>{
  const scene=new Scene({version:1,gravity:[0,0,0],ground:-100,entities:[...conversationFaceEntities({id:'mike'}),...conversationFaceEntities({id:'anna',skin:[.62,.43,.33,1]})]});
  const rig=new ConversationFaceRig(scene,{id:'mike',speakerId:'mike',turns:[turn]}),anna=scene.entities.get('anna-face-mouth').position.slice();
  const pose=rig.step(0,0,{position:[3,1.7,-2],rotation:[.16,.9,-.07],scale:1.2,smile:.7,gazeTarget:[6,2.1,-3]});
  const matrix=compose([3,1.7,-2],[.16,.9,-.07],[1.2,1.2,1.2]),local=[.040,-.043,0];
  const expected=[0,1,2].map(i=>matrix[i]*local[0]+matrix[i+4]*local[1]+matrix[i+8]*local[2]+matrix[i+12]);
  assert.deepEqual(scene.entities.get('mike-face-mouth').position,expected);
  assert.deepEqual(scene.entities.get('anna-face-mouth').position,anna);
  assert.ok(Math.abs(pose.gazeOffset[1])<=.0033&&Math.abs(pose.gazeOffset[2])<=.0053);
  // Independently verify composed lip rotation, including nonzero head yaw,
  // so an apparent smile cannot drift off the face when the head turns.
  const lip=scene.entities.get('mike-face-left-upper-lip'),r=compose([0,0,0],lip.rotation,[1,1,1]),head=compose([0,0,0],[.16,.9,-.07],[1,1,1]);
  for(let i=0;i<3;i++)assert.ok(Math.abs(r[i]-head[i])<1e-6,'lip forward axis follows the head');
});

test('blink lids cover the iris and smiles have independent lifted corners',()=>{
  const {scene,rig}=create();
  rig.step(0,0,{...frame,smile:1,blink:1});
  for(const name of ['left','right']){
    const lid=scene.entities.get('mike-face-'+name+'-upper-lid'),iris=scene.entities.get('mike-face-'+name+'-iris');
    const points=Array.from({length:lid.mesh.positions.length/3},(_,i)=>lid.mesh.positions.slice(i*3,i*3+3)).filter(p=>Math.abs(p[2])<.0001);
    assert.ok(Math.min(...points.map(p=>p[1]*lid.scale[1]+lid.position[1]))<iris.position[1]-iris.scale[1]/2);
    const covering=points.filter(p=>Math.abs(p[1]*lid.scale[1]+lid.position[1]-iris.position[1])<.0025);
    assert.ok(covering.some(p=>p[0]+lid.position[0]>iris.position[0]+iris.scale[0]/2));
  }
  const left=scene.entities.get('mike-face-left-lip-corner'),right=scene.entities.get('mike-face-right-lip-corner');
  assert.ok(left.position[1]>-.043&&right.position[1]>left.position[1]);
});

test('inertial face is stable across simulation rates and rejects invalid clocks before mutation',()=>{
  const sample=hz=>{const {rig}=create();let pose;for(let i=0;i<=Math.round(1.6*hz);i++)pose=rig.step(i/hz,i?1/hz:0,frame);return pose;};
  const a=sample(60),b=sample(120);
  assert.ok(Math.abs(a.lipGapM-b.lipGapM)<.0007);
  assert.ok(Math.abs(a.jawAngleRad-b.jawAngleRad)<.004);
  const {scene,rig}=create();rig.step(0,0,frame);const before=scene.entities.get('mike-face-mouth').position.slice();
  assert.throws(()=>rig.step(NaN,1/60,frame),/time/);
  assert.throws(()=>rig.step(.1,0,frame),/dt/);
  assert.throws(()=>rig.step(.1,1/60,{...frame,gazeTarget:[Infinity,0,0]}),/gaze/);
  assert.deepEqual(scene.entities.get('mike-face-mouth').position,before);
});
