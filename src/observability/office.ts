import {compileCharacter,characterSpec,CHARACTER_PRESETS,type CompiledCharacter} from '../characters/character.js';
import {sampleCharacterPose} from '../characters/pose.js';
import {bindHumanoid} from '../animation/locomotion.js';
import {Scene} from '../scene/scene.js';
import type {EntitySpec,SceneSpec,Color,MaterialSpec} from '../scene/types.js';
import type {Vec3} from '../math.js';
import type {ActivityFact} from './activity.js';

export type OfficePhase='offline'|'idle'|'working'|'tool'|'blocked'|'done';
export interface OfficeAgent {readonly id:string;readonly name:string}
export interface OfficeAgentState extends OfficeAgent {
  readonly phase:OfficePhase;
  readonly task?:string;
  readonly tool?:string;
  readonly lastFactId?:string;
  readonly atMs?:number;
  readonly tokens:number;
  readonly costUsd:number;
}
export function projectOfficeAgents(
  agents:readonly OfficeAgent[],facts:readonly ActivityFact[],asOfMs=Infinity,
):readonly OfficeAgentState[]{
  const state=new Map(agents.map(a=>[a.id,{...a,phase:'offline' as OfficePhase,tokens:0,costUsd:0} as OfficeAgentState]));
  const ordered=facts.filter(f=>f.atMs<=asOfMs).sort((a,b)=>a.atMs-b.atMs||(a.id<b.id?-1:a.id>b.id?1:0));
  for(const fact of ordered){
    if(fact.actor.domain!=='agent')continue;
    const before=state.get(fact.actor.id);
    if(!before)continue;
    let phase=before.phase,task=before.task,tool=before.tool;
    switch(fact.kind){
      case 'agent.started': phase='idle';task=undefined;tool=undefined;break;
      case 'agent.task.started': phase='working';task=fact.label??fact.target?.id??'Task';tool=undefined;break;
      case 'agent.tool.started': phase='tool';tool=fact.label??fact.target?.id??'Tool';break;
      case 'agent.tool.completed': phase=task?'working':'idle';tool=undefined;break;
      case 'agent.tool.failed': phase='blocked';tool=fact.label??tool;break;
      case 'agent.task.completed': phase='done';task=undefined;tool=undefined;break;
      case 'agent.task.failed': phase='blocked';tool=undefined;break;
      case 'agent.stopped': phase='offline';task=undefined;tool=undefined;break;
      default:break;
    }
    state.set(fact.actor.id,{id:before.id,name:before.name,phase,
      ...(task!==undefined?{task}:{}),...(tool!==undefined?{tool}:{}),
      lastFactId:fact.id,atMs:fact.atMs,
      tokens:before.tokens+(fact.usage?.tokens??0),
      costUsd:before.costUsd+(fact.usage?.costUsd??0)});
  }
  return Object.freeze([...state.values()].map(item=>Object.freeze(item)));
}
const INK:Color=[.115,.128,.14,1],STONE:Color=[.34,.35,.34,1],WARM:Color=[.57,.49,.39,1];
const statusPositions:Record<OfficePhase,number>={offline:0,idle:1,working:2,tool:3,blocked:4,done:5};
const statusColors:Record<OfficePhase,Color>={
  offline:[.28,.32,.34,1],idle:[.70,.60,.32,1],working:[.28,.72,.74,1],
  tool:[.37,.49,.82,1],blocked:[.86,.32,.25,1],done:[.38,.70,.37,1],
};
function seat(index:number):Vec3{return[-5.25+(index%4)*3.50,0,index<4?1.75:-2.35];}
type ActorRecord={readonly id:string;readonly character:CompiledCharacter;readonly seat:Vec3;readonly marker:string};
export class AgentOffice {
  readonly scene:Scene;
  private readonly actors:readonly ActorRecord[];
  private readonly lastPhases:OfficePhase[]=[];
  readonly agents:readonly OfficeAgent[];
  constructor(roster:readonly OfficeAgent[]){
    if(roster.length>8)throw new RangeError('Office MVP supports at most 8 visible agents');
    if(new Set(roster.map(a=>a.id)).size!==roster.length||roster.some(a=>!a.id||a.id.length>180||!a.name||a.name.length>120))
      throw new TypeError('Office agents require unique bounded IDs and names');
    this.agents=roster.map(a=>Object.freeze({...a}));
    const entities:EntitySpec[]=[];
    const add=(id:string,position:Vec3,size:Vec3,color:Color,extra:Partial<MaterialSpec>={})=>{
      entities.push({id,position,renderOnly:true,mesh:{kind:'box',size},
        material:{color,roughness:.78,...extra}});
    };
    const light=(id:string,position:Vec3,intensity:number,range:number,color:Vec3)=>{
      entities.push({id,position,renderOnly:true,light:{kind:'point',color,intensity,range}});
    };
    // Geometry is part of the normal Scene/Render IR, never a second 3D engine.
    add('office:floor',[0,-.13,0],[17,.25,13.4],[.23,.245,.245,1],{kind:'concrete',roughness:.95});
    add('office:inlay',[0,.012,0],[15.6,.02,11.6],[.28,.295,.29,1],{roughness:.91});
    add('office:rear-wall',[0,2.5,-6.55],[17,5.2,.2],[.39,.40,.395,1],{kind:'concrete'});
    add('office:left-wall',[-8.45,2.4,0],[.18,5,13.3],[.29,.30,.31,1],{kind:'concrete'});
    add('office:ceiling-beam',[0,4.8,-1.2],[16.5,.2,.28],INK,{metalness:.62});
    for(let i=0;i<5;i++){
      const x=-6.4+i*3.25;
      add('office:window:'+i,[x,2.65,-6.43],[2.44,2.8,.025],[.12,.19,.235,.68],{kind:'glass',roughness:.10,metalness:.12});
      add('office:window-sill:'+i,[x,1.22,-6.35],[2.65,.08,.20],INK,{metalness:.65});
      add('office:window-frame:'+i,[x,2.64,-6.36],[.05,2.88,.10],INK,{metalness:.7});
    }
    add('office:conference',[0,.72,-4.5],[4.3,.13,1.18],WARM,{roughness:.59});
    for(let j=0;j<4;j++){
      const x=-1.65+j*1.1;
      add('office:conference-leg:'+j,[x,.34,-4.5],[.07,.65,.07],INK,{metalness:.7});
    }
    add('office:machine-rack',[7.7,1.65,-4.4],[.65,3.2,1.55],INK,{metalness:.7,roughness:.25});
    for(let i=0;i<9;i++){
      add('office:rack-module:'+i,[7.30,.37+i*.31,-4.4],[.04,.20,1.25],[.15,.22,.21,1],{metalness:.55,roughness:.35});
    }
    for(let i=0;i<4;i++)light('office:area-light:'+i,[-6+i*4,4.15,0],22,8,[1,.91,.78]);
    const actors:ActorRecord[]=[];
    for(let i=0;i<roster.length;i++){
      const agent=roster[i]!,pos=seat(i);
      const preset=CHARACTER_PRESETS[i%CHARACTER_PRESETS.length]!.spec;
      const character=compileCharacter(characterSpec({...preset,id:'office-agent-'+i,seed:1421+i*941}));
      const shift:Vec3=[pos[0]-.46,0,pos[2]+.37];
      for(const entity of character.entities){
        const p=entity.position??[0,0,0];
        entities.push({...entity,position:[p[0]+shift[0],p[1],p[2]+shift[2]]});
      }
      add('office:desk:'+i,[pos[0]+.63,.72,pos[2]],[1.57,.095,1.56],WARM,{roughness:.63});
      for(const dx of [0,1.30])for(const dz of [-.64,.64])
        add('office:leg:'+i+':'+dx+':'+dz,[pos[0]+dx,.35,pos[2]+dz],[.055,.67,.055],INK,{metalness:.72});
      add('office:monitor:'+i,[pos[0]+1.03,1.16,pos[2]],[.055,.61,1.04],[.078,.105,.125,1],{metalness:.35,clearcoat:.22});
      add('office:screen:'+i,[pos[0]+.998,1.16,pos[2]],[.012,.50,.89],[.115,.24,.255,1],{emissive:[.035,.075,.085]});
      add('office:stand:'+i,[pos[0]+1.07,.84,pos[2]],[.085,.19,.07],INK,{metalness:.65});
      add('office:chair:'+i,[pos[0]-.33,.44,pos[2]],[.56,.10,.67],INK,{roughness:.78});
      add('office:chair-back:'+i,[pos[0]-.68,.82,pos[2]],[.14,.85,.69],INK,{roughness:.83});
      add('office:label:'+i,[pos[0]+.60,.785,pos[2]-.56],[.56,.012,.15],[.21,.215,.20,1],{label:String(i+1).padStart(2,'0'),labelColor:[.80,.76,.66]});
      const marker='office:status:'+i;
      entities.push({id:marker,renderOnly:true,
        position:[pos[0]+.22,.83,pos[2]+.67],
        mesh:{kind:'sphere',radius:.068,segments:12},
        material:{color:[.93,.72,.36,1],emissive:[.5,.22,.04]}});
      light('office:task-lamp:'+i,[pos[0]+.45,2.65,pos[2]],8,4,[.94,.82,.68]);
      actors.push({id:agent.id,character,seat:shift,marker});
    }
    const spec:SceneSpec={version:1,seed:4327,ground:-.25,gravity:[0,-9.81,0],
      clearColor:[.10,.115,.125,1],entities,
      environment:{temperatureC:21,humidity:.42,wind:[0,0,0],sunlight:.48,groundMoisture:0,precipitation:'arid',snowfall:'none'},
      rendering:{sunDirection:[-.5,.82,.4],sunColor:[1,.91,.8],sunIntensity:1.9,
        skyColor:[.27,.34,.39],fogDensity:0,exposure:1.0,shadowExtent:20},
      camera:{position:[13,11,17],target:[0,1.15,-.2],fov:49}};
    this.scene=new Scene(spec);
    this.actors=actors;
    if(actors.length)this.scene.usePlugin({
      id:'office:activity-projection',
      renderMovers:actors.flatMap(a=>[...a.character.entities.map(e=>e.id),a.marker]),
      modules:[{id:'office:projection-frame',phase:'simulate',rateHz:60,reads:[],writes:[],after:[],context:'none',run:()=>[]}],
    });
  }
  /** Sampling is reversible and independent of frame rate. No agent decision is inferred. */
  project(facts:readonly ActivityFact[],atMs:number):readonly OfficeAgentState[]{
    if(!Number.isFinite(atMs)||atMs<0)throw new RangeError('Office projection time must be nonnegative');
    const states=projectOfficeAgents(this.agents,facts,atMs);
    const materials:{id:string;set:{color:Color}}[]=[];
    for(let i=0;i<this.actors.length;i++){
      const a=this.actors[i]!,state=states[i]!;
      const pose=sampleCharacterPose(a.character.walker,
        state.phase==='tool'||state.phase==='working'?'reach':'idle',atMs/1000%3600);
      for(const binding of bindHumanoid(pose,a.character.walker.bindings??[])){
        const entity=this.scene.entities.get(binding.entity);
        if(!entity)throw new TypeError('Missing office projection entity: '+binding.entity);
        entity.position.splice(0,3,binding.position[0]+a.seat[0],binding.position[1]+a.seat[1],binding.position[2]+a.seat[2]);
        entity.rotation.splice(0,3,...binding.rotation);
        entity.scale.splice(0,3,...binding.scale);
      }
      const marker=this.scene.entities.get(a.marker)!;
      marker.position[0]=a.seat[0]+.68+statusPositions[state.phase]*.13;
      marker.position[1]=.83;
      marker.position[2]=a.seat[2]+.30;
      if(this.lastPhases[i]!==state.phase){
        this.lastPhases[i]=state.phase;
        materials.push({id:a.marker,set:{color:statusColors[state.phase]}});
      }
    }
    if(materials.length)this.scene.patchAppearance({materials});
    return states;
  }
}
