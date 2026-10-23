import {batchStaticScenery} from '../procedural/static-batch.js';
import {Scene} from '../scene/scene.js';
import type {Color,EntitySpec,MaterialSpec,SceneSpec} from '../scene/types.js';
import type {Vec3} from '../math.js';
import type {ActivityFact} from './activity.js';

export type OfficePhase='offline'|'idle'|'working'|'tool'|'blocked'|'done';
export interface OfficeAgent {readonly id:string;readonly name:string}
export interface OfficeAgentState extends OfficeAgent {
 readonly phase:OfficePhase;readonly task?:string;readonly tool?:string;
 readonly lastFactId?:string;readonly atMs?:number;readonly tokens:number;readonly costUsd:number;
}

/** External events are the only authority for agent state. Rendering cannot
 * invent subagents, tool executions or token usage. */
export function projectOfficeAgents(
 agents:readonly OfficeAgent[],facts:readonly ActivityFact[],asOfMs=Infinity,
):readonly OfficeAgentState[]{
 const state=new Map(agents.map(a=>[a.id,{...a,phase:'offline' as OfficePhase,tokens:0,costUsd:0} as OfficeAgentState]));
 const ordered=facts.filter(f=>f.atMs<=asOfMs).sort((a,b)=>a.atMs-b.atMs||(a.id<b.id?-1:a.id>b.id?1:0));
 for(const fact of ordered){
  if(fact.actor.domain!=='agent')continue;
  const before=state.get(fact.actor.id);if(!before)continue;
  let phase=before.phase,task=before.task,tool=before.tool;
  switch(fact.kind){
   case 'agent.started':phase='idle';task=undefined;tool=undefined;break;
   case 'agent.task.started':phase='working';task=fact.label??fact.target?.id??'Task';tool=undefined;break;
   case 'agent.tool.started':phase='tool';tool=fact.label??fact.target?.id??'Tool';break;
   case 'agent.tool.completed':phase=task?'working':'idle';tool=undefined;break;
   case 'agent.tool.failed':phase='blocked';tool=fact.label??tool;break;
   case 'agent.task.completed':phase='done';task=undefined;tool=undefined;break;
   case 'agent.task.failed':phase='blocked';tool=undefined;break;
   case 'agent.stopped':phase='offline';task=undefined;tool=undefined;break;
   default:break;
  }
  state.set(fact.actor.id,{id:before.id,name:before.name,phase,
   ...(task!==undefined?{task}:{}),...(tool!==undefined?{tool}:{}),
   lastFactId:fact.id,atMs:fact.atMs,tokens:before.tokens+(fact.usage?.tokens??0),
   costUsd:before.costUsd+(fact.usage?.costUsd??0)});
 }
 return Object.freeze([...state.values()].map(a=>Object.freeze(a)));
}

/** Toy-brick geometry is an intentional visual LOD. All parts are ordinary
 * engine meshes, not a parallel renderer or another source of truth. */
const PAL={
 white:[.94,.955,.96,1],paper:[.99,.985,.95,1],cream:[.94,.855,.72,1],
 sky:[.54,.74,.92,1],blue:[.18,.43,.78,1],navy:[.14,.25,.43,1],
 yellow:[1,.77,.13,1],orange:[.99,.52,.16,1],green:[.25,.69,.40,1],
 lime:[.59,.81,.32,1],red:[.89,.30,.27,1],tan:[.86,.74,.57,1],
 floor:[.84,.76,.62,1],edge:[.55,.63,.72,1],dark:[.20,.26,.31,1],
 skin:[1,.78,.23,1],brown:[.37,.23,.15,1],
} satisfies Record<string,Color>;
const PHASE_COLOR:Record<OfficePhase,Color>={
 offline:PAL.edge,idle:PAL.yellow,working:PAL.blue,
 tool:PAL.orange,blocked:PAL.red,done:PAL.green,
};
const WARDROBE:readonly Color[]=[PAL.orange,PAL.green,PAL.blue,PAL.tan,PAL.navy,PAL.red,PAL.lime,PAL.sky];
type Minifig={readonly armL:string;readonly armR:string;readonly handL:string;readonly handR:string};
type OfficeActor={readonly id:string;readonly marker:string;readonly fig:Minifig;readonly position:Vec3};
type BrickSpec={readonly color:Color;readonly roughness?:number;readonly extra?:Partial<MaterialSpec>};
export const OFFICE_VISUAL_STYLE='toy-brick-v1' as const;

function material(color:Color,extra:Partial<MaterialSpec>={}):MaterialSpec{
 return{color,roughness:.32,metalness:0,clearcoat:.16,clearcoatRoughness:.35,...extra};
}
class BrickKit {
 readonly entities:EntitySpec[]=[];
 box(id:string,position:Vec3,size:Vec3,color:Color,extra:Partial<MaterialSpec>={}):void{
  this.entities.push({id,position,renderOnly:true,mesh:{kind:'box',size},material:material(color,extra)});
 }
 cylinder(id:string,position:Vec3,radius:number,height:number,color:Color,extra:Partial<MaterialSpec>={},segments=12):void{
  this.entities.push({id,position,renderOnly:true,mesh:{kind:'cylinder',radius,height,segments},material:material(color,extra)});
 }
 /** Exposed studs carry the toy-building scale. Border-only studs avoid
  * thousands of interior drawables for an 18m-wide miniature. */
 studs(prefix:string,y:number,xs:readonly number[],zs:readonly number[],color:Color,edgeOnly=false):void{
  for(let a=0;a<xs.length;a++)for(let b=0;b<zs.length;b++){
   if(edgeOnly&&a!==0&&b!==0&&a!==xs.length-1&&b!==zs.length-1)continue;
   this.cylinder(prefix+':stud:'+a+':'+b,[xs[a]!,y,zs[b]!],.145,.085,color,{},8);
  }
 }
 plant(id:string,p:Vec3,size=1):void{
  const [x,y,z]=p;
  this.box(id+':pot',[x,y+.22*size,z],[.40*size,.43*size,.40*size],PAL.paper);
  this.cylinder(id+':soil',[x,y+.44*size,z],.165*size,.04*size,PAL.brown,{},10);
  this.cylinder(id+':stem',[x,y+.64*size,z],.05*size,.47*size,PAL.green);
  for(let i=0;i<4;i++){
   const angle=i*Math.PI/2;
   this.box(id+':leaf:'+i,[x+Math.cos(angle)*.14*size,y+(.72+(i%2)*.13)*size,z+Math.sin(angle)*.14*size],
    [.18*size,.36*size,.085*size],i%2?PAL.green:PAL.lime);
  }
 }
 light(id:string,p:Vec3,intensity=18):void{
  this.entities.push({id,position:p,renderOnly:true,light:{kind:'point',color:[1,.91,.75],intensity,range:8}});
 }
 minifig(id:string,p:Vec3,color:Color,hair:Color):Minifig {
  const [x,y,z]=p;
  // Readable as a tiny articulated toy at normal zoom. No cloth, IK or
  // per-person physics buffers are allocated.
  for(const side of [-1,1]){
   this.box(id+':leg:'+side,[x+side*.16,y+.26,z+.08],[.26,.44,.31],PAL.navy);
   this.box(id+':shoe:'+side,[x+side*.16,y+.075,z+.19],[.27,.13,.40],PAL.dark);
  }
  this.box(id+':hips',[x,y+.51,z],[.61,.18,.37],PAL.navy);
  this.box(id+':torso',[x,y+.83,z],[.72,.57,.39],color);
  this.box(id+':collar',[x,y+1.15,z],[.20,.06,.22],PAL.paper);
  this.cylinder(id+':neck',[x,y+1.17,z],.12,.12,PAL.skin);
  this.cylinder(id+':head',[x,y+1.40,z],.255,.40,PAL.skin,{},16);
  this.cylinder(id+':head-stud',[x,y+1.63,z],.145,.09,PAL.skin,{},12);
  this.cylinder(id+':hair',[x,y+1.62,z],.26,.14,hair,{},16);
  // Face orientation is toward the camera/front (+Z), not the monitor.
  this.box(id+':eye:left',[x-.095,y+1.45,z+.253],[.043,.070,.024],PAL.dark);
  this.box(id+':eye:right',[x+.095,y+1.45,z+.253],[.043,.070,.024],PAL.dark);
  this.box(id+':smile',[x,y+1.325,z+.255],[.13,.020,.022],PAL.brown);
  const armL=id+':arm:left',armR=id+':arm:right',handL=id+':hand:left',handR=id+':hand:right';
  this.cylinder(armL,[x-.46,y+.80,z],.112,.40,color,{},10);
  this.cylinder(armR,[x+.46,y+.80,z],.112,.40,color,{},10);
  this.cylinder(handL,[x-.46,y+.54,z+.045],.12,.13,PAL.skin,{},10);
  this.cylinder(handR,[x+.46,y+.54,z+.045],.12,.13,PAL.skin,{},10);
  return{armL,armR,handL,handR};
 }
}
const xs=(count:number,start:number,step:number)=>Array.from({length:count},(_,i)=>start+i*step);
function drawRoom(k:BrickKit):void{
 k.box('office:baseplate',[0,-.23,0],[18,.46,12],PAL.edge);
 k.box('office:floor',[0,.025,0],[17.1,.07,11.2],PAL.floor);
 k.studs('office:baseplate',.055,xs(24,-8.28,.72),xs(16,-5.32,.71),PAL.edge,true);
 // L-shaped cutaway. Both walls are light-colored and shallow, with visible brick courses.
 k.box('office:wall:back',[0,1.82,-5.50],[17.1,3.57,.23],PAL.sky);
 k.box('office:wall:left',[-8.48,1.80,0],[.22,3.55,11.2],PAL.paper);
 k.box('office:wall:back:trim',[0,3.62,-5.5],[17.15,.18,.28],PAL.yellow);
 k.box('office:wall:left:trim',[-8.48,3.62,0],[.29,.18,11.4],PAL.yellow);
 // Simple recognizable construction studs and brick-course seams.
 for(let i=0;i<22;i++)k.cylinder('office:wall:back:stud:'+i,[-8.05+i*.76,3.74,-5.5],.15,.07,PAL.yellow,{},8);
 for(let i=0;i<14;i++)k.cylinder('office:wall:left:stud:'+i,[-8.48,3.74,-5.1+i*.78],.15,.07,PAL.yellow,{},8);
 for(let row=1;row<6;row++){
  k.box('office:wall:back:course:'+row,[0,row*.58,-5.34],[16.9,.014,.014],PAL.white);
  k.box('office:wall:left:course:'+row,[-8.32,row*.58,0],[.014,.014,11],PAL.edge);
 }
 k.box('office:rug',[0,.066,1.35],[14.5,.04,4.1],PAL.sky);
 k.box('office:lounge:rug',[6.75,.081,4.05],[3.15,.05,2.45],PAL.lime);
 k.light('office:lamp:left',[-4.4,4.9,2.0],24);
 k.light('office:lamp:back',[3.5,4.6,-1.2],20);
}
function decorate(k:BrickKit):void{
 // Graph, idea, and sun posters: toy blocks rather than textured billboards.
 for(const [i,color] of [PAL.orange,PAL.blue,PAL.green].entries()){
  const x=-5.9+i*2.05;
  k.box('office:poster:'+i,[x,2.48,-5.30],[1.55,1.24,.085],color);
  if(i===0){k.cylinder('office:poster:sun',[x,2.48,-5.22],.27,.07,PAL.yellow,{},12);}
  if(i===1)for(let j=0;j<3;j++)k.box('office:poster:bar:'+j,[x-.40+j*.37,2.22+j*.12,-5.21],[.20,.31+j*.21,.05],PAL.white);
  if(i===2)k.cylinder('office:poster:idea',[x,2.52,-5.22],.22,.07,PAL.yellow,{},10);
 }
 k.box('office:board',[5.0,2.42,-5.30],[3.65,1.55,.08],PAL.paper);
 for(let i=0;i<8;i++)k.box('office:board:task:'+i,[3.63+(i%4)*.88,2.76-Math.floor(i/4)*.68,-5.23],
  [.45,.39,.04],[PAL.yellow,PAL.orange,PAL.sky,PAL.green][i%4]!);
 k.box('office:bookshelf',[-5.4,1.90,-5.0],[2.85,.12,.42],PAL.cream);
 for(let i=0;i<5;i++)k.box('office:book:'+i,[-6.35+i*.43,2.20,-5.0],[.22,.48+(i%3)*.10,.24],
  [PAL.orange,PAL.blue,PAL.yellow,PAL.green,PAL.red][i]!);
 k.plant('office:plant:back',[-7.2,.06,-4.1],1.25);
 k.plant('office:plant:right',[7.8,.06,-3.9],1.10);
 k.plant('office:plant:board',[1.0,.06,-3.9],.77);
 // Meeting space in the back, with no visual barrier across the whole office.
 k.box('office:meeting:top',[.7,.78,-3.10],[3.45,.16,1.20],PAL.cream);
 for(const xx of [-.55,1.95])for(const zz of [-3.52,-2.68])
  k.box('office:meeting:leg:'+xx+':'+zz,[xx,.37,zz],[.14,.65,.14],PAL.white);
 for(let i=0;i<3;i++){
  const xx=-.2+i*.93;
  k.box('office:meeting:chair:'+i,[xx,.41,-2.17],[.55,.15,.50],PAL.blue);
  k.box('office:meeting:back:'+i,[xx,.73,-1.98],[.55,.60,.13],PAL.blue);
 }
 k.plant('office:meeting:plant',[.7,.83,-3.1],.34);
 // Warm lounge: pale yellow sofa, rounded stools and one miniature plant.
 k.box('office:lounge:seat',[7.2,.43,4.0],[2.30,.43,.85],PAL.yellow);
 k.box('office:lounge:back',[7.2,.74,3.62],[2.30,.93,.24],PAL.yellow);
 for(const xx of [6.04,8.35])k.box('office:lounge:arm:'+xx,[xx,.64,4.0],[.23,.70,.93],PAL.orange);
 k.cylinder('office:lounge:table',[5.27,.40,4.10],.44,.17,PAL.paper,{},16);
 for(let i=0;i<2;i++)k.cylinder('office:lounge:pouf:'+i,[5.3+i*.9,.19,5.03],.28,.29,
  i===0?PAL.yellow:PAL.orange,{},12);
 k.plant('office:lounge:plant',[5.25,.48,4.1],.31);
}
function desk(k:BrickKit,i:number,p:Vec3):void{
 const [x,y,z]=p;
 const id='office:desk:'+i;
 k.box(id+':top',[x,y+.79,z],[2.55,.15,1.28],PAL.white);
 for(const dx of [-1.08,1.08])for(const dz of [-.48,.48])
  k.box(id+':leg:'+dx+':'+dz,[x+dx,y+.38,z+dz],[.13,.72,.13],PAL.white);
 k.box(id+':monitor',[x,y+1.30,z-.31],[1.04,.65,.11],PAL.dark,{roughness:.24});
 k.box(id+':screen',[x,y+1.31,z-.245],[.91,.52,.018],PAL.sky,{emissive:[.018,.035,.055],roughness:.18});
 k.box(id+':stand',[x,y+.94,z-.29],[.12,.18,.10],PAL.edge);
 k.box(id+':keyboard',[x,y+.88,z+.29],[.67,.035,.21],PAL.edge);
 k.cylinder(id+':mug',[x+.91,y+.94,z+.34],.11,.15,[PAL.orange,PAL.blue,PAL.green,PAL.yellow][i%4]!,{},12);
 k.cylinder(id+':mug:stud',[x+.91,y+1.03,z+.34],.078,.026,PAL.paper,{},10);
 k.box(id+':chair:seat',[x-.25,y+.49,z+.85],[.78,.17,.62],PAL.navy);
 k.box(id+':chair:back',[x-.25,y+.83,z+1.14],[.78,.70,.16],PAL.navy);
 k.studs(id+':desk',y+.905,[x-.98,x+.98],[z-.43,z+.43],PAL.white);
}
/** Same API as AgentOffice v1; the renderer, event contract and UI remain intact.
 * Color/pose is sampled only from actual facts at the requested time cursor. */
export class AgentOffice {
 readonly scene:Scene;
 readonly agents:readonly OfficeAgent[];
 readonly style=OFFICE_VISUAL_STYLE;
 private readonly actors:readonly OfficeActor[];
 private readonly lastPhases:OfficePhase[]=[];
 constructor(roster:readonly OfficeAgent[]){
  if(roster.length>8)throw new RangeError('Office MVP supports at most 8 visible agents');
  if(new Set(roster.map(a=>a.id)).size!==roster.length||roster.some(a=>!a.id||a.id.length>180||!a.name||a.name.length>120))
   throw new TypeError('Office agents require unique bounded IDs and names');
  this.agents=roster.map(a=>Object.freeze({...a}));
  const k=new BrickKit();drawRoom(k);decorate(k);
  const actors:OfficeActor[]=[];
  for(let i=0;i<roster.length;i++){
   const x=-5.45+(i%4)*3.65,z=i<4?1.16:-.90;
   const pos:Vec3=[x-.30,.08,z+1.12];
   desk(k,i,[x,0,z]);
   const fig=k.minifig('office:agent:'+i,pos,WARDROBE[i%WARDROBE.length]!,
     i%3===0?PAL.brown:i%3===1?PAL.dark:PAL.orange);
   const marker='office:status:'+i;
   k.box(marker,[x,1.72,z-.29],[.42,.15,.17],PAL.edge,{emissive:[.02,.02,.02]});
   actors.push({id:roster[i]!.id,position:pos,fig,marker});
  }
  const movable=new Set(actors.flatMap(a=>[a.marker,a.fig.armL,a.fig.armR,a.fig.handL,a.fig.handR]));
  const entities=batchStaticScenery(k.entities,e=>!!e.renderOnly&&!!e.mesh&&!movable.has(e.id),18);
  const spec:SceneSpec={
   version:1,seed:4327,ground:-.4,gravity:[0,-9.81,0],entities,
   clearColor:[.75,.85,.93,1],
   environment:{temperatureC:22,humidity:.36,wind:[0,0,0],sunlight:.82,groundMoisture:0,precipitation:'arid',snowfall:'none'},
   rendering:{sunDirection:[-.48,.77,.43],sunColor:[1,.95,.86],sunIntensity:1.45,
    skyColor:[.57,.73,.88],fogDensity:0,exposure:.92,shadowExtent:22},
   camera:{position:[12.6,10.3,13.7],target:[0,.70,0],fov:45},
  };
  this.scene=new Scene(spec);this.actors=actors;
  if(movable.size)this.scene.usePlugin({id:'office:toy-brick-projection',
   renderMovers:[...movable],
   modules:[{id:'office:projection-frame',phase:'simulate',rateHz:60,reads:[],writes:[],after:[],context:'none',run:()=>[]}],
  });
 }
 /** Stable camera anchor for semantic drill-down; this does not change any agent state. */
 agentPosition(id:string):Vec3|undefined{return this.actors.find(a=>a.id===id)?.position;}
 /** No physics tick or synthetic subagent activity is advanced by replay. */
 project(facts:readonly ActivityFact[],atMs:number):readonly OfficeAgentState[]{
  if(!Number.isFinite(atMs)||atMs<0)throw new RangeError('Office projection time must be nonnegative');
  const states=projectOfficeAgents(this.agents,facts,atMs);
  const patches:{id:string;set:{color:Color}}[]=[];
  for(let i=0;i<this.actors.length;i++){
   const a=this.actors[i]!,phase=states[i]!.phase;
   const [x,y,z]=a.position;
   const active=phase==='tool'||phase==='working',blocked=phase==='blocked',done=phase==='done';
   for(const [side,armId,handId] of [[-1,a.fig.armL,a.fig.handL],[1,a.fig.armR,a.fig.handR]] as const){
    const arm=this.scene.entities.get(armId)!,hand=this.scene.entities.get(handId)!;
    const raised=blocked||done&&side===1||phase==='tool'&&side===1;
    const angle=raised?(side===1?-.72:.72):active?(side===1?-.32:.32):0;
    arm.rotation.splice(0,3,0,0,angle);
    arm.position.splice(0,3,x+side*.46,y+.80+(raised?.13:0),z+(active?.08:0));
    hand.position.splice(0,3,x+side*(raised?.55:.46),y+(raised?.75:.54),z+(active?.17:.045));
    hand.rotation.splice(0,3,0,0,0);
   }
   if(this.lastPhases[i]!==phase){this.lastPhases[i]=phase;patches.push({id:a.marker,set:{color:PHASE_COLOR[phase]}});}
  }
  if(patches.length)this.scene.patchAppearance({materials:patches});
  return states;
 }
}
