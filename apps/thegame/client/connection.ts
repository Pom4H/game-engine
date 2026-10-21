import {FixedClock} from '../../../src/core/fixed-clock.js';
import {InputReplay} from '../../../src/network/input-replay.js';
import {Replica} from '../../../src/network/playback.js';
import {characterState,idleCharacterInput,stepCharacter,type CharacterInput,type CharacterState} from '../../../src/runtime/character-motor.js';
import {BuildingWorld,readOfficeState} from '../building.js';
import {actorsProjection,vehiclesProjection,readBinding,DEFAULT_PORT,type Binding,type ConnectionStatus,type OfficeState,type WorldPacket,type WorldPresentation,type Self,type LiftState,type Weather,type Vec3} from '../shared.js';
import {WorldVoice,type VoiceStream,type VoiceSignal,type VoicePeer} from './voice.js';

export type GameConnectionOptions={url?:string;role:'observer'|'player';entry:'office'|'street';name?:string;/** Returned audio tracks are owned and stopped by the voice session. */audioSource?:()=>Promise<MediaStream>;onStatus?:(status:ConnectionStatus)=>void;onState?:(state:WorldPresentation)=>void;onVoiceStream?:(value:VoiceStream)=>void};
export type CommandResult={ok:boolean;error?:string};
type PendingCommand={resolve:(result:CommandResult)=>void;timer:ReturnType<typeof setTimeout>};
const object=(raw:unknown):Record<string,unknown>=>{if(!raw||typeof raw!=='object'||Array.isArray(raw))throw new TypeError('Expected server object');return raw as Record<string,unknown>;};
const integer=(raw:unknown):raw is number=>typeof raw==='number'&&Number.isSafeInteger(raw)&&raw>=0;
const finite=(raw:unknown,min=-1_000_000,max=1_000_000):raw is number=>typeof raw==='number'&&Number.isFinite(raw)&&raw>=min&&raw<=max;
const id=(raw:unknown):raw is string=>typeof raw==='string'&&raw.length>0&&raw.length<=160&&!['__proto__','constructor','prototype'].includes(raw);
const vector=(raw:unknown):raw is Vec3=>Array.isArray(raw)&&raw.length===3&&raw.every(value=>finite(value));
function readSelf(raw:unknown):Self{
 const value=object(raw),p=object(value.state);if(!id(value.id)||!integer(value.ack)||!vector(value.position)||!finite(value.yaw))throw new TypeError('Invalid authoritative self');
 for(const key of ['x','y','z','yaw','lookYaw','phase'] as const)if(!finite(p[key]))throw new TypeError('Invalid authoritative motor');
 for(const key of ['vx','vy','vz','speed'] as const)if(!finite(p[key],-100,100))throw new TypeError('Invalid authoritative velocity');
 for(const key of ['coyote','jumpBuffer','landTime'] as const)if(!finite(p[key],0,1))throw new TypeError('Invalid authoritative motor clock');
 if(typeof p.grounded!=='boolean'||typeof p.jumpHeld!=='boolean')throw new TypeError('Invalid authoritative motor flags');
 const state=characterState(p.x as number,p.y as number,p.z as number,p.yaw as number);for(const key of Object.keys(state) as (keyof CharacterState)[])Object.assign(state,{[key]:p[key]});
 if(value.position.some((position,index)=>position!==[state.x,state.y,state.z][index])||value.yaw!==state.yaw)throw new TypeError('Conflicting self pose');
 return{id:value.id,position:[...value.position] as Vec3,yaw:value.yaw,ack:value.ack,state};
}
function readLift(raw:unknown,binding:Binding):LiftState{
 const l=object(raw);if(!integer(l.floor)||!integer(l.target)||l.floor>=binding.floorCount||l.target>=binding.floorCount||!finite(l.elevation,0,binding.floorCount*binding.floorHeight)||!finite(l.door,0,1)||!finite(l.velocity,-20,20)||!['idle','closing','moving','opening'].includes(String(l.phase)))throw new TypeError('Invalid authoritative lift');
 return{floor:l.floor,target:l.target,elevation:l.elevation,door:l.door,velocity:l.velocity,phase:l.phase as LiftState['phase']};
}
function readWeather(raw:unknown):Weather{
 const w=object(raw);if(!finite(w.temperatureC,-100,100)||!finite(w.humidity,0,1)||!vector(w.wind)||!finite(w.sunlight,0,10)||!finite(w.groundMoisture,0,1)||!['arid','rare','occasional','frequent'].includes(String(w.precipitation))||!['none','light','moderate','heavy'].includes(String(w.snowfall))||!vector(w.sunDirection)||!finite(w.sunIntensity,0,100)||!vector(w.skyColor))throw new TypeError('Invalid authoritative weather');
 return{temperatureC:w.temperatureC,humidity:w.humidity,wind:[...w.wind] as Vec3,sunlight:w.sunlight,groundMoisture:w.groundMoisture,precipitation:w.precipitation as Weather['precipitation'],snowfall:w.snowfall as Weather['snowfall'],sunDirection:[...w.sunDirection] as Vec3,sunIntensity:w.sunIntensity,skyColor:[...w.skyColor] as Vec3};
}
const sameWorld=(a:Binding,b:Binding)=>a.worldId===b.worldId&&a.revision===b.revision&&a.epoch===b.epoch&&a.seed===b.seed&&a.buildingId===b.buildingId&&a.origin.every((value,index)=>value===b.origin[index])&&a.yaw===b.yaw&&a.floorHeight===b.floorHeight&&a.officeFloor===b.officeFloor;
const blend=(a:number,b:number,t:number)=>a+(b-a)*t;
const blendVector=(a:Vec3,b:Vec3,t:number):Vec3=>[blend(a[0],b[0],t),blend(a[1],b[1],t),blend(a[2],b[2],t)];

/** One socket carries bounded controls, executed commands and absolute world
 * causes. Remote actors/traffic are passive Engine Replica samples at one time;
 * only the controlled self uses the same canonical motor as the server. */
export class GameConnection {
 readonly url:string;
 private socket:WebSocket|null=null;private abort:AbortController|null=null;private generation=0;private disposed=false;private started=false;private welcomed=false;
 private retry:ReturnType<typeof setTimeout>|null=null;private connectionTimer:ReturnType<typeof setTimeout>|null=null;private ticker:ReturnType<typeof setInterval>|null=null;private attempts=0;
 private _status:ConnectionStatus={state:'closed',controlling:false,voice:false};private _binding:Binding|null=null;private _layout:OfficeState|null=null;private _layoutRevision=0;
 private world:BuildingWorld|null=null;private actors:Replica|null=null;private vehicles:Replica|null=null;private history:WorldPacket[]=[];private latest:WorldPacket|null=null;private lastPresentation:WorldPresentation|null=null;
 private replay:InputReplay<CharacterState,CharacterInput>|null=null;private serverSelf:Self|null=null;private actorId:string|null=null;private sequence=0;private sent=0;
 private held:CharacterInput=idleCharacterInput();private desiredControl:boolean;private clock=new FixedClock(1000/60,100,6);private lastWorldAt=0;
 private lastPingAt=0;private earlyRoster:{peers:VoicePeer[];selfId:string}|null=null;
 private pendingCommands=new Map<string,PendingCommand>();private pendingLayout:OfficeState|null=null;private voice:WorldVoice;
 constructor(private readonly options:GameConnectionOptions){
  if(!['observer','player'].includes(options.role)||!['office','street'].includes(options.entry))throw new TypeError('Invalid world entry');
  const hostname=typeof location==='undefined'?'localhost':location.hostname,protocol=typeof location!=='undefined'&&location.protocol==='https:'?'wss:':'ws:';
  const target=new URL(options.url??`${protocol}//${hostname}:${DEFAULT_PORT}/world`);if(!['ws:','wss:'].includes(target.protocol)||target.username||target.password)throw new TypeError('Invalid world socket URL');this.url=target.href;
  this.desiredControl=options.role==='player';
  this.voice=new WorldVoice({send:packet=>this.send(packet),...(options.audioSource?{audioSource:options.audioSource}:{}),onVoiceStream:value=>options.onVoiceStream?.(value),onPublishing:enabled=>this.statusUpdate({voice:enabled}),onError:message=>this.statusUpdate({message})});
 }
 get status():ConnectionStatus{return{...this._status};}
 get binding():Binding|null{return this._binding?structuredClone(this._binding):null;}
 get layout():OfficeState|null{return this._layout?structuredClone(this._layout):null;}
 get authoritativeSelf():Self|null{return this.serverSelf?structuredClone(this.serverSelf):null;}
 private statusUpdate(update:Partial<ConnectionStatus>){const next={...this._status,...update};if(JSON.stringify(next)===JSON.stringify(this._status))return;this._status=next;this.options.onStatus?.({...next});}
 connect():void{
  if(this.disposed)throw new Error('Соединение завершено.');this.started=true;if(this.socket||this.abort)return;
  if(this.retry){clearTimeout(this.retry);this.retry=null;}
  if(!this.ticker)this.ticker=setInterval(()=>this.pump(),1000/60);
  const generation=++this.generation;this.welcomed=false;this.clock.reset(performance.now());this.statusUpdate({state:'connecting',controlling:false,voice:false,message:'Подключаемся к игровому серверу…'});
  const abort=new AbortController();this.abort=abort;
  this.connectionTimer=setTimeout(()=>{if(generation===this.generation)this.failed('Игровой сервер не ответил.',true);},8000);
  const session=new URL('/api/session',this.url);session.protocol=session.protocol==='wss:'?'https:':'http:';
  void fetch(session,{credentials:'include',signal:abort.signal}).then(response=>{
   if(!response.ok)throw new Error(`Игровой сервер: ${response.status}`);if(generation!==this.generation||this.disposed)return;
   this.abort=null;const socket=new WebSocket(this.url);this.socket=socket;
   socket.onopen=()=>{if(this.socket===socket&&generation===this.generation)this.send({type:'hello',role:this.options.role,entry:this.options.entry,name:(this.options.name??'Игрок').slice(0,24)},true);};
   socket.onmessage=event=>{if(this.socket!==socket||generation!==this.generation)return;try{if(typeof event.data!=='string'||event.data.length>524_288)throw new RangeError('Server packet limit');this.receive(JSON.parse(event.data));}catch(error){this.failed(`Ошибка данных мира: ${String((error as Error).message??error)}`,true);}};
   socket.onerror=()=>{if(this.socket===socket&&generation===this.generation)this.failed('Игровой сервер недоступен.',true);};
   socket.onclose=()=>{if(this.socket===socket&&generation===this.generation)this.failed('Связь с игровым сервером потеряна.');};
  }).catch(error=>{if(generation===this.generation&&!this.disposed)this.failed(String((error as Error).message??error),true);});
 }
 private send(packet:unknown,initial=false):boolean{
  const socket=this.socket;if(!socket||socket.readyState!==WebSocket.OPEN||!initial&&!this.welcomed||socket.bufferedAmount>65_536)return false;
  const text=JSON.stringify(packet);if(text.length>524_288)return false;try{socket.send(text);return true;}catch{return false;}
 }
 private receive(raw:unknown){
  const packet=object(raw);
  if(packet.type==='control'){
   if(typeof packet.controlling!=='boolean'||!integer(packet.inputSequence)||packet.actorId!==undefined&&!id(packet.actorId))throw new TypeError('Invalid control response');
   if(!this.welcomed)return;
   this.sequence=packet.inputSequence;this.sent=packet.inputSequence;this.actorId=packet.controlling&&id(packet.actorId)?packet.actorId:null;
   if(packet.controlling&&this.serverSelf&&this.serverSelf.id===this.actorId)this.ensureReplay(this.serverSelf,packet.inputSequence);
   else{this.replay=null;if(!packet.controlling){this.serverSelf=null;this.held=idleCharacterInput(this.held.yaw);this.voice.permission(false);}}
   this.clock.reset(performance.now());this.statusUpdate({controlling:packet.controlling});return;
  }
  if(packet.type==='voice'){if(typeof packet.enabled!=='boolean')throw new TypeError('Invalid voice permission');this.voice.permission(packet.enabled);return;}
  if(packet.type==='pong')return;
  if(packet.type==='error'){const message=typeof packet.message==='string'?packet.message:packet.error;if(typeof message==='string')this.statusUpdate({message:message.slice(0,1000)});return;}
  if(packet.type==='voice-peers'&&!this.welcomed){this.earlyRoster={peers:packet.peers as VoicePeer[],selfId:packet.selfId as string};return;}
  if(packet.type==='welcome'){
   const binding=readBinding(packet.binding);if(typeof binding.worldId!=='string'||!binding.worldId||!Number.isInteger(binding.floorCount)||typeof packet.controlling!=='boolean'||!integer(packet.inputSequence)||packet.actorId!==undefined&&!id(packet.actorId))throw new TypeError('Invalid welcome');
   const reset=!this.welcomed||!this._binding||!sameWorld(this._binding,binding);this._binding=binding;
   if(reset){this.world=new BuildingWorld(binding.seed,binding.epoch);Object.assign(this.world.binding,binding);this.actors=new Replica(actorsProjection,binding.epoch,64,1_000_000,.1);this.vehicles=new Replica(vehiclesProjection,binding.epoch,64,256_000,.1);this.history=[];this.latest=null;this.serverSelf=null;this.replay=null;this._layout=null;this._layoutRevision=0;this.voice.reset();}
   else if(this.world)Object.assign(this.world.binding,binding);
   if(packet.layout!==undefined)this.applyLayout(packet.layout,integer(packet.layoutRevision)?packet.layoutRevision:0);
   this.sequence=packet.inputSequence;this.sent=packet.inputSequence;this.actorId=packet.controlling&&id(packet.actorId)?packet.actorId:null;
   if(!packet.controlling){this.replay=null;this.serverSelf=null;this.held=idleCharacterInput(this.held.yaw);}
   else if(this.serverSelf){this.ensureReplay(this.serverSelf,packet.inputSequence);}
   this.welcomed=true;this.lastWorldAt=this.lastPingAt=performance.now()/1000;this.attempts=0;this.clock.reset(performance.now());if(this.connectionTimer){clearTimeout(this.connectionTimer);this.connectionTimer=null;}
   this.statusUpdate({state:'connected',controlling:packet.controlling,message:packet.controlling?'Ты в общем мире.':'Общий мир подключён.'});
   if(this.earlyRoster){const roster=this.earlyRoster;this.earlyRoster=null;this.voice.setRoster(roster.peers,roster.selfId);}
   if(this.desiredControl!==packet.controlling)this.send({type:'control',enabled:this.desiredControl});this.flushLayout();return;
  }
  if(!this.welcomed||!this._binding)throw new TypeError('Welcome required');
  if(packet.type==='world'){this.receiveWorld(packet);return;}
  if(packet.type==='layout'){if(!integer(packet.layoutRevision))throw new TypeError('Invalid layout revision');if(packet.layoutRevision>=this._layoutRevision)this.applyLayout(packet.layout,packet.layoutRevision);return;}
  if(packet.type==='command'){
   if(!id(packet.commandId)||typeof packet.ok!=='boolean'||packet.error!==undefined&&(typeof packet.error!=='string'||packet.error.length>1000))throw new TypeError('Invalid command result');
   const pending=this.pendingCommands.get(packet.commandId);if(pending){clearTimeout(pending.timer);this.pendingCommands.delete(packet.commandId);pending.resolve({ok:packet.ok,...(typeof packet.error==='string'?{error:packet.error}:{})});}return;
  }
  if(packet.type==='voice-peers'){this.voice.setRoster(packet.peers as VoicePeer[],packet.selfId as string);return;}
  if(packet.type==='signal'){if(!id(packet.from)||!id(packet.actorId))throw new TypeError('Invalid signal identity');this.voice.receiveSignal(packet.from,packet.actorId,packet.value as VoiceSignal);return;}
  throw new TypeError('Unknown server packet');
 }
 private applyLayout(raw:unknown,revision:number){
  if(raw===null){this._layout=null;this._layoutRevision=revision;if(this.world){this.world.layout=null;this.world.floorLayouts.clear();this.world.officeObstacles.clear();}return;}
  const state=readOfficeState(raw);this.world?.setLayout(state);if(this.world&&this._binding)Object.assign(this.world.binding,this._binding);
  this._layout=state;this._layoutRevision=revision;
  if(this.replay&&this.serverSelf)this.replay.correct(this.serverSelf.ack,this.serverSelf.state);
 }
 private receiveWorld(raw:Record<string,unknown>){
  const binding=readBinding(raw.binding);if(!this._binding||!sameWorld(this._binding,binding)||!integer(raw.tick)||!finite(raw.time,0,Number.MAX_VALUE)||!finite(raw.worldMinute,0,Number.MAX_VALUE)||!integer(raw.layoutRevision))throw new TypeError('World cause mismatch');
  if(this.latest&&raw.tick<=this.latest.tick)return;
  const actors=actorsProjection.read(raw.actors),vehicles=vehiclesProjection.read(raw.vehicles);
  for(const frame of [actors,vehicles])if(frame.epoch!==binding.epoch||frame.tick!==raw.tick||frame.time!==raw.time)throw new TypeError('Conflicting projection clocks');
  if(actors.sequence<=(this.actors?.latest()?.sequence??-1)||vehicles.sequence<=(this.vehicles?.latest()?.sequence??-1))return;
  if(!Array.isArray(raw.names)||raw.names.length>96)throw new TypeError('Invalid actor names');const seen=new Set<string>();
  const names=raw.names.map(value=>{const n=object(value);if(!id(n.id)||!id(n.residentId)||typeof n.name!=='string'||n.name.length>80||seen.has(n.id))throw new TypeError('Invalid actor identity');seen.add(n.id);return{id:n.id,residentId:n.residentId,name:n.name};});
  const self=raw.self===undefined?undefined:readSelf(raw.self);if(self&&this.actorId&&self.id!==this.actorId)throw new TypeError('Controlled actor identity changed');
  const packet:WorldPacket={type:'world',binding,tick:raw.tick,time:raw.time,worldMinute:raw.worldMinute,actors,vehicles,names,lift:readLift(raw.lift,binding),weather:readWeather(raw.weather),layoutRevision:raw.layoutRevision,...(self?{self}:{})};
  const at=performance.now()/1000;this.actors!.receive(actors,at);this.vehicles!.receive(vehicles,at);this._binding=binding;Object.assign(this.world!.binding,binding);Object.assign(this.world!.lift,packet.lift);
  this.latest=packet;this.history.push(packet);if(this.history.length>64)this.history.shift();this.lastWorldAt=at;
  if(self){this.serverSelf=self;this.actorId=self.id;if(!this.replay)this.ensureReplay(self,this.sequence);else if(!this.replay.correct(self.ack,self.state))throw new TypeError('Execution ACK outside replay window');}
  else if(this._status.controlling){this.replay=null;this.serverSelf=null;this.actorId=null;this.held=idleCharacterInput();void this.voice.publish(false);this.statusUpdate({controlling:false});}
 }
 private ensureReplay(self:Self,sequence:number){
  this.replay=new InputReplay(self.state,state=>({...state}),(state,input)=>{const world=this.world;if(world&&!(world.lift.phase==='moving'&&world.inCabin(state)))stepCharacter(state,input,world,1/60);},120);
  this.replay.reset(self.state,Math.max(sequence,self.ack));this.sent=this.replay.latestSequence;
 }
 private pump(){
  if(this.disposed||!this.welcomed)return;const now=performance.now(),seconds=now/1000;
  if(seconds-this.lastWorldAt>2){this.failed('Сервер перестал присылать состояние мира.');return;}
  if(seconds-this.lastPingAt>=4&&this.send({type:'ping'}))this.lastPingAt=seconds;
  if(this._status.state!=='connected'||!this._status.controlling||!this.replay){this.clock.reset(now);this.flushLayout();return;}
  this.clock.advance(now,()=>{if(this.replay&&!this.replay.push({...this.held}))this.failed('Очередь управления заполнена. Переподключаемся.');});
  if(!this.welcomed)return;
  if((this.socket?.bufferedAmount??Infinity)<4096){const items=this.replay?.after(this.sent)??[];if(items.length&&this.send({type:'input',items}))this.sent=items.at(-1)!.seq;}
  this.flushLayout();
 }
 present(nowSeconds=performance.now()/1000):WorldPresentation|null{
  if(!Number.isFinite(nowSeconds))throw new RangeError('Invalid presentation clock');
  if(!this.latest||!this.actors||!this.vehicles||!this._binding){if(this.lastPresentation){const held={...this.lastPresentation,connected:false};this.options.onState?.(held);return held;}return null;}
  const sample=this.actors.present(nowSeconds),traffic=this.vehicles.at(sample.time);let a=this.history[0]!,b=a;
  for(const cause of this.history){if(cause.time<=sample.time)a=cause;else{b=cause;break;}b=cause;}
  const alpha=b.time>a.time?Math.max(0,Math.min(1,(sample.time-a.time)/(b.time-a.time))):0,names=new Map(a.names.map(value=>[value.id,value]));
  const actors=sample.rows.map(row=>{const v=row.values,n=names.get(row.id);return{id:row.id,residentId:n?.residentId??row.id,name:n?.name??'Житель',position:[v[0]!,v[1]!,v[2]!] as Vec3,yaw:v[3]!,phase:v[4]!,speed:v[5]!,kind:v[6]!};});
  const connected=this._status.state==='connected'&&this.welcomed&&performance.now()/1000-this.lastWorldAt<=2;
  let self:Self|undefined;
  if(this.serverSelf){
   const actor=actors.find(value=>value.id===this.serverSelf!.id),riding=actor&&this.world?.inCabin(this.serverSelf.state);
   // The cabin is server-driven, not a second local simulation. Its passenger and
   // floor must use the same delayed cause even for the controlled first-person view.
   const p=riding?{...this.serverSelf.state,x:actor.position[0],y:actor.position[1],z:actor.position[2],yaw:actor.yaw,phase:actor.phase,speed:actor.speed}:connected&&this._status.controlling&&this.replay?this.replay.state:this.serverSelf.state;
   self={id:this.serverSelf.id,ack:this.serverSelf.ack,state:{...p},position:[p.x,p.y,p.z],yaw:p.yaw};
   if(actor&&connected&&this._status.controlling&&!riding){actor.position=[p.x,p.y,p.z];actor.yaw=p.yaw;actor.phase=p.phase;actor.speed=p.speed;}
  }
  const weather:Weather={...a.weather,temperatureC:blend(a.weather.temperatureC,b.weather.temperatureC,alpha),humidity:blend(a.weather.humidity,b.weather.humidity,alpha),wind:blendVector(a.weather.wind,b.weather.wind,alpha),sunlight:blend(a.weather.sunlight,b.weather.sunlight,alpha),groundMoisture:blend(a.weather.groundMoisture,b.weather.groundMoisture,alpha),sunDirection:blendVector(a.weather.sunDirection,b.weather.sunDirection,alpha),sunIntensity:blend(a.weather.sunIntensity,b.weather.sunIntensity,alpha),skyColor:blendVector(a.weather.skyColor,b.weather.skyColor,alpha)};
  const result:WorldPresentation={binding:structuredClone(this._binding),tick:a.tick,time:sample.time,worldMinute:blend(a.worldMinute,b.worldMinute,alpha),actors,vehicles:traffic.rows.map(row=>{const v=row.values;return{id:row.id,position:[v[0]!,v[1]!,v[2]!] as Vec3,yaw:v[3]!,speed:v[4]!,mode:v[5]!,doors:v[6]!};}),lift:{...a.lift,elevation:blend(a.lift.elevation,b.lift.elevation,alpha),door:blend(a.lift.door,b.lift.door,alpha)},weather,connected,layoutRevision:this.latest.layoutRevision,...(self?{self}:{}),...(this._layout?{layout:this._layout}:{})};
  this.lastPresentation=result;this.options.onState?.(result);return result;
 }
 control(enabled:boolean):void{
  this.desiredControl=!!enabled;if(!enabled){this.held=idleCharacterInput(this.held.yaw);this.statusUpdate({controlling:false});void this.voice.publish(false);}
  this.send({type:'control',enabled:!!enabled});
 }
 input(input:CharacterInput):void{if(!input||!finite(input.forward,-1,1)||!finite(input.right,-1,1)||!finite(input.yaw,-Math.PI*2000,Math.PI*2000)||typeof input.sprint!=='boolean'||typeof input.jump!=='boolean')throw new TypeError('Invalid bounded character input');this.held={forward:input.forward,right:input.right,yaw:input.yaw,sprint:input.sprint,jump:input.jump};}
 lift(floor:number):Promise<CommandResult>{
  if(!this._binding||!Number.isInteger(floor)||floor<0||floor>=this._binding.floorCount)return Promise.resolve({ok:false,error:'Этаж недоступен.'});
  if(!this.welcomed||!this._status.controlling)return Promise.resolve({ok:false,error:'Войди в общий мир, чтобы пользоваться лифтом.'});
  if(this.pendingCommands.size>=16)return Promise.resolve({ok:false,error:'Дождись выполнения команд лифта.'});
  const commandId=crypto.randomUUID();
  return new Promise(resolve=>{const timer=setTimeout(()=>{this.pendingCommands.delete(commandId);resolve({ok:false,error:'Сервер не подтвердил команду лифта.'});},8000);this.pendingCommands.set(commandId,{resolve,timer});if(!this.send({type:'lift',floor,commandId})){clearTimeout(timer);this.pendingCommands.delete(commandId);resolve({ok:false,error:'Нет связи с лифтом.'});}});
 }
 /** Solids supplied by older Office callers are deliberately ignored. The host
  * validates state and compiles the same canonical Office layout on its tick. */
 setLayout(state:OfficeState,_solids?:unknown,_obstacles?:unknown):void{this.pendingLayout=readOfficeState(state);this.flushLayout();}
 private flushLayout(){if(this.pendingLayout&&this.send({type:'layout',state:this.pendingLayout}))this.pendingLayout=null;}
 async publishVoice(enabled:boolean):Promise<void>{if(this.disposed){if(!enabled)return;throw new Error('Соединение завершено.');}if(enabled&&(!this.welcomed||!this._status.controlling))throw new Error('Сначала войди в общий мир.');await this.voice.publish(enabled);}
 private failed(message:string,error=false){
  if(this.disposed)return;this.generation++;this.abort?.abort();this.abort=null;const socket=this.socket;this.socket=null;if(socket){socket.onopen=null;socket.onmessage=null;socket.onerror=null;socket.onclose=null;socket.close();}
  this.welcomed=false;this.earlyRoster=null;this.held=idleCharacterInput(this.held.yaw);this.replay=null;this.voice.reset();if(this.connectionTimer){clearTimeout(this.connectionTimer);this.connectionTimer=null;}
  for(const pending of this.pendingCommands.values()){clearTimeout(pending.timer);pending.resolve({ok:false,error:message});}this.pendingCommands.clear();this.statusUpdate({state:error?'error':'closed',controlling:false,voice:false,message});
  if(this.started&&!this.retry)this.retry=setTimeout(()=>{this.retry=null;this.connect();},Math.min(10_000,500*2**Math.min(5,this.attempts++)));
 }
 inspect(){return{status:this.status,binding:this.binding,actorId:this.actorId,authoritativeSelf:this.authoritativeSelf,pendingInputs:this.replay?.pending??0,sequence:this.replay?.latestSequence??this.sequence,ack:this.replay?.ack??this.serverSelf?.ack??0,pendingCommands:this.pendingCommands.size,backpressure:this.socket?.bufferedAmount??0,actors:this.actors?.inspect(),vehicles:this.vehicles?.inspect(),layoutRevision:this._layoutRevision};}
 dispose():void{
  if(this.disposed)return;this.started=false;this.failed('Соединение завершено.');this.disposed=true;
  if(this.retry){clearTimeout(this.retry);this.retry=null;}if(this.ticker){clearInterval(this.ticker);this.ticker=null;}this.voice.dispose();this.pendingLayout=null;
 }
}
