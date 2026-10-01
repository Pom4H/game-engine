import {projection,scalar,vector3,type Frame} from '../../network/projection.js';
import type {SequencedInput} from '../../network/input-replay.js';
import {characterState,stepCharacter,idleCharacterInput,type CharacterInput,type CharacterState,type CharacterTuning} from '../../runtime/character-motor.js';
import {CpuProfiler} from '../../core/profiling.js';
import {RuntimeTimeline} from '../../core/runtime-timeline.js';
import {OpenWorld,WORLD_REVISION,WORLD_LIMIT} from './world.js';
import {materializeCrowd} from './crowd.js';
export interface ThegameConfig extends CharacterTuning {readonly seed:number;readonly viewRadius:number;readonly exposure:number}
export function thegameConfig(raw:Partial<ThegameConfig>={}):Readonly<ThegameConfig>{
 const c={seed:29,walkSpeed:3.35,runSpeed:6.8,gravity:16,jumpSpeed:5.4,viewRadius:3,exposure:1,...raw};
 if(Object.keys(c).some(k=>!['seed','walkSpeed','runSpeed','gravity','jumpSpeed','viewRadius','exposure'].includes(k))||!Number.isSafeInteger(c.seed)||c.seed<0||c.seed>0xffffffff||!Number.isSafeInteger(c.viewRadius)||c.viewRadius<1||c.viewRadius>4)throw new RangeError('Invalid world seed or view radius');
 for(const [value,lo,hi] of [[c.walkSpeed,1,8],[c.runSpeed,c.walkSpeed,12],[c.gravity,4,30],[c.jumpSpeed,2,10],[c.exposure,.5,2]])if(!Number.isFinite(value)||value!<lo!||value!>hi!)throw new RangeError('Invalid traversal/presentation setting');
 return Object.freeze(c);
}
/** View-only settings may change without changing the shared world's identity. */
export const worldSignature=(c:ThegameConfig)=>JSON.stringify([WORLD_REVISION,c.seed,c.walkSpeed,c.runSpeed,c.gravity,c.jumpSpeed]);
export const LANDMARKS=Object.freeze([
 {id:'square',name:'Площадь',x:-256,z:-64},
 {id:'outskirts',name:'За городом',x:-512,z:120},
 {id:'forest',name:'Сосновый лес',x:-1000,z:120},
 {id:'ridge',name:'Горная гряда',x:-1200,z:-800},
 {id:'shore',name:'Побережье',x:800,z:80},
]);
export const peopleProjection=projection('thegame/people/1',{position:vector3('linear',-WORLD_LIMIT,WORLD_LIMIT),yaw:scalar('angle',-Math.PI*2,Math.PI*2),phase:scalar('angle',0,Math.PI*2000+1),speed:scalar('linear',0,40),kind:scalar('step',0,2)},{maxEntities:48,maxBytes:32_768});
export interface Peer {readonly id:string;readonly name:string;state:CharacterState;ack:number;received:number;readonly inputs:SequencedInput<CharacterInput>[];discovered:number;starved:number}
export interface SelfState {readonly ack:number;readonly state:CharacterState;readonly discovered:number}
export interface WorldSnapshot {readonly type:'state';readonly world:string;readonly frame:Frame;readonly self:SelfState;readonly players:number}
const object=(raw:unknown):Record<string,unknown>=>{if(!raw||typeof raw!=='object'||Array.isArray(raw))throw new TypeError('Expected object');return raw as Record<string,unknown>;};
const number=(n:unknown,min:number,max:number):n is number=>typeof n==='number'&&Number.isFinite(n)&&n>=min&&n<=max;
export function readCharacterInput(raw:unknown):CharacterInput{
 const r=object(raw);
 if(Object.keys(r).some(k=>!['forward','right','yaw','sprint','jump'].includes(k))||!number(r.forward,-1,1)||!number(r.right,-1,1)||!number(r.yaw,-Math.PI*2,Math.PI*2)||typeof r.sprint!=='boolean'||typeof r.jump!=='boolean')throw new TypeError('Only bounded controls are accepted; no position or dt');
 return {forward:r.forward,right:r.right,yaw:r.yaw,sprint:r.sprint,jump:r.jump};
}
export function readSelf(raw:unknown):SelfState{
 const self=object(raw),p=object(self.state);
 if(!Number.isSafeInteger(self.ack)||!number(self.ack,0,0x7fffffff)||!Number.isSafeInteger(self.discovered)||!number(self.discovered,0,31))throw new TypeError('Invalid acknowledgement');
 for(const key of ['x','y','z'])if(!number(p[key],-WORLD_LIMIT,WORLD_LIMIT))throw new TypeError('Invalid position');
 for(const key of ['vx','vy','vz','speed'])if(!number(p[key],-40,40))throw new TypeError('Invalid velocity');
 for(const key of ['yaw','lookYaw'])if(!number(p[key],-Math.PI*2,Math.PI*2))throw new TypeError('Invalid orientation');
 for(const key of ['coyote','jumpBuffer','landTime'])if(!number(p[key],0,1))throw new TypeError('Invalid motor clock');
 if(!number(p.phase,0,Math.PI*2000+1)||typeof p.grounded!=='boolean'||typeof p.jumpHeld!=='boolean')throw new TypeError('Invalid animation state');
 // Enumerate motor fields. Unexpected server properties never become executable state.
 const initial=characterState(p.x as number,p.y as number,p.z as number);
 for(const key of Object.keys(initial) as (keyof CharacterState)[])Object.assign(initial,{[key]:p[key]});
 return {ack:self.ack,state:initial,discovered:self.discovered};
}
/** Authoritative on-foot subset. Message handlers validate/enqueue; only step() moves actors.
 * Fixed 60 Hz, one input/peer/tick, independently bounded world, queues and publication. */
export class ThegameAuthority {
 readonly config:Readonly<ThegameConfig>;readonly world:OpenWorld;readonly peers=new Map<string,Peer>();readonly timeline:RuntimeTimeline;readonly profiler:CpuProfiler;
 tick=0;private sequence=0;readonly epoch:number;
 readonly stats={joins:0,leaves:0,inputs:0,rejected:0,published:0};
 constructor(config:Partial<ThegameConfig>={},epoch=1,profile=false){
  this.config=thegameConfig(config);if(!Number.isSafeInteger(epoch)||epoch<1)throw new RangeError('Invalid world epoch');this.epoch=epoch;
  this.world=new OpenWorld(this.config.seed);this.timeline=new RuntimeTimeline({enabled:profile,capacity:512});this.profiler=new CpuProfiler({enabled:profile,capacity:512,maxScopes:8,timeline:this.timeline});
 }
 join(id:string,name='Игрок',saved?:{state:CharacterState;discovered:number}):Peer{
  if(this.peers.size>=32||this.peers.has(id)||!/^p[0-9a-z]{1,16}$/.test(id))throw new RangeError('Room capacity or identity');
  const s=this.world.spawn(this.stats.joins%32),p=characterState(s.x,s.y,s.z,Math.PI/2);
  if(saved){const validated=readSelf({ack:0,state:saved.state,discovered:saved.discovered});if(!this.world.blocked(validated.state.x,validated.state.y,validated.state.z,1.8,.29))Object.assign(p,validated.state);}
  const peer:Peer={id,name:name.replace(/[\u0000-\u001f<>]/g,'').trim().slice(0,24)||'Игрок',state:p,ack:0,received:0,inputs:[],discovered:saved?.discovered??0,starved:0};
  this.peers.set(id,peer);this.stats.joins++;return peer;
 }
 leave(id:string):void{if(this.peers.delete(id))this.stats.leaves++;}
 enqueue(id:string,raw:unknown):void{
  const peer=this.peers.get(id);if(!peer)throw new Error('Unknown player');
  try{
   if(!Array.isArray(raw)||raw.length<1||raw.length>32)throw new RangeError('Input batch limit');
   let sequence=peer.received;const next:SequencedInput<CharacterInput>[]=[];
   for(const value of raw){const item=object(value);if(!Number.isSafeInteger(item.seq)||!number(item.seq,1,0x7fffffff))throw new TypeError('Input sequence');const input=readCharacterInput(item.input);if(item.seq<=peer.received)continue;if(item.seq!==sequence+1)throw new Error('Input sequence gap');sequence=item.seq;next.push({seq:sequence,input});}
   if(peer.inputs.length+next.length>120)throw new RangeError('Input queue limit');
   peer.inputs.push(...next);peer.received=sequence;this.stats.inputs+=next.length;
  }catch(error){this.stats.rejected++;throw error;}
 }
 step():void{if(this.profiler.enabled)this.profiler.measure('thegame:authority',()=>this.advance());else this.advance();}
 private advance():void{
  this.tick++;
  for(const peer of this.peers.values()){
   const command=peer.inputs.shift();
   // Missing controls cannot keep walking forever. Gravity/inertia still have real authority.
   stepCharacter(peer.state,command?.input??idleCharacterInput(peer.state.lookYaw),this.world,1/60,this.config);
   if(command){peer.ack=command.seq;peer.starved=0;}else peer.starved++;
   for(let i=0;i<LANDMARKS.length;i++){const point=LANDMARKS[i]!;if(Math.hypot(peer.state.x-point.x,peer.state.z-point.z)<8)peer.discovered|=1<<i;}
  }
 }
 snapshot(id:string,population:readonly Frame[]=[]):WorldSnapshot{
  const peer=this.peers.get(id);if(!peer)throw new Error('Unknown player');
  const rows:{id:string;data:{position:readonly [number,number,number];yaw:number;phase:number;speed:number;kind:number}}[]=[];
  for(const other of this.peers.values())if(other!==peer&&Math.hypot(other.state.x-peer.state.x,other.state.z-peer.state.z)<512){const p=other.state;rows.push({id:other.id,data:{position:[p.x,p.y,p.z],yaw:p.yaw,phase:p.phase,speed:p.speed,kind:0}});}
  const crowdBudget=Math.max(0,Math.min(24,peopleProjection.maxEntities-rows.length));
  rows.push(...materializeCrowd(this.world,population,peer.state,this.tick,crowdBudget));
  const frame=peopleProjection.capture({epoch:this.epoch,sequence:++this.sequence,tick:this.tick,time:this.tick/60,paused:false},rows);this.stats.published++;
  return {type:'state',world:worldSignature(this.config),frame,self:{ack:peer.ack,state:{...peer.state},discovered:peer.discovered},players:this.peers.size};
 }
 inspect(){return {tick:this.tick,players:this.peers.size,queued:[...this.peers.values()].reduce((n,p)=>n+p.inputs.length,0),world:this.world.inspect(),stats:{...this.stats},profile:this.profiler.inspect(),trace:this.timeline.diagnostics};}
 dispose():void{this.peers.clear();this.world.dispose();this.timeline.clear();}
}
