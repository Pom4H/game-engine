/** Two connected toy-brick offices. Actors/paths are render-only projections
 * of committed ActivityFacts; there is no second agent/task scheduler. */
import {Scene} from '../scene/scene.js';
import {batchStaticScenery} from '../procedural/static-batch.js';
import type {Color,EntitySpec,MaterialSpec,SceneSpec} from '../scene/types.js';
import type {Vec3} from '../math.js';
import type {ActivityFact} from './activity.js';

export type CampusRoom='research'|'build';
export interface CampusAgent {readonly id:string;readonly name:string;readonly home:CampusRoom}
export interface CampusAgentPose {readonly id:string;readonly room:CampusRoom;readonly traveling:boolean;readonly position:Vec3;readonly destination?:CampusRoom;readonly causeId?:string}
const P={
  cream:[.95,.91,.83,1],ivory:[.98,.976,.95,1],stone:[.74,.82,.87,1],
  blue:[.23,.54,.84,1],sky:[.65,.82,.94,1],deep:[.14,.28,.46,1],
  yellow:[1,.77,.15,1],orange:[.98,.49,.19,1],green:[.29,.72,.46,1],
  mint:[.60,.82,.68,1],black:[.15,.22,.30,1],brick:[.86,.69,.50,1],
  skin:[1,.77,.22,1],red:[.89,.31,.27,1],brown:[.40,.27,.21,1],
} satisfies Record<string,Color>;
const ROOM_X:Record<CampusRoom,number>={research:-9,build:9};
const other=(v:CampusRoom):CampusRoom=>v==='research'?'build':'research';
const asRoom=(v:string):CampusRoom|undefined=>v==='research'||v==='build'?v:undefined;
const lerp=(a:number,b:number,t:number)=>a+(b-a)*t;
const ease=(t:number)=>t*t*(3-2*t);
const distance=(a:Vec3,b:Vec3)=>Math.hypot(a[0]-b[0],a[1]-b[1],a[2]-b[2]);
const at=(r:CampusRoom,index:number):Vec3=>[ROOM_X[r]+(index%3-1)*.85,.08,1.25+(index%2)*.65];

interface Part{readonly id:string;readonly offset:Vec3;readonly part:string}
interface Actor{readonly agent:CampusAgent;readonly home:Vec3;readonly parts:readonly Part[];readonly lane:number}
class Blocks {
 readonly pieces:EntitySpec[]=[];
 box(id:string,p:Vec3,size:Vec3,color:Color,extra:Partial<MaterialSpec>={}):void{
  this.pieces.push({id,position:p,renderOnly:true,mesh:{kind:'box',size},
   material:{color,roughness:.33,clearcoat:.18,clearcoatRoughness:.34,...extra}});
 }
 cyl(id:string,p:Vec3,r:number,h:number,color:Color,segments=12):void{
  this.pieces.push({id,position:p,renderOnly:true,mesh:{kind:'cylinder',radius:r,height:h,segments},
   material:{color,roughness:.30,clearcoat:.16}});
 }
 lamp(id:string,p:Vec3,power=18):void{
  this.pieces.push({id,position:p,renderOnly:true,light:{kind:'point',color:[1,.93,.84],intensity:power,range:10}});
 }
 plant(name:string,x:number,z:number):void{
  this.box(name+':pot',[x,.26,z],[.42,.48,.42],P.ivory);
  this.cyl(name+':stem',[x,.64,z],.06,.5,P.green);
  for(let i=0;i<4;i++)this.box(name+':leaf:'+i,
   [x+Math.cos(i*Math.PI/2)*.2,.83+(i%2)*.14,z+Math.sin(i*Math.PI/2)*.2],
   [.19,.43,.11],i%2?P.green:P.mint);
 }
 room(room:CampusRoom):void{
  const x=ROOM_X[room],left=room==='research',accent=left?P.blue:P.orange;
  this.box('campus:'+room+':base',[x,-.18,-.10],[9.80,.38,8.55],P.stone);
  this.box('campus:'+room+':floor',[x,.035,-.10],[9.45,.08,8.18],P.cream);
  this.box('campus:'+room+':back-wall',[x,1.65,-4.28],[9.60,3.30,.22],left?P.sky:P.ivory);
  this.box('campus:'+room+':outside-wall',[x+(left?-4.78:4.78),1.64,-.20],[.22,3.3,8.20],P.ivory);
  // Entrance occupies the front portion of the internal wall.
  this.box('campus:'+room+':inner-wall',[x+(left?4.78:-4.78),1.60,-2.13],[.18,3.22,4.1],P.ivory);
  this.box('campus:'+room+':roofline',[x,3.38,-4.30],[9.70,.16,.25],accent);
  this.box('campus:'+room+':trim',[x+(left?-4.79:4.79),3.39,-.20],[.30,.16,8.3],P.yellow);
  for(let i=0;i<11;i++)this.cyl('campus:'+room+':stud:'+i,[x-4.28+i*.86,3.5,-4.3],.16,.085,accent,8);
  // Color-coded work surface with a monitor and two chairs.
  this.box('campus:'+room+':rug',[x,.079,-1.05],[6.9,.04,3.55],left?P.mint:P.sky);
  this.box('campus:'+room+':desk',[x-.75,.80,-1.33],[3.35,.15,1.08],P.ivory);
  for(const dx of [-1.35,1.35])for(const zz of [-1.68,-.98])
   this.box('campus:'+room+':desk-leg:'+dx+':'+zz,[x-.75+dx,.38,zz],[.12,.74,.12],P.stone);
  this.box('campus:'+room+':monitor',[x-.87,1.29,-1.67],[1.18,.68,.12],P.black);
  this.box('campus:'+room+':monitor-glass',[x-.87,1.30,-1.59],[1.03,.53,.02],left?P.sky:P.orange,{emissive:[.014,.024,.038]});
  this.box('campus:'+room+':keyboard',[x-.77,.895,-1.08],[.87,.04,.22],P.stone);
  this.box('campus:'+room+':seat',[x-.8,.49,-.06],[.8,.17,.74],accent);
  this.box('campus:'+room+':seat-back',[x-.8,.83,.18],[.8,.71,.16],accent);
  this.box('campus:'+room+':board',[x+2.42,2.48,-4.12],[2.4,1.36,.09],P.ivory);
  for(let i=0;i<4;i++)this.box('campus:'+room+':sticky:'+i,[x+1.66+(i%2)*.86,2.72-Math.floor(i/2)*.58,-4.04],
   [.45,.38,.045],[P.yellow,P.mint,P.sky,P.orange][i]!);
  this.box('campus:'+room+':cabinet',[x-3.20,.83,-3.45],[1.15,1.58,.75],left?P.deep:P.brick);
  this.plant('campus:'+room+':plant',x+3.40,-2.84);
  this.plant('campus:'+room+':doorplant',x+(left?3.4:-3.4),3.14);
  this.lamp('campus:'+room+':warm-light',[x,4.9,-.3],23);
  // Room's visible badge is a structural sign, not a status invented by the renderer.
  this.box('campus:'+room+':sign',[x,3.07,-4.09],[2.4,.31,.10],accent);
 }
 corridor():void{
  this.box('campus:bridge:body',[0,-.175,2.08],[9.0,.34,2.7],P.stone);
  this.box('campus:bridge:walk',[0,.012,2.08],[8.8,.042,2.45],P.ivory);
  this.box('campus:bridge:stripe',[0,.052,2.08],[8.5,.015,.24],P.yellow);
  for(let i=0;i<13;i++){
   const x=-4.15+i*.70;
   this.cyl('campus:bridge:stud:n:'+i,[x,.045,.91],.13,.068,P.stone,8);
   this.cyl('campus:bridge:stud:s:'+i,[x,.045,3.26],.13,.068,P.stone,8);
  }
  // Small lights establish a clear passable connection between two offices.
  for(let i=0;i<3;i++){
   const x=-2.8+i*2.8;
   this.box('campus:bridge:light:'+i,[x,.10,3.18],[.27,.09,.11],P.yellow,{emissive:[.14,.10,.025]});
  }
 }
 minifig(id:string,home:Vec3,color:Color,hair:Color):readonly Part[]{
  const parts:Part[]=[];
  const box=(name:string,p:Vec3,size:Vec3,c:Color)=>{
   const key=id+':'+name;this.box(key,[home[0]+p[0],home[1]+p[1],home[2]+p[2]],size,c);
   parts.push({id:key,offset:p,part:name});
  };
  const cyl=(name:string,p:Vec3,r:number,h:number,c:Color,segments=12)=>{
   const key=id+':'+name;this.cyl(key,[home[0]+p[0],home[1]+p[1],home[2]+p[2]],r,h,c,segments);
   parts.push({id:key,offset:p,part:name});
  };
  for(const [side,dir]of [['left',-1],['right',1]] as const){
   box('leg:'+side,[dir*.16,.29,.04],[.27,.49,.31],P.deep);
   box('shoe:'+side,[dir*.16,.085,.14],[.29,.15,.39],P.black);
   cyl('arm:'+side,[dir*.45,.80,0],.12,.42,color,10);
   cyl('hand:'+side,[dir*.45,.54,.05],.125,.13,P.skin,10);
  }
  box('hips',[0,.55,0],[.61,.17,.38],P.deep);
  box('body',[0,.88,0],[.72,.60,.39],color);
  cyl('neck',[0,1.19,0],.12,.15,P.skin);
  cyl('head',[0,1.44,0],.26,.43,P.skin,16);
  cyl('hair',[0,1.66,0],.27,.14,hair,16);
  cyl('head-stud',[0,1.74,0],.14,.085,hair,10);
  for(const [side,dir]of [['left',-1],['right',1]]as const)
   box('eye:'+side,[dir*.095,1.51,.258],[.046,.067,.024],P.black);
  box('smile',[0,1.37,.26],[.13,.022,.022],P.brown);
  return parts;
 }
}

/** Route is fully defined by a pair of committed start/arrival facts.
 * Before arrival is observed, a live observer has no evidence for a
 * duration and therefore does not pretend a known trajectory. */
export function campusJourneys(facts:readonly ActivityFact[]):readonly {
 readonly agentId:string;readonly startMs:number;readonly endMs:number;
 readonly to:CampusRoom;readonly causeId:string
}[]{
 const byId=new Map(facts.map(f=>[f.id,f]));
 return Object.freeze(facts.flatMap(f=>{
  if(f.kind!=='agent.move.completed'||f.actor.domain!=='agent'||!f.causeId)return[];
  const start=byId.get(f.causeId),to=asRoom(f.target?.id??'');
  if(!start||start.kind!=='agent.move.started'||start.actor.id!==f.actor.id||
    start.target?.domain!=='office'||f.target?.domain!=='office'||start.target.id!==to||
    !to||start.atMs>=f.atMs)return[];
  return[{agentId:f.actor.id,startMs:start.atMs,endMs:f.atMs,to,causeId:start.id}];
 }).sort((a,b)=>a.startMs-b.startMs||(a.causeId<b.causeId?-1:1)));
}
function path(from:Vec3,to:Vec3,fromRoom:CampusRoom,lane:number):readonly Vec3[]{
 const fromX=fromRoom==='research'?-4.5:4.5,toX=-fromX;
 return[from,[fromX,.08,2.08+lane],[0,.08,2.08+lane],[toX,.08,2.08+lane],to];
}
function samplePath(nodes:readonly Vec3[],fraction:number):{position:Vec3;heading:number;walked:number}{
 const lengths=nodes.slice(1).map((p,i)=>distance(nodes[i]!,p)),total=lengths.reduce((a,b)=>a+b,0);
 let remaining=ease(Math.max(0,Math.min(1,fraction)))*total,travelled=0;
 for(let i=0;i<lengths.length;i++){
  const segment=lengths[i]!;
  if(remaining<=segment||i===lengths.length-1){
   const u=segment===0?0:Math.max(0,Math.min(1,remaining/segment)),a=nodes[i]!,b=nodes[i+1]!;
   return{position:[lerp(a[0],b[0],u),lerp(a[1],b[1],u),lerp(a[2],b[2],u)],
    heading:Math.atan2(b[0]-a[0],b[2]-a[2]),walked:travelled+segment*u};
  }
  remaining-=segment;travelled+=segment;
 }
 return{position:nodes[0]!,heading:0,walked:0};
}
export class AgentCampus{
 readonly scene:Scene;
 readonly agents:readonly CampusAgent[];
 readonly style='toy-brick-campus-v1';
 private readonly actors:readonly Actor[];
 constructor(roster:readonly CampusAgent[]){
  if(roster.length>8||new Set(roster.map(a=>a.id)).size!==roster.length||
    roster.some(a=>!a.id||a.id.length>180||!a.name||a.name.length>120||!asRoom(a.home)))
   throw new TypeError('Campus supports 0–8 unique named agents with valid home offices');
  this.agents=roster.map(a=>Object.freeze({...a}));
  const kit=new Blocks();
  kit.room('research');kit.room('build');kit.corridor();
  const palette=[P.blue,P.orange,P.green,P.yellow,P.deep,P.mint];
  const actors=roster.map((agent,index)=>{
   const home=at(agent.home,index),id='campus:agent:'+index;
   const parts=kit.minifig(id,home,palette[index%palette.length]!,
    index%2===0?P.brown:P.black);
   return{id:agent.id,agent,home,parts,lane:(index%3-1)*.35};
  });
  const moveIds=new Set(actors.flatMap(a=>a.parts.map(p=>p.id)));
  const entities=batchStaticScenery(kit.pieces,e=>!!e.renderOnly&&!moveIds.has(e.id)&&!!e.mesh,14);
  const spec:SceneSpec={version:1,seed:4129,ground:-.45,entities,
   clearColor:[.77,.86,.93,1],
   environment:{temperatureC:22,humidity:.40,wind:[0,0,0],sunlight:.86,groundMoisture:0,precipitation:'arid',snowfall:'none'},
   rendering:{sunDirection:[-.55,.79,.35],sunColor:[1,.95,.86],sunIntensity:1.7,
    skyColor:[.62,.76,.90],exposure:.99,fogDensity:0,shadowExtent:35},
   camera:{position:[10.6,17.0,23.5],target:[0,.5,0],fov:47},
  };
  this.scene=new Scene(spec);
  this.actors=actors;
  if(moveIds.size)this.scene.usePlugin({id:'campus:visual-agents',renderMovers:[...moveIds],
   modules:[{id:'campus:visual-projection',phase:'simulate',rateHz:60,reads:[],writes:[],
    after:[],context:'none',run:()=>[]}],
  });
 }
 project(facts:readonly ActivityFact[],cursorMs:number):readonly CampusAgentPose[]{
  if(!Number.isFinite(cursorMs)||cursorMs<0)throw new RangeError('Invalid campus replay time');
  const journeys=campusJourneys(facts),result:CampusAgentPose[]=[];
  for(const actor of this.actors){
   let room=actor.agent.home,position=actor.home,heading=0,walked=0,traveling=false;
   let causeId:string|undefined,destination:CampusRoom|undefined;
   for(const journey of journeys){
    if(journey.agentId!==actor.agent.id)continue;
    if(journey.endMs<=cursorMs){
     room=journey.to;position=at(room,this.actors.indexOf(actor));continue;
    }
    if(journey.startMs<=cursorMs){
     destination=journey.to;causeId=journey.causeId;
     const nodes=path(position,at(destination,this.actors.indexOf(actor)),room,actor.lane);
     const sample=samplePath(nodes,(cursorMs-journey.startMs)/(journey.endMs-journey.startMs));
     position=sample.position;heading=sample.heading;walked=sample.walked;traveling=true;
     break;
    }
   }
   const phase=walkingPhase(walked,traveling),bob=traveling?Math.abs(Math.sin(phase))*.045:0;
   for(const part of actor.parts){
    const entity=this.scene.entities.get(part.id);
    if(!entity)throw new Error('Campus projector lost drawable '+part.id);
    const [lx,ly,lz]=part.offset;
    const rx=Math.cos(heading)*lx+Math.sin(heading)*lz,
      rz=-Math.sin(heading)*lx+Math.cos(heading)*lz;
    let swing=0;
    if(traveling){
     if(part.part==='leg:left'||part.part==='shoe:left')swing=.46*Math.sin(phase);
     if(part.part==='leg:right'||part.part==='shoe:right')swing=-.46*Math.sin(phase);
     if(part.part==='arm:left'||part.part==='hand:left')swing=-.30*Math.sin(phase);
     if(part.part==='arm:right'||part.part==='hand:right')swing=.30*Math.sin(phase);
    }
    entity.position.splice(0,3,position[0]+rx,position[1]+ly+bob,position[2]+rz);
    entity.rotation.splice(0,3,swing,heading,0);
   }
   result.push(Object.freeze({id:actor.agent.id,room,traveling,position:[...position] as Vec3,
    ...(destination?{destination}:{}),...(causeId?{causeId}:{})}));
  }
  return Object.freeze(result);
 }
}
const walkingPhase=(metres:number,moving:boolean)=>moving?metres*6.8:0;
