import {Scene} from '../../dist/scene/scene.js';
import {compose} from '../../dist/math.js';
import {ExpressiveFaceRig,expressiveFaceEntities,WINTER_FACE_IDENTITIES} from '../../dist/animation/expressive-face.js';
import {nativeSpeechPlan,NativeSpeechMotor,createVocalMotorFrame} from '../../dist/audio/native-speech.js';
import {LAB_VOICES,SPEECH_LAB_CASES} from '../speech-lab/corpus.mjs';
export const FACE_LAB_DURATION=14;
const smooth=x=>{x=Math.max(0,Math.min(1,x));return x*x*(3-2*x);};
const cue=(t,a,b,c,d)=>smooth((t-a)/(b-a))*(1-smooth((t-c)/(d-c)));
const transform=(matrix,p)=>[0,1,2].map(i=>matrix[i]*p[0]+matrix[i+4]*p[1]+matrix[i+8]*p[2]+matrix[i+12]);
function capMesh(band=false){
 const profile=band?[[1.018,0],[1.033,.006],[1.033,.018],[1.01,.023]]:[[1,0],[1.01,.025],[.92,.056],[.71,.080],[.40,.095],[.001,.103]],positions=[],normals=[],indices=[],steps=64;
 for(let i=0;i<profile.length;i++)for(let j=0;j<=steps;j++){const a=j/steps*Math.PI*2,c=Math.cos(a),s=Math.sin(a),[r,y]=profile[i],previous=profile[Math.max(0,i-1)],next=profile[Math.min(profile.length-1,i+1)],ny=-(next[0]-previous[0])*.107,nr=next[1]-previous[1],length=Math.hypot(nr,ny)||1;positions.push(c*.107*r,y,s*.088*r);normals.push(c*nr/length,ny/length,s*nr/length);if(i<profile.length-1&&j<steps){const q=i*(steps+1)+j;indices.push(q,q+steps+1,q+1,q+1,q+steps+1,q+steps+2);}}
 return{kind:'triangle-mesh',positions,normals,indices};
}
export function createFaceLab(){
 const actors=LAB_VOICES.map((voice,index)=>({voice,z:(index?1:-1)*.152,identity:WINTER_FACE_IDENTITIES[voice.id]}));
 const entities=actors.flatMap(({voice,z,identity},index)=>{
  const color=index?[.28,.15,.13,1]:[.12,.16,.19,1],scarf=index?[.46,.31,.18,1]:[.21,.26,.24,1];
  const part=(name,p,s,c)=>({id:voice.id+'-'+name,renderOnly:true,mesh:{kind:'sphere',radius:.5,segments:40},position:[...p.slice(0,2),p[2]+z],scale:s,material:{kind:'default',color:c,roughness:.84,pattern:'fabric'}});
  return [...expressiveFaceEntities(voice.id,identity),part('coat',[-.023,-.215,0],[.18,.24,.255],color),part('collar',[-.016,-.145,0],[.18,.105,.195],scarf),{...part('cap',[-.023,.100,0],[1,1,1],color),mesh:capMesh()},{...part('cap-rim',[-.023,.100,0],[1,1,1],scarf),mesh:capMesh(true)}];
 });
 const camera={position:[.77,.043,0],target:[0,.011,0],fov:30};
 const scene=new Scene({version:1,seed:5151,entities,camera,rendering:{sunDirection:[.70,.62,-.38],sunColor:[1,.88,.76],sunIntensity:1.9,skyColor:[.24,.30,.38],shadowExtent:1,exposure:1.05}});
 const turns=[];
 for(const [index,{voice}] of actors.entries())for(const [k,caseId] of ['p-a','t-a','k-a','see','she','give-me-tea'].entries()){
  const item=SPEECH_LAB_CASES.find(c=>c.id===caseId);if(!item)throw new Error('Fixed case absent: '+caseId);
  turns.push({id:voice.id+'-'+caseId,speakerId:voice.id,text:item.label,startS:1.1+k*1.8+index*.65,segments:[{phone:'',durationS:.12},...item.segments,{phone:'',durationS:.18}],pitch:[{timeS:0,hz:index?193:125}],pressure:[{timeS:0,pa:800}]});
 }
 const plan=nativeSpeechPlan(LAB_VOICES,turns),systems=actors.map(actor=>({...actor,rig:new ExpressiveFaceRig(scene,actor.voice.id,actor.identity),motor:new NativeSpeechMotor(plan,actor.voice.id),state:createVocalMotorFrame(actor.voice.tractLengthM)}));
 let observation,tick=-1;
 const fixedStep=t=>{
  const state=[];
  for(const [index,actor] of systems.entries()){
   const {voice,rig,motor}=actor,sign=index?1:-1;
   const yaw=.10*Math.sin(t*.59+index*1.1),nod=.035*Math.sin(t*.94+index*1.6),rotation=[0,yaw,nod],position=[0,.0018*Math.sin(t*1.5+index),actor.z];
   const smile=cue(t,3.4+index*.4,4.3+index*.4,6.0,6.8),surprise=cue(t,7.1,7.5,8.2,8.8),smirk=cue(t,10.8,11.5,12.8,13.6);
   const gazeTarget=t<5?[1,.035,actor.z+sign*.20]:t<9?[1,.085,actor.z-sign*.35]:[1,-.02,actor.z];
   const blink=cue(t,6.65+index*.3,6.70+index*.3,6.73+index*.3,6.85+index*.3);
   const frame=rig.step(t,tick===0?0:1/60,{position,rotation,gazeTarget},motor.sample(t,actor.state),[
    {weight:smile,actions:{smileLeft:.48,smileRight:.67,cheekLeft:.28,cheekRight:.36}},
    {weight:surprise,actions:{browLeft:.82,browRight:.72}},
    {weight:smirk,actions:{smileRight:.76,browLeft:.70,browTiltRight:.38,cheekRight:.32}},
    {weight:1,actions:{blink}},
   ]);
   const matrix=compose(position,rotation,[1,1,1]);
   for(const [id,p] of [['cap',[-.023,.100,0]],['cap-rim',[-.023,.100,0]]]){const entity=scene.entities.get(voice.id+'-'+id);entity.position.splice(0,3,...transform(matrix,p));entity.rotation.splice(0,3,...rotation);}
   state.push({id:voice.id,phone:actor.state.phone,active:actor.state.active,face:frame});
  }
  observation={timeS:t,actors:state,source:'shared-vocal-motor',audio:'muted-diagnostic',skinSource:'CC0 MakeHuman base + procedural flex',sceneEntities:scene.entities.size};
 };
 scene.usePlugin({id:'face-lab',renderMovers:entities.map(e=>e.id),systems:[{id:'face-lab.step',run:(_host,frame)=>fixedStep(frame.at)}],modules:[{id:'face:lab',phase:'simulate',rateHz:60,reads:[],writes:['entities'],after:['engine:vehicle-visuals'],context:'none',run:(_context,frame)=>[{type:'system',action:'face-lab.step',deltaSeconds:frame.deltaSeconds}]}]});
 return {scene,duration:FACE_LAB_DURATION,plan,
  frame(t){if(!Number.isFinite(t)||t<0||t>FACE_LAB_DURATION)throw new RangeError('Invalid face-lab time');const target=Math.round(t*60);if(target<tick)throw new RangeError('Create a new lab for replay');while(tick<target){tick++;if(tick===0)fixedStep(0);else scene.step(1/60);}return observation;},
  dispose(){for(const actor of systems)actor.rig.dispose();},inspect:()=>observation,
 };
}
