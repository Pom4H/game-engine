import test from 'node:test';
import assert from 'node:assert/strict';
import {Scene} from '../dist/scene/scene.js';
import {compose} from '../dist/math.js';
import {createTeaScene} from '../tools/tea-scene/scene.mjs';
import {createTeaSceneDialoguePlan} from '../tools/tea-scene/plan.mjs';

const DT=1/60;
const distance=(a,b)=>Math.hypot(...a.map((v,i)=>v-b[i]));
const near=(a,b,tolerance,message)=>assert.ok(distance(a,b)<=tolerance,`${message}: ${distance(a,b)} m`);
const transform=e=>[...e.position,...e.rotation,...e.scale];
const finiteVector=(v,label)=>assert.ok(v.length===3&&v.every(Number.isFinite),label);
const subtract=(a,b)=>a.map((v,i)=>v-b[i]);
const dot=(a,b)=>a.reduce((sum,v,i)=>sum+v*b[i],0);
const worldPoint=(matrix,p)=>[0,1,2].map(i=>matrix[i+12]+matrix[i]*p[0]+matrix[i+4]*p[1]+matrix[i+8]*p[2]);
function pointSegmentDistance(p,a,b){
  const d=subtract(b,a),length2=dot(d,d),u=length2?Math.max(0,Math.min(1,dot(subtract(p,a),d)/length2)):0;
  return distance(p,a.map((v,i)=>v+d[i]*u));
}
function pointTriangleDistance(p,a,b,c){
  const ab=subtract(b,a),ac=subtract(c,a),ap=subtract(p,a);
  const d00=dot(ab,ab),d01=dot(ab,ac),d11=dot(ac,ac),d20=dot(ap,ab),d21=dot(ap,ac),denominator=d00*d11-d01*d01;
  if(denominator>1e-18){
    const v=(d11*d20-d01*d21)/denominator,w=(d00*d21-d01*d20)/denominator;
    if(v>=0&&w>=0&&v+w<=1)return distance(p,a.map((x,i)=>x+v*ab[i]+w*ac[i]));
  }
  return Math.min(pointSegmentDistance(p,a,b),pointSegmentDistance(p,b,c),pointSegmentDistance(p,c,a));
}
function cupRimTriangles(mesh){
  assert.equal(mesh.kind,'triangle-mesh','sip contact must use the visible cup geometry');
  const vertices=Array.from({length:mesh.positions.length/3},(_,i)=>mesh.positions.slice(i*3,i*3+3));
  const top=Math.max(...vertices.map(p=>p[1])),triangles=[];
  for(let i=0;i<mesh.indices.length;i+=3){
    const triangle=mesh.indices.slice(i,i+3).map(index=>vertices[index]);
    if(triangle.every(p=>Math.abs(p[1]-top)<1e-8))triangles.push(triangle);
  }
  assert.ok(triangles.length>=16,'cup needs a resolved rim surface');
  return triangles;
}
let recorded;

// Capture once at simulation cadence. The checks below consume observations of
// visible geometry, independently of the authored interpolation/IK functions.
function recording(){
  if(recorded)return recorded;
  const plan=createTeaSceneDialoguePlan(),play=createTeaScene({plan}),frames=[];
  const previous=new Map(),previousGeometry=new Map(),moved=new Set();
  play.step(0,0);
  const rimTriangles=cupRimTriangles(play.scene.entities.get('tea-cup-body').mesh);
  const note=()=>{
    const state=structuredClone(play.inspect()),renderMovers=play.scene.renderMoverIds();
    assert.ok(Math.abs(state.timeS-play.scene.time)<1e-8,'performance and engine must share one time');
    for(const [id,e] of play.scene.entities){
      finiteVector(e.position,id+' position');finiteVector(e.rotation,id+' rotation');finiteVector(e.scale,id+' scale');
      assert.ok(e.scale.every(v=>v>0),id+' scale must stay positive');
      const values=transform(e),old=previous.get(id);
      const oldMesh=previousGeometry.get(id),geometry=e.renderMesh??e.mesh;
      if(old&&(values.some((v,i)=>Math.abs(v-old[i])>1e-10)||oldMesh!==geometry)){
        moved.add(id);assert.ok(renderMovers.has(id),id+' changes outside the renderer moving partition');
      }
      previous.set(id,values);previousGeometry.set(id,geometry);
    }
    const sleeves=Object.fromEntries(state.actors.flatMap(actor=>[-1,1].flatMap(side=>['upperArm','forearm'].map(part=>{
      const id=actor.id+'-'+part+side,e=play.scene.entities.get(id);
      assert.ok(e,id+' exists');return[id,{position:[...e.position],rotation:[...e.rotation],scale:[...e.scale]}];
    }))));
    const cup=play.scene.entities.get('tea-cup-body');
    const lips=['left','right'].flatMap(side=>['upper','lower'].map(part=>{
      const id=`anna-face-${side}-${part}-lip`,entity=play.scene.entities.get(id);
      assert.ok(entity,id+' inner segment exists');return entity.position;
    }));
    frames.push({state,sleeves,cupTransform:{position:[...cup.position],rotation:[...cup.rotation],scale:[...cup.scale]},innerLipPoint:[0,1,2].map(i=>lips.reduce((sum,p)=>sum+p[i],0)/lips.length)});
  };
  note();
  for(let tick=1;tick<=Math.round(play.duration/DT);tick++){
    play.step(tick*DT,DT);note();
    assert.equal(play.scene.tick,tick,'one engine tick per authored simulation step');
  }
  recorded={plan,play,frames,moved,rimTriangles};
  return recorded;
}

test('winter tea completes with one engine clock and every visible mover registered',()=>{
  const {plan,play,frames,moved}=recording();
  assert.equal(play.duration,15.5);
  assert.equal(frames.length,931);
  const sourceEnd=Math.max(...plan.turns.map(t=>t.startS+t.segments.reduce((n,s)=>n+s.durationS,0)));
  assert.ok(play.duration>sourceEnd+.5,'final reaction must not cut off the dialogue');
  for(const prefix of ['mike-face-','anna-face-','tea-cup-','tea-pot-'])assert.ok([...moved].some(id=>id.startsWith(prefix)),prefix+' must visibly move');
  assert.equal(play.scene.animation.controlledEntityIds().has('tea-cup-body'),false,'shared cup is not owned by an actor skeleton');
  const ids=[...play.scene.entities.keys()];
  assert.ok(ids.some(id=>id.startsWith('mike-face-'))&&ids.some(id=>id.startsWith('anna-face-')));
  assert.equal(ids.filter(id=>id.startsWith('vocal-face-')).length,0,'unscoped legacy mouth IDs cannot alias both actors');
});

test('feet stay planted and visible sleeves connect fixed-length limbs',()=>{
  const {frames}=recording(),plants=new Map(),referenceLengths=new Map();
  for(const {state,sleeves} of frames){
    for(const actor of state.actors){
      for(const foot of actor.feet){
        assert.ok(foot.grounded,foot.id+' must stay planted in this standing conversation');
        if(!plants.has(foot.id))plants.set(foot.id,foot.position);
        near(foot.position,plants.get(foot.id),1e-8,foot.id+' slips');
      }
      for(const [side,sign] of [['left',-1],['right',1]]){
        for(const [from,to] of [['Hip','Knee'],['Knee','Ankle'],['Shoulder','Elbow'],['Elbow','Hand']]){
          const key=actor.id+'-'+side+from,len=distance(actor.joints[side+from],actor.joints[side+to]);
          assert.ok(len/actor.heightScale>.20&&len/actor.heightScale<.50,key+' is outside human limb proportions');
          if(!referenceLengths.has(key))referenceLengths.set(key,len);
          assert.ok(Math.abs(len-referenceLengths.get(key))<1e-7,key+' changes length');
        }
        for(const [part,from,to] of [['upperArm','Shoulder','Elbow'],['forearm','Elbow','Hand']]){
          const id=actor.id+'-'+part+sign,e=sleeves[id],matrix=compose(e.position,e.rotation,e.scale);
          const ends=[-1,1].map(sign=>[0,1,2].map(i=>matrix[i+12]+sign*.5*matrix[i+4]));
          const joints=[actor.joints[side+from],actor.joints[side+to]];
          const error=Math.min(distance(ends[0],joints[0])+distance(ends[1],joints[1]),distance(ends[0],joints[1])+distance(ends[1],joints[0]));
          // compose() publishes float32 matrices; at this street's 20 m world
          // coordinate, translation quantization is about 2 micrometres.
          assert.ok(error<1e-5,id+' visual endpoints detach from joints at '+state.timeS+'s: '+error+'m');
        }
      }
    }
  }
  assert.equal(plants.size,4);
});

test('the cup transfers continuously through real hand contact and the pot stays held while pouring',()=>{
  const {frames}=recording(),owners=[];
  let previous,dualContactFrames=0,pouringFrames=0;
  for(const {state} of frames){
    const {cup,teapot,actors,timeS}=state;
    if(cup.owner!==owners.at(-1))owners.push(cup.owner);
    if(previous){
      assert.ok(distance(cup.position,previous.position)<.04,'cup teleports at '+timeS+'s');
      assert.ok(distance(cup.rotation,previous.rotation)<.025,'cup rotation jumps at '+timeS+'s');
    }
    previous=cup;
    for(const actor of actors){
      for(const side of ['left','right']){
        const grip=actor.grips[side];
        if(grip==='cup')near(actor.joints[side+'Hand'],cup.gripPoints[actor.id],.004,actor.id+' '+side+' cannot reach the held cup at '+timeS+'s');
        if(grip==='teapot')near(actor.joints[side+'Hand'],teapot.gripPoint,.004,'teapot floats away from '+actor.id+' at '+timeS+'s');
      }
    }
    const mike=actors.find(a=>a.id==='mike'),anna=actors.find(a=>a.id==='anna');
    if(cup.owner==='mike'||cup.owner==='both')near(mike.joints.leftHand,cup.gripPoints.mike,.004,'cup owner Mike is not touching at '+timeS+'s');
    if(cup.owner==='anna'||cup.owner==='both')near(anna.joints.rightHand,cup.gripPoints.anna,.004,'cup owner Anna is not touching at '+timeS+'s');
    if(cup.owner==='both')dualContactFrames++;
    if(teapot.flow>.5){
      pouringFrames++;
      assert.equal(mike.grips.right,'teapot');
      assert.ok(teapot.spout[1]>cup.position[1]+.044,'pouring spout is below cup rim');
      assert.ok(Math.hypot(teapot.spout[0]-cup.position[0],teapot.spout[2]-cup.position[2])<.035,'stream misses the cup opening');
    }
  }
  assert.deepEqual(owners,['table','mike','both','anna']);
  assert.ok(dualContactFrames>=12,'handoff needs an observable interval of shared contact');
  assert.ok(pouringFrames>=60,'pouring action must persist for at least a second');
});

test('Anna actually touches the rendered cup rim with her lips throughout the sip',()=>{
  const {frames,rimTriangles}=recording();
  let contactFrames=0;
  for(const {state,cupTransform,innerLipPoint} of frames){
    if(state.timeS<13.30-1e-8||state.timeS>13.75+1e-8)continue;
    const matrix=compose(cupTransform.position,cupTransform.rotation,cupTransform.scale);
    const gap=Math.min(...rimTriangles.map(triangle=>pointTriangleDistance(innerLipPoint,...triangle.map(p=>worldPoint(matrix,p)))));
    assert.ok(gap<=.006,'visible lips miss cup rim at '+state.timeS+'s by '+gap+' m');
    assert.equal(state.cup.owner,'anna');
    const anna=state.actors.find(a=>a.id==='anna');
    near(anna.joints.rightHand,state.cup.gripPoints.anna,.004,'Anna loses the cup while sipping');
    contactFrames++;
  }
  assert.ok(contactFrames>=27,'lip contact must persist throughout the sip plateau');
});

test('injected phoneme score drives the right visible mouth independently of dialogue captions',()=>{
  const source=createTeaSceneDialoguePlan();
  const turn=(id,speakerId,startS,phone,hz)=>({id,speakerId,startS,text:'caption deliberately does not identify a vowel',segments:[{phone,durationS:1},{phone:'',durationS:.35}],pitch:[{timeS:0,hz}],pressure:[{timeS:0,pa:800}]});
  const plan={...source,turns:[turn('closed','mike',.3,'m',120),turn('open','anna',2,'a',190)]};
  const play=createTeaScene({plan}),samples=new Map();play.step(0,0);
  for(let tick=1;tick<=240;tick++){
    play.step(tick*DT,DT);
    if([48,156,240].includes(tick))samples.set(tick,{...structuredClone(play.inspect()),visibleMouthHeight:Object.fromEntries(['mike','anna'].map(id=>[id,play.scene.entities.get(id+'-face-mouth').scale[1]]))});
  }
  const closed=samples.get(48),open=samples.get(156),rest=samples.get(240);
  assert.deepEqual(closed.activeTurns.map(t=>t.id),['closed']);
  assert.deepEqual(open.activeTurns.map(t=>t.id),['open']);
  const actor=(state,id)=>state.actors.find(a=>a.id===id).face;
  assert.equal(actor(closed,'mike').speech.closure,1);
  assert.equal(actor(closed,'anna').speech.activity,0);
  assert.ok(actor(closed,'mike').lipGapM<.001,'bilabial /m/ must visibly close the lips');
  assert.ok(actor(open,'anna').lipGapM>.009,'open /a/ must visibly open the selected actor mouth');
  assert.ok(closed.visibleMouthHeight.mike<.003,'rendered /m/ mouth aperture must be closed');
  assert.ok(open.visibleMouthHeight.anna>.01,'rendered /a/ mouth aperture must open');
  assert.equal(actor(open,'mike').speech.activity,0,'previous speaker must not inherit the other voice');
  assert.equal(actor(rest,'mike').speech.activity,0);
  assert.equal(actor(rest,'anna').speech.activity,0);
});

test('procedural mover ownership updates cached partitions and is cleared on removal',()=>{
  const spec=id=>({id,mesh:{kind:'sphere',radius:.1},renderOnly:true});
  const scene=new Scene({version:1,entities:[spec('prop')]}),before=scene.renderMoverIds();
  assert.equal(before.has('prop'),false);
  assert.throws(()=>scene.usePlugin({id:'bad.missing',modules:[],renderMovers:['missing']}),/distinct existing/);
  assert.throws(()=>scene.usePlugin({id:'bad.duplicate',modules:[],renderMovers:['prop','prop']}),/distinct existing/);
  scene.usePlugin({id:'performer',modules:[{id:'test:prop-performance',phase:'simulate',rateHz:60,reads:[],writes:['entities'],after:['engine:vehicle-visuals'],context:'none',run:()=>[]}],renderMovers:['prop']});
  assert.ok(scene.renderMoverIds().has('prop'),'previously cached static partition must update');
  scene.remove('prop');assert.equal(scene.renderMoverIds().has('prop'),false);
  scene.add(spec('prop'));assert.equal(scene.renderMoverIds().has('prop'),false,'a replacement must not inherit removed ownership');
});

test('tea timeline initialization is idempotent and rejects competing timestamps',()=>{
  const play=createTeaScene({plan:createTeaSceneDialoguePlan()});
  assert.throws(()=>play.step(DT,DT),/Initialize/);
  play.step(0,0);const start=structuredClone(play.inspect());play.step(0,0);
  assert.deepEqual(play.inspect(),start);
  assert.throws(()=>play.step(.1,DT),/sequentially/);
  play.step(DT,DT);
  assert.throws(()=>play.step(0,0),/sequentially/);
  assert.throws(()=>play.step(DT*2,.1),/60 Hz/);
});
