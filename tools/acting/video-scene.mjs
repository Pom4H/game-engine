import {Scene} from '../../dist/scene/scene.js';
import {conversationFaceEntities,conversationHeadMesh,ConversationFaceRig} from '../../dist/animation/conversation-face.js';
import {ActingRig,createActingMind,beginActingIntention,appraiseActingOutcome,actingAffectAt,makeActingCue} from '../../dist/acting/index.js';
import {makePedestrian,pedestrianAnimation} from '../promo/actors.mjs';

export const VIDEO_LINES=[
 {speakerId:'anna',text:'Привет, Мира! Поможешь включить фонарь?',phase:'Просьба о помощи',actions:{anna:'ask',mira:'listen'},shot:'two'},
 {speakerId:'mira',text:'Привет! Сразу не получается. Кажется, села батарея.',phase:'Неудача и сомнение',actions:{anna:'listen',mira:'think'},shot:'mira'},
 {speakerId:'anna',text:'Жаль... Давай проверим вместе?',phase:'Разочарование → уточнение',actions:{anna:'clarify',mira:'listen'},shot:'anna'},
 {speakerId:'mira',text:'Конечно. Сейчас подключу запасную.',phase:'Готовность помочь',actions:{anna:'listen',mira:'comfort'},shot:'two'},
 {speakerId:'anna',text:'Получилось! Спасибо, ты меня выручила!',phase:'Радость и благодарность',actions:{anna:'celebrate',mira:'acknowledge'},shot:'two'},
 {speakerId:'mira',text:'Рада помочь. Теперь здесь светло.',phase:'Взаимная симпатия',actions:{anna:'listen',mira:'explain'},shot:'mira'},
 {speakerId:'anna',text:'В следующий раз обращусь к тебе.',phase:'Отношение сохраняется',actions:{anna:'acknowledge',mira:'listen'},shot:'anna'},
];
const names={anna:'Анна',mira:'Мира'},skin={anna:[.62,.43,.33,1],mira:[.51,.34,.25,1]};
const box=(id,position,size,color)=>({id,position,mesh:{kind:'box',size},material:{color,roughness:.84}});
const labels={listen:'Слушает',ask:'Просит',explain:'Объясняет',decline:'Отказывает',acknowledge:'Кивает',clarify:'Уточняет',greet:'Приветствует',think:'Задумывается',celebrate:'Радуется',comfort:'Поддерживает'};
export function createActingVideo(plan){
 const cast=[{id:'anna',root:[-.63,.04,0],heading:.38,heightScale:.98,palette:{skin:skin.anna,coat:[.42,.17,.13,1],scarf:[.54,.34,.16,1],hat:[.22,.13,.10,1]}},
  {id:'mira',root:[.63,.04,0],heading:Math.PI-.38,heightScale:1.03,palette:{skin:skin.mira,coat:[.12,.30,.40,1],scarf:[.23,.39,.39,1],hat:[.10,.17,.20,1]}}];
 const walkers=cast.map(c=>{const w=pedestrianAnimation({...c,speed:0});w.stance='neutral';w.bindings=w.bindings.filter(b=>!b.entity.includes('-snow')).map(b=>{
  const key=b.entity.slice(c.id.length+1),next={...b};
  if(key==='hat')Object.assign(next,{offset:[-.011,.145,0],scale:[.22,.15,.214]});
  if(key==='hatBand')Object.assign(next,{offset:[-.009,.086,0],scale:[.224,.037,.217]});
  if(key==='hatPom')next.offset=[-.025,.23,0];if(key==='snowHat')next.offset=[-.016,.215,0];
  if(key==='nose')Object.assign(next,{offset:[.094,-.005,0],scale:[.035,.04,.03]});
  if(key==='scarf')Object.assign(next,{offset:[.023,-.018,0],scale:[.245,.087,.282]});
  if(key==='collar')Object.assign(next,{offset:[-.01,-.019,0],scale:[.252,.086,.296]});return next;
 });return w;});
 const faces=cast.flatMap(c=>conversationFaceEntities({id:c.id,skin:skin[c.id],iris:c.id==='anna'?[.17,.25,.20,1]:[.13,.18,.27,1]}));
 const entities=[...cast.flatMap(c=>makePedestrian({...c,speed:0}).filter(e=>!e.id.includes('-snow')).map(e=>e.id===c.id+'-head'?{...e,mesh:conversationHeadMesh()}:e)),...faces,
  box('courtyard',[0,-.04,0],[18,.16,18],[.38,.41,.39,1]),box('wall',[0,1.5,3.7],[12,3,.2],[.46,.39,.32,1]),
  box('wall-trim',[0,.23,3.53],[12,.38,.17],[.31,.30,.27,1]),
  ...[-3,-1.5,0,1.5,3].map((x,i)=>box('panel'+i,[x,1.8,3.56],[1.15,1.6,.06],[.16,.22,.24,1])),
  box('bench-seat',[-2.5,.49,1.45],[1.5,.11,.44],[.25,.13,.06,1]),box('bench-back',[-2.5,.83,1.62],[1.5,.6,.06],[.25,.13,.06,1]),
  ...[-3.05,-1.95].map((x,i)=>box('bench-leg'+i,[x,.25,1.45],[.09,.5,.4],[.10,.13,.14,1])),
  box('planter',[2.4,.27,1.7],[1.4,.5,.75],[.34,.31,.26,1]),
  ...[1.98,2.4,2.82].map((x,i)=>({id:'bush'+i,position:[x,.72,1.7],mesh:{kind:'sphere',radius:.38,segments:16},material:{color:[.13,.23+.02*i,.12,1],roughness:1}})),
  {id:'lamp-pole',position:[1.9,1.12,.8],mesh:{kind:'cylinder',radius:.025,height:2.2,segments:12},material:{color:[.10,.13,.14,1],roughness:.7}},
  {id:'lamp-bulb',position:[1.9,2.22,.8],mesh:{kind:'sphere',radius:.13,segments:20},material:{color:[.35,.34,.26,1],roughness:.4}},
  {id:'lamp-light',position:[1.9,2.12,.65],light:{kind:'point',color:[1,.73,.40],intensity:0,range:6}},
  {id:'soft-key',position:[-1.5,3,-2],light:{kind:'point',color:[1,.91,.79],intensity:4,range:8}},
  {id:'soft-fill',position:[1.5,2.7,-2],light:{kind:'point',color:[.72,.86,1],intensity:3,range:7}},
 ];
 const scene=new Scene({version:1,gravity:[0,0,0],ground:-100,entities,animation:{walkers,vehicles:[]},
  rendering:{sunDirection:[-.6,-1,-.5],sunIntensity:1.7,sunColor:[1,.93,.83],skyColor:[.25,.31,.38],exposure:1.08,shadowExtent:10},camera:{position:[0,1.65,-4.3],target:[0,1.03,0],fov:34}});
 for(const part of faces){const e=scene.entities.get(part.id);scene.setVisualTransform(e.id,e.position,e.rotation,e.scale);}
 const actors=cast.map(c=>({...c,rig:new ActingRig(scene.animation,c.id),face:new ConversationFaceRig(scene,{id:c.id,speakerId:c.id,turns:plan.turns}),
  mind:createActingMind(c.id,[{id:'light',importance:1}]),serial:0,action:'listen',facePose:null}));
 const anna=actors[0],mira=actors[1],events=[],trace=[];let lampOn=false,line=-1,shot='wide',time=0,started=false,lastCue=-1;
 const submit=(a,action,t,duration=2.4)=>{a.action=action;const other=actors.find(b=>b!==a);a.rig.submit(makeActingCue(a.mind,++a.serial,action,t,duration,[other.root[0],1.6,other.root[2]]));};
 function receipt(a,t,{progress,expectedProgress,attribution,confirmedResolution=false,reliabilityEvidence,competenceEvidence}){
  const other=actors.find(b=>b!==a);const e={id:`video:${a.id}:${a.mind.lastSequence+1}`,sequence:a.mind.lastSequence+1,goalId:'light',subject:'courtyard-lamp',otherId:other.id,atS:t,progress,expectedProgress,certainty:1,attribution,confirmedResolution,
   ...(reliabilityEvidence===undefined?{}:{reliabilityEvidence}),...(competenceEvidence===undefined?{}:{competenceEvidence})};
  a.mind=appraiseActingOutcome(a.mind,e);events.push({syntheticScenarioReceipt:true,...e});
 }
 function advance(t,dt){
  time=t;const current=plan.turns.findIndex(turn=>t>=turn.startS&&t<turn.endS+.22);
  if(!started){for(const a of actors){a.mind=beginActingIntention(a.mind,{id:'lamp:'+a.id,goalId:'light',subject:'courtyard-lamp',partnerId:actors.find(b=>b!==a).id},0);submit(a,'greet',0,2.1);}started=true;}
  if(current!==line&&current>=0){line=current;lastCue=t;const turn=plan.turns[line];
   if(line===2)receipt(anna,t,{progress:-.2,expectedProgress:1,attribution:'unable'});
   if(line===4){lampOn=true;scene.patchAppearance({materials:[{id:'lamp-bulb',set:{emissive:[1,.63,.24]}}]});scene.remove('lamp-light');scene.add({id:'lamp-light',position:[1.9,2.12,.65],light:{kind:'point',color:[1,.73,.40],intensity:4,range:6}});
    receipt(anna,t,{progress:1,expectedProgress:.5,attribution:'help',confirmedResolution:true,reliabilityEvidence:1,competenceEvidence:1});
    receipt(mira,t,{progress:1,expectedProgress:.8,attribution:'help',confirmedResolution:true,reliabilityEvidence:1});}
   for(const a of actors)submit(a,turn.actions[a.id],t,Math.min(11.5,Math.max(2.4,turn.endS-turn.startS+.6)));
  }
  const tail=t>plan.turns.at(-1).endS+.3;
  if(tail&&t-lastCue>=2.4){lastCue=t;for(const a of actors)submit(a,'listen',t,2.4);}
  if(dt)scene.step(dt);else scene.animation.step(0,scene.entities);
  for(const a of actors)a.facePose=a.rig.stepFace(a.face,scene.animation.timeSeconds,dt);
  let nextShot='wide',position=[0,1.64,-4.2],target=[0,1.02,0],fov=34;
  if(!tail&&line>=0){const desired=plan.turns[line].shot;if(desired!=='two'){
   const c=actors.find(a=>a.id===desired);nextShot=desired;position=[-c.root[0]*1.1,1.74,-1.65];target=[c.root[0],1.51,0];fov=28;
  }else{nextShot='two';position=[0,1.72,-3.35];target=[0,1.16,0];fov=35;}}
  shot=nextShot;scene.setCamera({position,target,fov});
 }
 advance(0,0);
 return{scene,duration:plan.duration,step:advance,dispose(){for(const a of actors)a.rig.dispose();},inspect(){
  const active=plan.turns.find(turn=>time>=turn.startS&&time<turn.endS+.22);
  return{timeS:time,shot,lampOn,subtitle:active?`${names[active.speakerId]}: ${active.text}`:'',phase:time>plan.turns.at(-1).endS?'Эмоция затухает · отношение сохраняется':line>=0?plan.turns[line].phase:'Встреча',
   actors:actors.map(a=>({id:a.id,name:names[a.id],action:a.action,label:labels[a.action]??a.action,affect:actingAffectAt(a.mind,time),sentiment:a.mind.sentiments.find(s=>s.subject===actors.find(b=>b!==a).id)??{affinity:0,benevolence:.5,reliability:.5,competence:.5},face:a.facePose,head:scene.animation.pose(a.id).joints.head,rig:a.rig.diagnostics})),events:[...events],syntheticScenarioReceipts:true};
 }};
}
