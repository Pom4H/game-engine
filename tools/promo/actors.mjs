import {generateM3Vehicle,m3PartBody,m3PartMaterial,sampleWalker,bindHumanoid,clothLoftMesh} from '../../dist/index.js';

// Only the cast, rig binding, garment shapes and route are authored here.
// Locomotion, IK, planted contacts and transform updates are engine systems.
export const WALK={startX:-20,z:5.02,speed:.86,period:1.30,ground:.163};
const garments=[];
const part=(key,joint,offset,scale,options={})=>garments.push({key,binding:{entity:'walker-'+key,joint,offset,scale,...options}});
part('coat','pelvis',[.012,.228,0],[.395,.745,.525]);
part('hood','neck',[-.102,.022,0],[.266,.245,.344]);
part('collar','neck',[-.01,.055,0],[.252,.15,.296]);
part('hoodFold','neck',[-.13,-.069,0],[.29,.055,.342]);
part('head','head',[0,0,0],[.185,.225,.178]);
part('hat','head',[-.011,.098,0],[.22,.17,.214]);
part('hatBand','head',[-.009,.044,0],[.224,.066,.217]);
part('hatPom','head',[-.025,.187,0],[.063,.059,.064]);
part('nose','head',[.102,-.003,0],[.045,.041,.035]);
part('scarf','neck',[.023,.016,0],[.245,.118,.282]);
part('scarfTail','chest',[.19,.015,-.095],[.036,.31,.084]);
part('pack','pelvis',[-.236,.25,0],[.217,.451,.353]);
part('packPocket','pelvis',[-.354,.157,0],[.050,.226,.287]);
part('packPanel','pelvis',[-.354,.337,0],[.018,.169,.26]);
part('packZip','pelvis',[-.380,.253,0],[.012,.012,.274]);
part('packHandle','pelvis',[-.242,.485,0],[.045,.046,.10]);
part('packBadge','pelvis',[-.386,.175,0],[.010,.039,.072]);
part('coatPlacket','pelvis',[.211,.235,0],[.016,.62,.031]);
part('hem','pelvis',[.009,-.129,0],[.397,.035,.523]);
part('snowPack','pelvis',[-.249,.476,0],[.172,.025,.285]);
part('snowHood','neck',[-.1,.140,0],[.18,.025,.26]);
part('snowHat','head',[-.016,.177,0],[.136,.027,.139]);
part('snowBackpack','pelvis',[-.389,.279,0],[.009,.366,.258]);
part('snowCoat','pelvis',[-.207,.19,0],[.006,.59,.42]);
for(const side of [-1,1]){
 const name=side<0?'left':'right',q=String(side),joint=s=>name+s;
 part('thigh'+q,joint('Hip'),[0,0,0],[.183,1,.190],{boneTo:joint('Knee')});
 part('shin'+q,joint('Knee'),[0,0,0],[.151,1,.173],{boneTo:joint('Ankle')});
 part('knee'+q,joint('Knee'),[.007,0,0],[.169,.155,.172]);
 part('boot'+q,joint('Foot'),[.033,.097,0],[.324,.189,.149],{foot:name,rotation:[0,side*.035,0]});
 part('sole'+q,joint('Foot'),[.031,.016,0],[.334,.032,.157],{foot:name,rotation:[0,side*.035,0]});
 part('welt'+q,joint('Foot'),[.032,.036,0],[.332,.011,.156],{foot:name,rotation:[0,side*.035,0]});
 part('cuff'+q,joint('Foot'),[-.039,.174,0],[.149,.106,.151]);
 part('bootTongue'+q,joint('Foot'),[.047,.152,0],[.037,.09,.074]);
 for(let k=0;k<4;k++)part('lace'+q+':'+k,joint('Foot'),[.035+k*.013,.190-k*.017,0],[.030,.006,.081],{rotation:[0,0,.12]});
 part('upperArm'+q,joint('Shoulder'),[0,0,0],[.158,1,.165],{boneTo:joint('Elbow')});
 part('shoulder'+q,joint('Shoulder'),[.002,-.008,0],[.172,.13,.173]);
 part('forearm'+q,joint('Elbow'),[0,0,0],[.124,1,.136],{boneTo:joint('Hand')});
 part('elbow'+q,joint('Elbow'),[0,0,0],[.141,.133,.143]);
 part('glove'+q,joint('Hand'),[0,-.018,0],[.104,.151,.102]);
 part('thumb'+q,joint('Hand'),[.044,.009,-side*.018],[.040,.073,.049]);
 part('strap'+q,'chest',[.192,-.024,side*.173],[.032,.40,.046],{rotation:[0,0,-.04]});
 part('strapBack'+q,'chest',[-.179,.119,side*.14],[.055,.17,.047],{rotation:[0,0,.45]});
 part('packSide'+q,'pelvis',[-.225,.109,side*.164],[.15,.18,.047]);
 part('packClip'+q,'pelvis',[-.233,.145,side*.193],[.061,.027,.013]);
 part('coatPocket'+q,'pelvis',[.206,.087,side*.139],[.016,.127,.124],{rotation:[0,0,-.2]});
 part('shoulderSeam'+q,joint('Shoulder'),[-.035,.038,0],[.172,.009,.105]);
 part('snowSleeve'+q,joint('Shoulder'),[-.067,-.022,0],[.009,.10,.116]);
}
export function pedestrianAnimation(){return{id:'walker',root:[WALK.startX,WALK.ground,WALK.z],speed:WALK.speed,period:WALK.period,bindings:garments.map(g=>g.binding)};}
export function pedestrianPose(time){const pose=sampleWalker(pedestrianAnimation(),time),transforms=bindHumanoid(pose,garments.map(g=>g.binding));return{...pose,parts:Object.fromEntries(transforms.map(p=>[p.entity.slice(7),{position:p.position,rotation:p.rotation,scale:p.scale}]))};}
export function makePedestrian(){
 const pose=pedestrianPose(0);
 return garments.map(({key})=>{
  const segment=/thigh|shin|Arm|forearm/.test(key),coat=/coat|hem|hood|collar|Arm|forearm|elbow|shoulder/.test(key),pants=/thigh|shin|knee/.test(key),skin=/head|nose/.test(key),scarf=key.startsWith('scarf'),hat=key.startsWith('hat'),snow=key.startsWith('snow');
  const trim=/Zip|Badge|Clip|lace|welt/.test(key),boot=/boot|cuff/.test(key),pack=key.startsWith('pack');
  const color=snow?[.91,.94,.96,1]:coat?[.32,.37,.24,1]:pants?[.16,.18,.20,1]:skin?[.51,.34,.25,1]:scarf?[.24,.20,.16,1]:hat?[.12,.135,.125,1]:pack?[.29,.18,.105,1]:boot?[.235,.172,.119,1]:trim?[.21,.21,.19,1]:[.075,.08,.075,1];
  return{id:'walker-'+key,...pose.parts[key],mesh:clothingMesh(key,segment),material:{kind:snow?'snow':'default',color,roughness:skin?.67:trim?.69:.93,...(!skin&&!snow?{pattern:'fabric'}:{})}};
 });
}
function loft(rings,roundness=.8,folds=0,seed=1){return clothLoftMesh({rings,roundness,folds,seed,radialSegments:48,subdivisions:4});}
function clothingMesh(key,segment){
 if(/snowBack|snowCoat|snowSleeve/.test(key))return snowDust(key.length*29);
 if(/^snow/.test(key))return snowPatch(key.length*17);
 if(/head|nose|hatPom|glove|thumb|knee|elbow|shoulder-?1$/.test(key))return{kind:'sphere',radius:.5,segments:32};
 if(/strap|Placket|Zip|Badge|Handle|Clip|lace|Tongue|Seam/.test(key))return loft([[-.5,.36,.37],[-.43,.5,.5],[.43,.5,.5],[.5,.36,.37]],.48,.002,2);
 if(segment)return loft([[-.5,.40,.43],[-.39,.50,.50],[-.1,.495,.48],[.25,.485,.48],[.43,.45,.45],[.5,.39,.40]],.88,/thigh|shin/.test(key)?.048:.030,key.length);
 if(key.startsWith('boot'))return loft([[-.5,.42,.43,.02],[-.39,.50,.48,.02],[-.17,.49,.5,.02],[.04,.40,.46,-.045],[.27,.27,.42,-.185],[.5,.24,.36,-.235]],.64,.004);
 if(key.startsWith('sole')||key.startsWith('welt'))return loft([[-.5,.43,.43],[0,.5,.5],[.5,.47,.47]],.66,.001);
 if(key.startsWith('cuff'))return loft([[-.5,.43,.44],[-.37,.5,.5],[.36,.45,.47],[.5,.40,.43]],.82,.014);
 if(key==='pack')return loft([[-.5,.29,.36],[-.42,.44,.49],[-.08,.495,.50],[.29,.48,.465],[.44,.34,.38],[.5,.12,.25]],.64,.010,5);
 if(key.startsWith('pack'))return loft([[-.5,.31,.39],[-.36,.48,.48],[.28,.5,.5],[.46,.37,.41],[.5,.19,.26]],.56,.008,7);
 if(key==='coat')return loft([[-.5,.40,.44],[-.43,.495,.49],[-.15,.455,.465],[.17,.47,.49],[.30,.445,.49],[.40,.36,.45],[.5,.20,.30]],.84,.024,3);
 if(key==='collar')return loft([[-.5,.42,.45],[-.2,.49,.49],[.25,.46,.45],[.5,.43,.40]],.87,.016,8);
 if(key==='hood')return loft([[-.5,.20,.38],[-.25,.46,.48],[.0,.49,.50],[.25,.41,.455],[.5,.30,.37]],.86,.023,9);
 if(key.startsWith('hat'))return loft([[-.5,.45,.46],[-.2,.49,.49],[.20,.465,.47],[.37,.355,.365],[.5,.11,.12]],.96,.006,6);
 if(key.startsWith('scarf'))return loft([[-.5,.36,.4],[-.28,.49,.49],[.15,.45,.5],[.5,.41,.44]],.75,.023,11);
 return loft([[-.5,.43,.44],[-.3,.49,.49],[.3,.49,.49],[.5,.43,.44]],.8,.014,4);
}
function snowPatch(seed){
 // Small disconnected grains with a low compacted centre, attached to the rig.
 // Their transforms follow engine animation exactly like the garment itself.
 const positions=[],normals=[],indices=[];let state=seed;const random=()=>{state=(state*1664525+1013904223)>>>0;return state/4294967296;};
 for(let i=0;i<76;i++){const a=random()*Math.PI*2,r=Math.sqrt(random()),x=Math.cos(a)*r*.49,z=Math.sin(a)*r*.49,rx=.021+random()*.045,rz=.02+random()*.04,ry=.07+random()*.14,y=.12*(1-r*r);const start=positions.length/3,n=7;
  positions.push(x,y+ry,z);normals.push(0,1,0);
  for(let k=0;k<n;k++){const angle=k/n*Math.PI*2;positions.push(x+Math.cos(angle)*rx,y-random()*.04,z+Math.sin(angle)*rz);const q=[Math.cos(angle)*.55,.83,Math.sin(angle)*.55];normals.push(...q.map(v=>v/Math.hypot(...q)));}
  for(let k=0;k<n;k++)indices.push(start,start+1+(k+1)%n,start+1+k);
 }
 return{kind:'triangle-mesh',positions,normals,indices};
}

function snowDust(seed){
 const positions=[],normals=[],indices=[];let state=seed;const random=()=>{state=(state*1664525+1013904223)>>>0;return state/4294967296;};
 for(let i=0;i<180;i++){const y=random()-.5,z=(random()-.5)*Math.sqrt(Math.max(0,1-(y*1.6)**2));if(random()>.45+y*.6)continue;const x=-.05-random()*.4,sy=.003+random()**3*.029,sz=.003+random()**3*.031,n=5,start=positions.length/3;positions.push(x-.2,y,z);normals.push(-1,0,0);for(let j=0;j<n;j++){const a=j/n*Math.PI*2;positions.push(x,y+Math.sin(a)*sy,z+Math.cos(a)*sz);normals.push(-.94,.341,0);}for(let j=0;j<n;j++)indices.push(start,start+1+(j+1)%n,start+1+j);}
 return{kind:'triangle-mesh',positions,normals,indices};
}
export const CAR={startX:-21,z:-1.40,speed:2.65,radius:.346};
const PROCEDURAL_M3=generateM3Vehicle();
export function makeM3(id,x,z,color,speed=0){
 const entities=[],motions=[];
 for(const part of PROCEDURAL_M3.parts){
  const position=[x+part.position[0],.006+part.position[1],z+part.position[2]],body=m3PartBody(part,!!speed);
  const e={id:id+'-'+part.id,position,mesh:part.mesh,material:m3PartMaterial(part,color,!!speed),...(body?{body}:{}),...(part.rotation?{rotation:[...part.rotation]}:{})};
  entities.push(e);
  if(speed)motions.push({id:e.id,origin:position,wheel:!!part.wheel,radius:CAR.radius});
 }
 return{entities,motions,geometry:PROCEDURAL_M3};
}
