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
  cream:[.76,.72,.63,1],ivory:[.88,.88,.80,1],stone:[.36,.48,.57,1],
  blue:[.14,.38,.70,1],sky:[.36,.61,.82,1],deep:[.11,.23,.38,1],
  yellow:[.94,.68,.12,1],orange:[.89,.40,.15,1],green:[.19,.54,.37,1],
  mint:[.43,.71,.53,1],black:[.10,.15,.22,1],brick:[.73,.51,.33,1],
  skin:[.99,.73,.20,1],red:[.80,.25,.25,1],brown:[.34,.22,.16,1],
  lilac:[.62,.48,.76,1],steel:[.46,.56,.62,1],sand:[.80,.65,.47,1],
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
  const x=ROOM_X[room],left=room==='research',accent=left?P.blue:P.orange,soft=left?P.sky:P.brick;
  const root='campus:'+room;
  // Cutaway architectural model: dark base makes the light tiled floors read as
  // tangible toy blocks instead of overexposed floating white planes.
  this.box(root+':base',[x,-.19,-.15],[9.8,.42,8.55],P.stone);
  this.box(root+':floor',[x,.035,-.15],[9.42,.085,8.13],P.cream);
  for(let ix=0;ix<10;ix++)for(let iz=0;iz<9;iz++){
   const xx=x-4.12+ix*.91,zz=-3.82+iz*.90;
   if((ix+iz)%5===0)this.box(root+':floor-inlay:'+ix+':'+iz,[xx,.080,zz],[.87,.008,.85],P.ivory);
  }
  // Wall heights are deliberately open; two distinct colours identify the labs
  // without institutional cubicles or prison-like repeated windows.
  this.box(root+':back-wall',[x,1.65,-4.28],[9.59,3.3,.20],left?P.sky:P.cream);
  this.box(root+':outside-wall',[x+(left?-4.78:4.78),1.64,-.20],[.20,3.3,8.20],P.ivory);
  this.box(root+':inner-wall',[x+(left?4.78:-4.78),1.58,-2.15],[.18,3.16,4.03],P.ivory);
  this.box(root+':back-trim',[x,3.40,-4.30],[9.76,.18,.28],accent);
  this.box(root+':side-trim',[x+(left?-4.80:4.80),3.38,-.15],[.30,.20,8.25],P.yellow);
  this.box(root+':threshold',[x+(left?4.59:-4.59),.078,2.05],[.16,.08,2.40],accent);
  for(let i=0;i<11;i++)this.cyl(root+':wall-stud:'+i,[x-4.3+i*.86,3.53,-4.30],.15,.095,accent,12);
  // Architectural graphics: inset wall panels, legible signage, tactile lintels.
  this.box(root+':sign',[x,2.94,-4.06],[3.28,.42,.11],P.deep,{
   label:left?'RESEARCH':'BUILD',labelColor:[.99,.92,.74],roughness:.42,
  });
  for(let i=0;i<3;i++){
   this.box(root+':poster:'+i,[x-3.75+i*.75,2.41,-4.12],[.52,.62,.05],
    [P.green,P.yellow,P.lilac][i]!);
   this.box(root+':poster-icon:'+i,[x-3.73+i*.75,2.41,-4.06],[.18,.24,.015],P.ivory);
  }
  this.box(root+':taskboard',[x+2.49,2.36,-4.10],[2.72,1.42,.085],P.ivory);
  for(let i=0;i<6;i++){
   this.box(root+':note:'+i,[x+1.65+(i%3)*.76,2.65-Math.floor(i/3)*.63,-4.03],
    [.47,.40,.028],[P.yellow,P.mint,P.sky,P.orange,P.lilac,P.green][i]!);
  }
  // Two visually purposeful workstations; props describe distinct work
  // disciplines, never pretend to be additional invisible agents.
  this.box(root+':rug',[x,.078,-1.20],[7.55,.044,3.55],left?P.mint:P.sky);
  this.box(root+':desk',[x-.88,.79,-1.42],[3.12,.16,1.31],P.ivory);
  for(const dx of [-1.30,1.30])for(const zz of [-.51,.51]){
   this.box(root+':desk-leg:'+dx+':'+zz,[x-.88+dx,.38,-1.42+zz],[.12,.74,.12],P.stone);
  }
  this.box(root+':monitor-frame',[x-1.13,1.27,-1.78],[1.14,.68,.11],P.deep);
  this.box(root+':monitor-screen',[x-1.13,1.28,-1.708],[.99,.54,.02],left?P.blue:P.orange,{
   emissive:left?[.016,.036,.080]:[.080,.027,.015],roughness:.18,
  });
  this.box(root+':monitor-stem',[x-1.14,.96,-1.78],[.10,.13,.10],P.steel);
  this.box(root+':keyboard',[x-1.10,.898,-1.15],[.78,.035,.24],P.stone);
  this.cyl(root+':mug',[x+.18,.94,-1.13],.13,.16,P.yellow,16);
  this.box(root+':chair',[x-1.10,.49,.05],[.90,.17,.78],accent);
  this.box(root+':chair-back',[x-1.10,.86,.38],[.90,.76,.17],accent);
  // Engineering bench on opposite side provides an actual visual story.
  this.box(root+':bench',[x+2.45,.82,-.85],[2.65,.15,1.38],left?P.ivory:P.deep);
  for(const dx of [-1.0,1.0]){
   this.box(root+':bench-leg:'+dx,[x+2.45+dx,.40,-.85],[.14,.72,.15],P.steel);
  }
  if(left){
   this.cyl(root+':microscope-foot',[x+2.05,.96,-1.00],.28,.15,P.deep,16);
   this.cyl(root+':microscope-column',[x+2.08,1.30,-1.02],.09,.56,P.steel,12);
   this.box(root+':microscope-lens',[x+2.12,1.60,-1.05],[.18,.30,.22],P.blue);
   for(let j=0;j<3;j++){
    this.cyl(root+':sample:'+j,[x+2.91+j*.27,1.01,-.57],.10,.22,[P.green,P.yellow,P.lilac][j]!,12);
   }
  }else{
   this.box(root+':pcb',[x+2.46,.93,-.85],[1.30,.065,.73],P.green);
   for(let j=0;j<9;j++)this.box(root+':chip:'+j,
    [x+1.98+(j%3)*.44,.98,-1.11+Math.floor(j/3)*.25],[.20,.09,.15],j%3?P.black:P.yellow);
   this.box(root+':instrument',[x+3.31,1.22,-1.10],[.51,.64,.40],P.deep);
   this.box(root+':instrument-display',[x+3.32,1.26,-.884],[.38,.22,.026],P.yellow);
  }
  this.box(root+':storage',[x-3.40,.84,-3.12],[1.11,1.57,.70],left?P.deep:P.brick);
  for(let j=0;j<3;j++)this.box(root+':storage-panel:'+j,
   [x-3.40,.36+j*.48,-2.744],[.90,.32,.015],left?P.blue:P.sand);
  this.box(root+':shelf',[x-.8,2.03,-4.0],[2.7,.11,.30],P.brick);
  for(let i=0;i<5;i++)this.box(root+':books:'+i,
   [x-1.87+i*.43,2.30,-4.0],[.22,.45+(i%3)*.07,.24],[P.orange,P.yellow,P.blue,P.green,P.red][i]!);
  this.plant(root+':plant-back',x+3.53,-3.30);
  this.plant(root+':plant-front',x+(left?-3.55:3.58),3.14);
  this.lamp(root+':light',[x,4.8,-.7],left?18:20);
 }
 corridor():void{
  // Unbroken walkway and aligned thresholds make the travel connection obvious.
  this.box('campus:bridge:body',[0,-.19,2.06],[9.15,.39,3.20],P.stone);
  this.box('campus:bridge:surface',[0,.025,2.06],[8.95,.065,2.95],P.cream);
  for(let i=0;i<12;i++)for(let j=0;j<3;j++){
   const x=-4.10+i*.75,z=1.12+j*.92;
   this.box('campus:bridge:tile:'+i+':'+j,[x,.065,z],[.70,.014,.86],
    (i+j)%4===0?P.ivory:P.cream);
  }
  this.box('campus:bridge:center-line',[0,.082,2.06],[8.70,.016,.20],P.yellow);
  this.box('campus:bridge:edge:n',[0,.13,.53],[8.70,.13,.14],P.deep);
  this.box('campus:bridge:edge:s',[0,.13,3.55],[8.70,.13,.14],P.deep);
  for(let i=0;i<13;i++){
   const x=-4.18+i*.69;
   this.cyl('campus:bridge:stud:n:'+i,[x,.23,.54],.11,.055,P.stone,10);
   this.cyl('campus:bridge:stud:s:'+i,[x,.23,3.55],.11,.055,P.stone,10);
  }
  // Freestanding coloured gateway posts suggest movement, not imprisonment.
  for(const side of [-1,1]){
   const x=side*4.10;
   for(const z of [.57,3.48]){
    const name='campus:bridge:gate:'+side+':'+z;
    this.box(name,[x,.83,z],[.21,1.53,.23],side<0?P.blue:P.orange);
    this.cyl(name+':beacon',[x,1.65,z],.15,.12,P.yellow,12);
   }
  }
  this.box('campus:bridge:hint',[-.10,.064,.21],[2.2,.05,.16],P.ivory);
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
/** Arc-length sampled Catmull-Rom spline removes the sharp 90-degree
 * path corners. Geometry remains deterministic, with no simulation clock.
 * Sampling is a visual approximation between two known committed endpoints. */
function samplePath(nodes:readonly Vec3[],fraction:number):{position:Vec3;heading:number;walked:number}{
  const point=(segment:number,t:number):Vec3=>{
   const p0=nodes[Math.max(0,segment-1)]!,p1=nodes[segment]!,
    p2=nodes[segment+1]!,p3=nodes[Math.min(nodes.length-1,segment+2)]!;
   const evalAxis=(axis:0|1|2)=>{
    const a=p0[axis],b=p1[axis],c=p2[axis],d=p3[axis],t2=t*t,t3=t2*t;
    return .5*(2*b+(-a+c)*t+(2*a-5*b+4*c-d)*t2+(-a+3*b-3*c+d)*t3);
   };
   return[evalAxis(0),evalAxis(1),evalAxis(2)];
  };
  const samples:Vec3[]=[nodes[0]!];
  for(let seg=0;seg<nodes.length-1;seg++)for(let i=1;i<=22;i++)
   samples.push(point(seg,i/22));
  const lengths=samples.slice(1).map((p,i)=>distance(samples[i]!,p)),
    total=lengths.reduce((v,n)=>v+n,0);
  let remaining=ease(Math.max(0,Math.min(1,fraction)))*total,walked=0;
  for(let i=0;i<lengths.length;i++){
   const len=lengths[i]!;
   if(remaining<=len||i===lengths.length-1){
    const u=len<=1e-8?0:Math.max(0,Math.min(1,remaining/len)),a=samples[i]!,b=samples[i+1]!;
    const prev=samples[Math.max(0,i-1)]!,next=samples[Math.min(samples.length-1,i+2)]!,
      dx=next[0]-prev[0],dz=next[2]-prev[2];
    return{position:[lerp(a[0],b[0],u),lerp(a[1],b[1],u),lerp(a[2],b[2],u)],
      heading:Math.atan2(dx,dz),walked:walked+len*u};
   }
   remaining-=len;walked+=len;
  }
  return{position:nodes.at(-1)!,heading:0,walked:total};
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
   clearColor:[.29,.43,.55,1],
   environment:{temperatureC:22,humidity:.40,wind:[0,0,0],sunlight:.86,groundMoisture:0,precipitation:'arid',snowfall:'none'},
   rendering:{sunDirection:[-.55,.79,.35],sunColor:[1,.91,.79],sunIntensity:1.26,
    skyColor:[.36,.53,.70],exposure:.81,fogDensity:0,shadowExtent:35},
   camera:{position:[7.8,14.6,20.5],target:[0,.65,0],fov:44},
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
   let room=actor.agent.home,position=actor.home,heading=0,walked=0,traveling=false,strideWeight=0;
   let causeId:string|undefined,destination:CampusRoom|undefined;
   for(const journey of journeys){
    if(journey.agentId!==actor.agent.id)continue;
    if(journey.endMs<=cursorMs){
     const arrived=at(journey.to,this.actors.indexOf(actor));
     heading=samplePath(path(position,arrived,room,actor.lane),1).heading;
     room=journey.to;position=arrived;continue;
    }
    if(journey.startMs<=cursorMs){
     destination=journey.to;causeId=journey.causeId;
     const nodes=path(position,at(destination,this.actors.indexOf(actor)),room,actor.lane);
     const progress=(cursorMs-journey.startMs)/(journey.endMs-journey.startMs);
     strideWeight=Math.max(0,Math.min(1,Math.min(progress,1-progress)*9));
     const sample=samplePath(nodes,progress);
     position=sample.position;heading=sample.heading;walked=sample.walked;traveling=true;
     break;
    }
   }
   const phase=walkingPhase(walked,traveling),bob=traveling?Math.abs(Math.sin(phase))*.045*strideWeight:0;
   for(const part of actor.parts){
    const entity=this.scene.entities.get(part.id);
    if(!entity)throw new Error('Campus projector lost drawable '+part.id);
    const [lx,ly,lz]=part.offset;
    const rx=Math.cos(heading)*lx+Math.sin(heading)*lz,
      rz=-Math.sin(heading)*lx+Math.cos(heading)*lz;
    let swing=0;
    if(traveling){
     if(part.part==='leg:left'||part.part==='shoe:left')swing=.46*Math.sin(phase)*strideWeight;
     if(part.part==='leg:right'||part.part==='shoe:right')swing=-.46*Math.sin(phase)*strideWeight;
     if(part.part==='arm:left'||part.part==='hand:left')swing=-.30*Math.sin(phase)*strideWeight;
     if(part.part==='arm:right'||part.part==='hand:right')swing=.30*Math.sin(phase)*strideWeight;
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
