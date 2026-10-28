import {validHydrologyFrame} from '../../../src/environment/hydrology-frame.js';
import {readCanonicalAudio,sampleCanonicalAudio,type CanonicalAudioFactory,type CanonicalAudioHost} from './canonical-audio.js';
import {characterState} from '../../../src/runtime/character-motor.js';
import {WorldVoice} from '../../../src/network/world-voice.js';
import {FixedClock} from '../../../src/core/fixed-clock.js';
import type {CanonicalFrame,CanonicalEntity} from './canonical-types.js';
import type {CanonicalActorsFactory} from './canonical-actors.js';
import type {CanonicalUrbanFactory} from './canonical-urban.js';
import type {CanonicalSceneryFactory} from './canonical-scenery.js';
import type {CanonicalRoadFactory} from './canonical-roads.js';
import type {CanonicalTerrainFactory} from './canonical-terrain.js';
import type {CanonicalLightingSource} from './canonical-lighting.js';
import {readCanonicalTireMarks,type CanonicalSurfaceFactory} from './canonical-surface-effects.js';
import type {CanonicalLiftFactory,CanonicalLiftView} from './canonical-lifts.js';
import type {AccountView,ActorControlCommand} from '../../../../thegame/src/game/account-model.ts';
import type {ResidentSnapshot} from '../../../../thegame/src/game/resident-model.ts';
import type {FlightInstruments} from '../../../../thegame/src/game/flight/instrument-model.ts';
import type {ResidentDirectoryQuery,ResidentDirectoryPage} from '../../../../thegame/src/game/resident-model.ts';
import {CANONICAL_CONTROL_KEYS,type CanonicalKeyboard,type CanonicalControlInput,type CanonicalControlSampler,type CanonicalControlCamera} from './canonical-controls.js';
import type {CharacterInput,ConnectionStatus,OfficeState,Bounds,WorldPresentation,Vec3} from '../shared.js';

type ControlInput=CanonicalControlInput;
type ControlNetwork={status:string;pending?:readonly unknown[];backpressured?:boolean;residentId:string|null;snapshot:{self:{id:string;x:number;y:number;z:number;yaw:number;seat?:string|null;seatRole?:string|null;controlRevision?:number};ack:number|null;account?:AccountView;residents?:ResidentSnapshot;entities?:CanonicalEntity[];instruments?:{vehicleId:string;powered?:boolean;flight?:Partial<FlightInstruments>}}|null;onReceipt:(receipt:{id?:number;status:string;result:unknown;tick?:number},command:{kind:string;value?:unknown})=>void;connect(config:unknown,origin:string):Promise<void>;close():void;send(input:ControlInput):unknown;lift(value:{buildingId:string;floor:number}):boolean;liftRequest?(value:{buildingId:string;floor:number}):number|null;actorRequest(value:ActorControlCommand):number|null;present(now:number):{tick:number;time:number;entities:CanonicalEntity[];audio?:CanonicalFrame['audio'];tireMarks?:CanonicalFrame['tireMarks'];lifts?:CanonicalFrame['lifts']};inspect?():unknown};
type ControlLibrary={GameNetwork:new()=>ControlNetwork;idleInput:()=>ControlInput;createOfficeActors?:CanonicalActorsFactory;createOfficeUrban?:CanonicalUrbanFactory;createOfficeScenery?:CanonicalSceneryFactory;createOfficeRoads?:CanonicalRoadFactory;createOfficeTerrain?:CanonicalTerrainFactory;officeLightingSource?:CanonicalLightingSource;createOfficeSurfaceEffects?:CanonicalSurfaceFactory;createOfficeAudio?:CanonicalAudioFactory;createOfficeLiftView?:CanonicalLiftFactory;GameControlSampler?:new()=>CanonicalControlSampler;GameControlCamera?:new()=>CanonicalControlCamera;isAircraftType?:(type:string)=>boolean};
export type CanonicalConnectionOptions={url?:string;loadController?:()=>Promise<ControlLibrary>;/** Returned audio tracks are owned by WorldVoice. */audioSource?:()=>Promise<MediaStream>;onStatus?:(status:ConnectionStatus)=>void;onState?:(state:WorldPresentation)=>void;onLook?:(view:{yaw:number;pitch:number})=>void;onVoiceStream?:(value:{actorId:string;stream:MediaStream|null})=>void};
const finite=(x:unknown):x is number=>typeof x==='number'&&Number.isFinite(x);
const vector=(x:unknown):x is Vec3=>Array.isArray(x)&&x.length===3&&x.every(finite);
/** Versioned adapter for the existing GameAuthority; it never generates a second world. */
export function readCanonicalFrame(value:unknown):CanonicalFrame{
 const f=value as CanonicalFrame,b=f?.binding;
 if(f?.source!=='thegame'||f.schema!=='thegame-office/1'||!Number.isSafeInteger(f.seed)||!Number.isSafeInteger(f.revision)||!Number.isSafeInteger(f.tick)||!finite(f.time)||!finite(f.worldMinute)||!b||!vector(b.origin)||!finite(b.yaw)||!finite(b.width)||b.width<=0||!finite(b.depth)||b.depth<=0||!finite(b.floorHeight)||b.floorHeight<=0||!Number.isInteger(b.floorCount)||b.floorCount<1||b.floorCount>64||!Number.isInteger(b.officeFloor)||b.officeFloor<0||b.officeFloor>=b.floorCount||typeof b.buildingId!=='string'||typeof b.worldId!=='string'||!Array.isArray(f.entities)||f.entities.length>150||!Array.isArray(f.lifts)||f.lifts.length>8||!f.environment||!f.weather||!f.air)throw new TypeError('Несовместимый мир The Game');
 if(f.tick<0||f.tick>0xffffffff||f.time<0||f.worldMinute<0)throw new TypeError('Некорректные часы мира The Game');
 if(f.view!==undefined&&(!f.view||!['office','controller'].includes(f.view.kind)||!vector(f.view.center)||typeof f.view.geometryKey!=='string'||!f.view.geometryKey||f.view.geometryKey.length>2048||f.geometry&&f.geometry.key!==f.view.geometryKey))throw new TypeError('Некорректная область мира The Game');
 const ids=new Set<string>();for(const e of f.entities){if(typeof e.id!=='string'||!e.id||ids.has(e.id)||!['player','pedestrian','vehicle','ragdoll'].includes(e.kind)||![e.x,e.y,e.z,e.yaw,e.vx,e.vy,e.vz,e.phase].every(finite))throw new TypeError('Некорректная модель мира The Game');ids.add(e.id);}
 if(!Number.isSafeInteger(f.epoch)||f.epoch<1||b.epoch!==f.epoch||!b.worldId||b.worldId.length>160||!b.buildingId||b.buildingId.length>160||![f.air.temperatureC,...f.air.wind,f.weather.rain,f.weather.humidity,f.weather.wetness,f.environment.sunAzimuth,...Object.values(f.environment.visual)].every(finite)||!f.humanoidStyles||!f.vehicleSpecs)throw new TypeError('Некорректное состояние мира The Game');
 const snow=f.environment.snow;if(snow!==undefined&&(!finite(snow)||snow<0||snow>1))throw new TypeError('Некорректные осадки мира The Game');
 const snowSince=f.environment.snowSinceMinute;if(snowSince!==undefined&&(!finite(snowSince)||snowSince<0))throw new TypeError('Некорректная история снега The Game');
 const c=f.environment.celestial;if(c&&(!['sun','moon'].includes(c.body)||![c.azimuth,c.elevation,c.intensity].every(finite)||c.intensity<0||!vector(c.color)||c.color.some(n=>n<0)))throw new TypeError('Некорректное освещение мира The Game');
 if(b.layoutStatus==='bound'){const p=b.placement;if(!Number.isSafeInteger(b.geometryRevision)||b.geometryRevision!<1||!p||p.worldId!==b.worldId||p.buildingId!==b.buildingId||![p.width,p.depth,p.offsetZ,p.floorHeight,p.firstFloor].every(finite)||p.width<=0||p.width>b.width||p.depth<=0||p.depth>b.depth||!Array.isArray(p.floors)||!p.floors.length||p.floors.length>12||p.firstFloor<1||p.firstFloor+p.floors.length>b.floorCount)throw new TypeError('Некорректное размещение Office');}
 for(const l of f.lifts)if(typeof l.id!=='string'||![l.floor,l.target,l.elevation,l.door,l.velocity].every(finite)||!Number.isInteger(l.floor)||l.floor<0||l.floor>63||!Number.isInteger(l.target)||l.target<0||l.target>63||l.door<0||l.door>1||!['idle','closing','moving','opening'].includes(l.phase))throw new TypeError('Некорректное состояние лифта The Game');
 if(f.hydrology!==undefined&&!validHydrologyFrame(f.hydrology))throw TypeError("Invalid hydrology frame");readCanonicalTireMarks(f.tireMarks);readCanonicalAudio(f.audio,f.entities);return f;
}
const angle=(a:number,b:number,t:number)=>a+Math.atan2(Math.sin(b-a),Math.cos(b-a))*t;
export function sampleCanonicalFrames(a:CanonicalFrame,b:CanonicalFrame,time:number):CanonicalFrame{
 if(!finite(time)||!finite(a.time)||!finite(b.time)||a.epoch!==b.epoch||a.seed!==b.seed||a.revision!==b.revision||a.binding.worldId!==b.binding.worldId||a.binding.buildingId!==b.binding.buildingId)throw new TypeError('Нельзя смешивать разные миры The Game');
 const t=Math.max(0,Math.min(1,(time-a.time)/Math.max(.000001,b.time-a.time))),previous=new Map(a.entities.map(e=>[e.id,e]));
 const blend=(x:number,y:number)=>x+(y-x)*t,vector2=(x:[number,number],y:[number,number]):[number,number]=>[blend(x[0],y[0]),blend(x[1],y[1])],visual={...b.environment.visual};
 for(const key of Object.keys(visual) as (keyof typeof visual)[])visual[key]=blend(a.environment.visual[key],b.environment.visual[key]);
 const ac=a.environment.celestial,bc=b.environment.celestial,celestial=ac&&bc&&ac.body===bc.body?{...bc,azimuth:angle(ac.azimuth,bc.azimuth,t),elevation:blend(ac.elevation,bc.elevation),intensity:blend(ac.intensity,bc.intensity),color:[blend(ac.color[0],bc.color[0]),blend(ac.color[1],bc.color[1]),blend(ac.color[2],bc.color[2])] as Vec3}:t<1?ac:bc;
 const lifts=new Map(a.lifts.map(l=>[l.id,l]));
 const audio=sampleCanonicalAudio(a,b,t);return {...b,...(audio!==undefined?{audio}:{}),time:blend(a.time,b.time),worldMinute:blend(a.worldMinute,b.worldMinute),weather:{...b.weather,kind:t<1?a.weather.kind:b.weather.kind,rain:blend(a.weather.rain,b.weather.rain),cloudCoverage:blend(a.weather.cloudCoverage,b.weather.cloudCoverage),fog:blend(a.weather.fog,b.weather.fog),wetness:blend(a.weather.wetness,b.weather.wetness),humidity:blend(a.weather.humidity,b.weather.humidity)},air:{temperatureC:blend(a.air.temperatureC,b.air.temperatureC),wind:vector2(a.air.wind,b.air.wind),speed:blend(a.air.speed,b.air.speed),direction:angle(a.air.direction,b.air.direction,t),gust:blend(a.air.gust,b.air.gust)},environment:{...b.environment,...(celestial?{celestial}:{}),minute:blend(a.environment.minute,b.environment.minute),sunAzimuth:angle(a.environment.sunAzimuth,b.environment.sunAzimuth,t),rain:blend(a.environment.rain,b.environment.rain),snow:blend(a.environment.snow??0,b.environment.snow??0),visual,wind:vector2(a.environment.wind,b.environment.wind),gust:blend(a.environment.gust,b.environment.gust)},lifts:b.lifts.map(l=>{const p=lifts.get(l.id);return p?{...(t<1?p:l),elevation:blend(p.elevation,l.elevation),door:blend(p.door,l.door),velocity:blend(p.velocity,l.velocity)}:l;}),entities:b.entities.map(e=>{const p=previous.get(e.id);if(!p)return e;const next={...(t<1?p:e)};for(const key of ['x','y','z','vx','vy','vz'] as const)next[key]=blend(p[key],e[key]);next.yaw=angle(p.yaw,e.yaw,t);next.phase=angle(p.phase,e.phase,t);return next;})};
}

export class CanonicalOfficeConnection{
 readonly canonical=true;
 readonly url:string;
 status:ConnectionStatus={state:'connecting',controlling:false,voice:false,voiceAllowed:false};
 private listeningFloor:number|null=null;private sentListeningFloor:number|null=null;private confirmedListeningFloor:number|null=null;
 private frames:{frame:CanonicalFrame;received:number}[]=[];private geometry:CanonicalFrame['geometry'];private geometryKind:'office'|'controller'|undefined;
 private network:ControlNetwork|null=null;private baseInput:ControlInput|null=null;private voice:WorldVoice;private socket:WebSocket|null=null;private voiceRetry:ReturnType<typeof setTimeout>|undefined;private voicePing:ReturnType<typeof setInterval>|undefined;
 private timer:ReturnType<typeof setTimeout>|undefined;private inputTimer:ReturnType<typeof setInterval>|undefined;
 private abort:AbortController|null=null;private disposed=false;private connecting=false;private controlGeneration=0;private inputValue:CharacterInput={forward:0,right:0,yaw:0,sprint:false,jump:false};
 private receipts=new Map<number,{resolve:(value:{ok:boolean;error?:string})=>void;timer:ReturnType<typeof setTimeout>}>();private liftView:CanonicalLiftView|null=null;
 private actorReceipts=new Map<number,{resolve:(value:{ok:boolean;message:string})=>void;timer:ReturnType<typeof setTimeout>}>();
 private library:Promise<ControlLibrary>|undefined;
 private aircraftType:((type:string)=>boolean)|null=null;
 private vehicleActions:{id:number|null;command:string;status:string;ok:boolean;message:string;tick:number|null}[]=[];
 private sampler:CanonicalControlSampler|null=null;private controlCamera:CanonicalControlCamera|null=null;private keyboardValue:{keys:Set<string>;camera:CanonicalControlCamera;mouseButtons:number}|null=null;private controlBody='';private controlPulses=new Set<string>();
 private lastSent:(ControlInput&{seq:number})|null=null;
 private presented:WorldPresentation|null=null;private presentedFocus='';private realtime:ReturnType<ControlNetwork['present']>|null=null;
 private loadLibrary():Promise<ControlLibrary>{if(!this.library){const url=new URL('/build/office-controller.js?capability=original-input-31',this.url).href;this.library=(this.options.loadController?this.options.loadController():import(/* @vite-ignore */ url)).then(library=>{if(!this.disposed&&!this.liftView&&library.createOfficeLiftView)this.liftView=library.createOfficeLiftView();return library;}).catch(error=>{this.library=undefined;throw error;});}return this.library;}
 async loadActorFactory():Promise<CanonicalActorsFactory>{const library=await this.loadLibrary();if(typeof library.createOfficeActors!=='function')throw Error('Исходные модели The Game недоступны');return library.createOfficeActors;}
 async loadUrbanFactory():Promise<CanonicalUrbanFactory>{const library=await this.loadLibrary();if(typeof library.createOfficeUrban!=='function')throw Error('Исходное окружение The Game недоступно');return library.createOfficeUrban;}
 async loadSceneryFactory():Promise<CanonicalSceneryFactory>{const library=await this.loadLibrary();if(typeof library.createOfficeScenery!=='function')throw Error('Исходные здания The Game недоступны');return library.createOfficeScenery;}
 async loadRoadFactory():Promise<CanonicalRoadFactory>{const library=await this.loadLibrary();if(typeof library.createOfficeRoads!=='function')throw Error('Исходные дороги The Game недоступны');return library.createOfficeRoads;}
 async loadAudioFactory():Promise<CanonicalAudioFactory>{const library=await this.loadLibrary();if(typeof library.createOfficeAudio!=='function')throw Error('Исходный звук The Game недоступен');return library.createOfficeAudio;}
 async loadSurfaceFactory():Promise<CanonicalSurfaceFactory>{const library=await this.loadLibrary();if(typeof library.createOfficeSurfaceEffects!=='function')throw Error('Исходные следы The Game недоступны');return library.createOfficeSurfaceEffects;}
 async loadLightingSource():Promise<CanonicalLightingSource>{const library=await this.loadLibrary();if(typeof library.officeLightingSource!=='function')throw Error('Исходное освещение The Game недоступно');return library.officeLightingSource;}
 async loadTerrainFactory():Promise<CanonicalTerrainFactory>{const library=await this.loadLibrary();if(typeof library.createOfficeTerrain!=='function')throw Error('Исходный рельеф The Game недоступен');return library.createOfficeTerrain;}
 constructor(private options:CanonicalConnectionOptions={}){this.url=options.url??`${location.protocol}//${location.hostname}:3007`;this.voice=new WorldVoice({...(options.audioSource?{audioSource:options.audioSource}:{}),send:message=>{if(this.socket?.readyState!==1)return false;this.socket.send(JSON.stringify(message));return true;},onVoiceStream:value=>options.onVoiceStream?.(value),onPublishing:voice=>this.setStatus({voice}),onError:message=>this.setStatus({message})});}
 get binding(){const f=this.frames.at(-1)?.frame;return f?this.asPresentation(f).binding:null;}
 get authoritativeSelf(){const s=this.network?.snapshot?.self;return s?{id:s.id,position:[s.x,s.y,s.z] as Vec3}:null;}
 get controlIdentity(){return this.bodyKey();}
 get presentationIdentity(){return this.presentedFocus;}
 get presentationPending(){const latest=this.frames.at(-1);return !latest||!this.presentationReady(latest.frame,this.realtime?.entities??[]);}
 /** Current authority context for action UI; models keep the presented frame's actions. */
 get controlContext(){
  const snapshot=this.network?.snapshot,s=snapshot?.self;if(!s)return null;
  const vehicle=snapshot?.entities?.find(e=>e.id===s.seat),type=vehicle?.type,aircraft=typeof type==='string'&&!!this.aircraftType?.(type),instruments=snapshot?.instruments;
  const vehicleAids=s.seatRole==='driver'&&typeof type==='string'&&!aircraft&&instruments?.vehicleId===s.seat&&instruments?.powered===true,extra=vehicle?.extra;
  const vehicleSystems=vehicleAids&&typeof extra?.abs==='boolean'&&typeof extra.esp==='boolean'&&typeof extra.manual==='boolean'?{abs:extra.abs,esp:extra.esp,manual:extra.manual}:null;
  const f=instruments?.flight,flight=aircraft&&instruments?.vehicleId===s.seat&&f&&[f.airspeed,f.altitude,f.verticalSpeed,f.throttle,f.stall].every(finite)&&f.airspeed!>=0&&f.throttle!>=0&&f.throttle!<=100&&f.stall!>=0&&f.stall!<=100?{airspeed:f.airspeed!,altitude:f.altitude!,verticalSpeed:f.verticalSpeed!,throttle:f.throttle!,stall:f.stall!}:null;
  return{seat:s.seat??null,seatRole:s.seatRole??null,aircraft,vehicleAids,vehicleSystems,flight};
 }
 get residentData(){const s=this.network?.snapshot;return {account:s?.account,residents:s?.residents,selfId:s?.self.id??null,online:this.network?.status==='online'};}
 async listResidents(request:ResidentDirectoryQuery={}):Promise<ResidentDirectoryPage>{const url=new URL('/api/office/residents',this.url);if(request.query)url.searchParams.set('q',request.query);if(request.after)url.searchParams.set('after',request.after);if(request.indoors!==undefined)url.searchParams.set('indoors',request.indoors?'1':'0');if(request.limit!==undefined)url.searchParams.set('limit',String(request.limit));const response=await fetch(url,{credentials:'include',cache:'no-store'});if(!response.ok)throw new Error('Не удалось получить список жителей');return response.json();}
 get observing(){return !!this.network?.snapshot?.account?.observingActorId;}
 watchResident(id:string|null){if(id!==null&&(typeof id!=='string'||!id||id.length>160))throw new TypeError('Некорректный житель');if(this.network)this.network.residentId=id;}
 inspectControl(){const s=this.network?.snapshot;return{input:{...this.inputValue},sent:this.lastSent?{...this.lastSent}:null,pending:this.network?.pending?.length??null,backpressured:this.network?.backpressured??false,network:this.network?.status??'observer',ack:s?.ack??null,self:s?.self??null,account:s?.account??null,vehicle:s?.entities?.find(e=>e.id===s.self.seat)??null,instruments:s?.instruments??null,vehicleActions:this.vehicleActions.map(action=>({...action})),transport:this.network?.inspect?.()??null,lifts:this.presented?.canonical?.lifts??[],liftView:this.liftView?.inspect()??null};}
 private setStatus(change:Partial<ConnectionStatus>){const next={...this.status,...change};if(JSON.stringify(next)===JSON.stringify(this.status))return;this.status=next;this.options.onStatus?.({...this.status});}
 connect(){if(this.disposed||this.timer||this.abort)return;void this.poll();this.connectVoice();}
 private async poll(){
  if(this.disposed)return;const generation=this.controlGeneration,scope=this.focusKey(),kind=this.network?.status==='online'&&this.network.snapshot?'controller':'office';this.abort=new AbortController();const timeout=setTimeout(()=>this.abort?.abort(),4000);
  try{
   const request=async(geometry:boolean)=>{const url=new URL('/api/office/world',this.url);url.searchParams.set('view',kind);if(geometry)url.searchParams.set('geometry','1');else if(this.geometry?.key)url.searchParams.set('knownGeometryKey',this.geometry.key);const response=await fetch(url,{cache:'no-store',...(kind==='controller'?{credentials:'include' as const}:{}),signal:this.abort!.signal});if(!response.ok)throw new Error('The Game: HTTP '+response.status);return readCanonicalFrame(await response.json());};
   let frame=await request(!this.geometry||this.geometryKind!==kind);
   if(frame.view&&this.geometry?.key!==frame.view.geometryKey&&!frame.geometry)frame=await request(true);
   if(this.disposed||generation!==this.controlGeneration||scope!==this.focusKey())return;const last=this.frames.at(-1)?.frame;
   if(last&&(last.epoch!==frame.epoch||last.binding.worldId!==frame.binding.worldId||last.binding.buildingId!==frame.binding.buildingId||frame.time<last.time)){this.frames=[];this.geometry=undefined;}
   if(last&&last.binding.geometryRevision!==frame.binding.geometryRevision){this.frames=[];this.geometry=undefined;}
   if(frame.geometry){this.geometry=frame.geometry;this.geometryKind=kind;}
   const cut=last?.view?.geometryKey!==frame.view?.geometryKey||last?.view?.kind!==frame.view?.kind;if(cut)this.frames=[];
   const accepted={...frame,...(this.geometry?{geometry:this.geometry}:{})};
   if(!this.frames.length||!last||frame.tick!==last.tick){this.frames.push({frame:accepted,received:performance.now()/1000});if(this.frames.length>4)this.frames.shift();}
   this.setStatus({state:'connected',message:''});
   this.syncListeningFloor();
   // Realtime poses are sampled only by present(), once per render frame.
   // Observer bootstrap still publishes without loading the gameplay client.
   if(this.network?.status!=='online'&&this.presentationReady(accepted,[]))this.publishPresentation(this.asPresentation(accepted));
  }catch(error){if(!this.disposed&&generation===this.controlGeneration&&scope===this.focusKey())this.setStatus({state:'error',message:'The Game недоступен: '+(error as Error).message});}
  finally{clearTimeout(timeout);this.abort=null;if(!this.disposed)this.timer=setTimeout(()=>{this.timer=undefined;void this.poll();},200);}
 }
 private connectVoice(){
  if(this.disposed)return;const url=new URL('/api/office/voice',this.url);url.protocol=url.protocol==='https:'?'wss:':'ws:';url.searchParams.set('role',this.status.controlling?'player':'observer');
  const ws=new WebSocket(url);this.socket=ws;ws.onmessage=event=>{if(this.socket!==ws||this.disposed)return;try{
   if(typeof event.data!=='string'||event.data.length>75000)throw Error('Voice packet limit');const value=JSON.parse(event.data);
   if(value.type==='voice-peers')this.voice.setRoster(value.peers,value.selfId);
   else if(value.type==='signal')this.voice.receiveSignal(value.from,value.actorId,value.value);
   else if(value.type==='welcome'||value.type==='permission'){if(typeof value.canPublish!=='boolean')throw Error('Invalid voice permission');this.setStatus({voiceAllowed:value.canPublish});this.voice.permission(value.canPublish);}
   else if(value.type==='voice'){if(typeof value.enabled!=='boolean')throw Error('Invalid voice mode');this.voice.permission(value.enabled);}
   else if(value.type==='listener'){if(!Number.isSafeInteger(value.floor)||value.floor<0||value.floor>63)throw Error('Invalid voice floor');this.confirmedListeningFloor=value.floor;}
   else if(value.type==='error'){this.voice.permission(false);this.setStatus({message:String(value.message).slice(0,200)});}
  }catch{ws.close();}};
  ws.onopen=()=>{if(this.socket!==ws||this.disposed)return;this.sentListeningFloor=null;this.syncListeningFloor();this.voicePing=setInterval(()=>{if(ws.readyState===1)ws.send(JSON.stringify({type:'ping'}));},4000);};
  ws.onclose=()=>{if(this.socket===ws){if(this.voicePing)clearInterval(this.voicePing);this.voicePing=undefined;this.socket=null;this.voice.reset();this.setStatus({voiceAllowed:false});if(!this.disposed)this.voiceRetry=setTimeout(()=>{this.voiceRetry=undefined;this.connectVoice();},2000);}};ws.onerror=()=>{};
 }
 private reconnectVoice(){this.setStatus({voiceAllowed:false});this.sentListeningFloor=null;this.confirmedListeningFloor=null;if(this.voiceRetry)clearTimeout(this.voiceRetry);if(this.voicePing)clearInterval(this.voicePing);this.voiceRetry=this.voicePing=undefined;const previous=this.socket;this.socket=null;previous?.close();this.voice.reset();this.connectVoice();}
 private cancelLifts(error:string){for(const receipt of this.receipts.values()){clearTimeout(receipt.timer);receipt.resolve({ok:false,error});}this.receipts.clear();}
 private cancelActors(message:string){for(const receipt of this.actorReceipts.values()){clearTimeout(receipt.timer);receipt.resolve({ok:false,message});}this.actorReceipts.clear();}
 async control(enabled:boolean){
  if(this.disposed)return;
  if(enabled&&(this.connecting||this.network))return;
  const generation=++this.controlGeneration;
  this.realtime=null;
  if(!enabled){this.releaseControls();this.controlBody='';this.cancelLifts('Управление завершено');this.cancelActors('Соединение с персонажем завершено');this.network?.close();this.network=null;if(this.inputTimer)clearInterval(this.inputTimer);this.inputTimer=undefined;this.setStatus({controlling:false,voice:false});await this.voice.publish(false);this.reconnectVoice();return;}
  this.connecting=true;
  try{
   const response=await fetch(new URL('/api/office/session',this.url),{cache:'no-store',credentials:'include'});if(!response.ok)throw new Error('Сессия The Game: HTTP '+response.status);const config=await response.json();
   const library=await this.loadLibrary();
   if(typeof library.GameNetwork!=='function'||typeof library.idleInput!=='function'||typeof library.GameControlSampler!=='function'||typeof library.GameControlCamera!=='function'||typeof library.isAircraftType!=='function')throw new Error('Неверный клиент The Game');if(this.disposed||generation!==this.controlGeneration)return;
   this.baseInput=library.idleInput();this.sampler=new library.GameControlSampler();this.controlCamera=new library.GameControlCamera();this.aircraftType=library.isAircraftType;this.vehicleActions=[];this.releaseControls();const network=new library.GameNetwork();this.network=network;
   network.onReceipt=(receipt,command)=>{if(this.network!==network||generation!==this.controlGeneration)return;if(command.kind==='vehicle'&&typeof command.value==='string'){const result=receipt.result as {ok?:unknown;message?:unknown}|null;this.vehicleActions.push({id:receipt.id??null,command:command.value,status:receipt.status,ok:receipt.status==='applied'&&result?.ok===true,message:typeof result?.message==='string'?result.message:'',tick:receipt.tick??null});if(this.vehicleActions.length>16)this.vehicleActions.shift();}if(command.kind==='actor'&&receipt.id!==undefined){const pending=this.actorReceipts.get(receipt.id);if(pending){clearTimeout(pending.timer);this.actorReceipts.delete(receipt.id);const result=receipt.result as {message?:unknown}|null;pending.resolve({ok:receipt.status==='applied',message:typeof result?.message==='string'?result.message:receipt.status==='applied'?'Управление обновлено.':'Нет подтверждения переключения персонажа.'});}}if(command.kind==='lift'&&receipt.id!==undefined){const pending=this.receipts.get(receipt.id);if(pending){clearTimeout(pending.timer);this.receipts.delete(receipt.id);pending.resolve({ok:receipt.status==='applied',...(receipt.status!=='applied'?{error:'Лифт отклонил запрос'}:{})});}}};
   await network.connect(config,this.url);if(this.disposed||generation!==this.controlGeneration){network.close();return;}this.setStatus({controlling:true});this.reconnectVoice();
   this.controlBody=this.bodyKey();
   // Browser timers round fractional intervals. Match the original Game's
   // fixed 60 Hz sampling and bounded 100 ms catch-up instead of sending one
   // command per callback and slowly filling the authority input queue.
   const inputClock=new FixedClock(1000/60,100,6);inputClock.reset(performance.now());
   this.inputTimer=setInterval(()=>{if(network.status!=='online'){void this.control(false);return;}const body=this.bodyKey();if(body!==this.controlBody||this.changingFocus){this.releaseControls();this.controlBody=body;}inputClock.advance(performance.now(),()=>{if(this.keyboardValue&&this.sampler){const s=network.snapshot?.self,vehicle=network.snapshot?.entities?.find(e=>e.id===s?.seat),instruments=network.snapshot?.instruments,altitudeAgl=instruments?.vehicleId===s?.seat?instruments?.flight?.altitude:undefined,camera=this.keyboardValue.camera,yaw=camera.yaw,pitch=camera.pitch;let gamepad:Gamepad|null=null;try{gamepad=navigator.getGamepads?.()[0]??null;}catch{}this.inputValue=this.sampler.sample(this.keyboardValue.keys,{camera,seated:!!s?.seat,aircraft:s?.seatRole==='driver'&&!!vehicle?.type&&!!library.isAircraftType?.(vehicle.type),mouseButtons:this.keyboardValue.mouseButtons,aiming:!!(this.keyboardValue.mouseButtons&2),gamepad,now:performance.now()/1000,pulses:this.controlPulses,...(altitudeAgl===undefined?{}:{altitudeAgl})});this.controlPulses.clear();if(camera.yaw!==yaw||camera.pitch!==pitch)this.options.onLook?.({yaw:camera.yaw,pitch:camera.pitch});}this.sendControl(network,{...this.baseInput!,...this.inputValue});});},1000/60);
  }
  catch(error){if(generation===this.controlGeneration){this.network?.close();this.network=null;this.setStatus({controlling:false,message:(error as Error).message});}throw error;}
  finally{this.connecting=false;}
 }
 private bodyKey(){const s=this.network?.snapshot?.self;return s?s.id+':'+(s.controlRevision??0):'';}
 private focusKey(){return this.bodyKey()+':'+(this.network?.snapshot?.account?.observingBodyId??'');}
 private get changingFocus(){return this.focusKey()!==this.presentedFocus&&this.presentationPending;}
 actor(command:ActorControlCommand):Promise<{ok:boolean;message:string}>{
  if(!command||!['observe','possess','return'].includes(command.action)||command.action!=='return'&&(typeof command.actorId!=='string'||!command.actorId||command.actorId.length>160))throw new TypeError('Некорректное действие с персонажем');
  const network=this.network;if(!network||network.status!=='online')return Promise.resolve({ok:false,message:'Войди в мир, чтобы выбрать персонажа'});if(this.actorReceipts.size)return Promise.resolve({ok:false,message:'Дождись подтверждения предыдущего действия'});
  this.releaseControls();const id=network.actorRequest({...command});if(id===null)return Promise.resolve({ok:false,message:'Переключение сейчас недоступно'});
  return new Promise(resolve=>{const timer=setTimeout(()=>{this.actorReceipts.delete(id);resolve({ok:false,message:'Нет подтверждения. Проверь текущее управление перед повтором.'});},8000);this.actorReceipts.set(id,{resolve,timer});});
 }
 private sendControl(network:ControlNetwork,input:ControlInput){const sent=network.send(input);if(sent&&typeof sent==='object'&&'seq' in sent&&typeof sent.seq==='number'&&Number.isSafeInteger(sent.seq))this.lastSent={...input,seq:sent.seq};}
 releaseControls(){this.sampler?.clear();this.controlPulses.clear();this.keyboardValue=null;this.lastSent=null;this.inputValue={forward:0,right:0,yaw:this.inputValue.yaw,sprint:false,jump:false};}
 keyboard(value:CanonicalKeyboard){if(!Array.isArray(value.keys)||value.keys.length>CANONICAL_CONTROL_KEYS.size||value.keys.some(key=>!CANONICAL_CONTROL_KEYS.has(key))||![value.yaw,value.pitch].every(finite)||Math.abs(value.yaw)>1e6||Math.abs(value.pitch)>Math.PI||value.mouseButtons!==undefined&&(!Number.isInteger(value.mouseButtons)||value.mouseButtons<0||value.mouseButtons>31))throw new TypeError('Некорректный ввод The Game');if(!this.status.controlling)return;if(this.observing||this.actorReceipts.size||this.changingFocus){this.releaseControls();return;}if(!this.sampler||!this.controlCamera)throw Error('Исходное управление The Game недоступно');this.controlCamera.yaw=value.yaw;this.controlCamera.pitch=value.pitch;this.keyboardValue={keys:new Set(value.keys),camera:this.controlCamera,mouseButtons:value.mouseButtons??0};}
 look(dx:number,dy:number){if(![dx,dy].every(finite)||Math.abs(dx)>1e6||Math.abs(dy)>1e6)throw new TypeError('Некорректное движение камеры');if(!this.keyboardValue||!this.status.controlling||this.observing||this.actorReceipts.size||this.changingFocus)return;const camera=this.keyboardValue.camera;camera.look(dx,dy,performance.now()/1000);this.options.onLook?.({yaw:camera.yaw,pitch:camera.pitch});}
 vehicleAid(command:'abs'|'esp'|'auto'){if(!['abs','esp','auto'].includes(command))throw new TypeError('Некорректное действие автомобиля');if(!this.keyboardValue||!this.status.controlling||this.observing||this.actorReceipts.size||this.changingFocus||!this.controlContext?.vehicleAids)return false;this.controlPulses.add(command==='abs'?'ToggleAbs':command==='esp'?'ToggleEsp':'ToggleGearMode');return true;}
 input(input:CharacterInput){if(![input.forward,input.right,input.yaw].every(finite)||Math.abs(input.forward)>1||Math.abs(input.right)>1||Math.abs(input.yaw)>1e6||typeof input.sprint!=='boolean'||typeof input.jump!=='boolean')throw new TypeError('Некорректное управление');this.releaseControls();if(this.observing||this.actorReceipts.size||this.changingFocus)return;this.inputValue={forward:input.forward,right:input.right,yaw:input.yaw,sprint:input.sprint,jump:input.jump};}
 setLayout(_state:OfficeState,_solids?:Bounds[],_furniture?:Bounds[]){/* The editor backend commits before this connection polls the acknowledged world. */}
 async lift(floor:number,buildingId?:string):Promise<{ok:boolean;error?:string}>{
  if(!this.network||this.network.status!=='online')return{ok:false,error:'Войди в The Game'};
  if(this.observing||this.changingFocus||this.actorReceipts.size)return{ok:false,error:'Сначала возьми управление персонажем'};
  if(this.receipts.size)return{ok:false,error:'Лифт обрабатывает предыдущий запрос'};
  const near=this.presented?.liftInteraction,id=buildingId??near?.buildingId;if(!near||!near.available||near.buildingId!==id)return{ok:false,error:'Подойди к лифту'};
  if(!Number.isInteger(floor)||floor<0||floor>=near.floorCount||floor>63||!near.inside&&floor!==near.floor)return{ok:false,error:'Выбери доступный этаж лифта'};
  const request=this.network.liftRequest?.({buildingId:near.buildingId,floor});if(request===undefined||request===null)return{ok:false,error:'Лифт недоступен'};
  return new Promise(resolve=>{const timer=setTimeout(()=>{this.receipts.delete(request);resolve({ok:false,error:'Нет подтверждения лифта'});},8000);this.receipts.set(request,{resolve,timer});});
 }
 setListeningFloor(floor:number){if(!Number.isSafeInteger(floor)||floor<0||floor>63)throw new RangeError('Некорректный этаж прослушивания');this.listeningFloor=floor;this.syncListeningFloor();}
 private syncListeningFloor(){
  const b=this.frames.at(-1)?.frame.binding,floor=this.listeningFloor;
  if(this.disposed||this.status.controlling||this.socket?.readyState!==1||!b||floor===null||this.sentListeningFloor===floor)return;
  const installed=b.placement?.floors.map(f=>f.index)??[b.officeFloor];if(!installed.includes(floor))return;
  this.socket.send(JSON.stringify({type:'listen',floor}));this.sentListeningFloor=floor;
 }
 inspectVoice(){return{connected:this.socket?.readyState===1,role:this.status.controlling?'player':'observer',requestedFloor:this.listeningFloor,confirmedFloor:this.confirmedListeningFloor,allowed:this.status.voiceAllowed??false,publishing:this.status.voice};}
 async publishVoice(enabled:boolean){if(enabled&&!this.status.controlling)throw new Error('Войди в мир, чтобы говорить');if(enabled&&!this.status.voiceAllowed)throw new Error('Войди на этаж Office, чтобы говорить');await this.voice.publish(enabled);}
 private presentationReady(frame:CanonicalFrame,entities:readonly CanonicalEntity[]):boolean{
  // Unscoped historical fixtures predate the authority's view/geometry contract.
  const view=frame.view;if(!view)return true;if(frame.geometry?.key!==view.geometryKey)return false;
  if(this.network?.status!=='online')return view.kind==='office';if(view.kind!=='controller')return false;
  const snapshot=this.network.snapshot,id=snapshot?.account?.observingBodyId??snapshot?.self.id,subject=entities.find(e=>e.id===id);if(!subject)return false;
  // Authority view centres are 128 m cells. A new focus needs its own cell;
  // normal travel retains a 16 m margin inside the existing 128 m terrain clip.
  const radius=this.focusKey()===this.presentedFocus?112:64;
  return Math.abs(subject.x-view.center[0])<=radius&&Math.abs(subject.z-view.center[2])<=radius;
 }
 private publishPresentation(value:WorldPresentation){const body=this.bodyKey();if(this.network?.status==='online'&&body!==this.controlBody){this.releaseControls();this.controlBody=body;}this.presented=value;this.presentedFocus=this.focusKey();this.options.onState?.(value);return value;}
 present(now=performance.now()/1000):WorldPresentation|null{
  const network=this.network;this.realtime=network?.status==='online'?network.present(now*1000):null;
  const latest=this.frames.at(-1);if(!latest)return this.presented;if(!this.presentationReady(latest.frame,this.realtime?.entities??[]))return this.presented;const previous=this.frames.at(-2)??latest;
  let sampled=sampleCanonicalFrames(previous.frame,latest.frame,latest.frame.time-.2+Math.min(.2,Math.max(0,now-latest.received)));
  const realtime=this.realtime;if(realtime){sampled=sampleCanonicalFrames(previous.frame,latest.frame,realtime.time);const office=sampled.lifts.find(l=>l.id===sampled.binding.buildingId),lifts=realtime.lifts?[...(office&&!realtime.lifts.some(l=>l.id===office.id)?[office]:[]),...realtime.lifts].slice(0,8):sampled.lifts,marks=realtime.tireMarks??sampled.tireMarks;sampled={...sampled,time:realtime.time,tick:realtime.tick,entities:realtime.entities,...(realtime.audio!==undefined?{audio:realtime.audio}:{}),...(marks!==undefined?{tireMarks:marks}:{}),lifts};}
  return this.publishPresentation(this.asPresentation(sampled));
 }
 private asPresentation(f:CanonicalFrame):WorldPresentation{
  const network=this.network?.status==='online'?this.network:null,b=f.binding,s=network?.snapshot?.self,v=f.environment.visual,az=f.environment.sunAzimuth,el=v.sunElevation;
   const base:WorldPresentation={binding:{worldId:b.worldId,revision:`thegame/${f.revision}`,epoch:b.epoch,seed:f.seed,buildingId:b.buildingId,origin:b.origin,yaw:b.yaw,floorHeight:b.floorHeight,floorCount:b.floorCount,officeFloor:b.officeFloor},tick:f.tick,time:f.time,worldMinute:f.worldMinute,actors:f.entities.filter(e=>e.kind!=='vehicle').map(e=>({id:e.id,residentId:e.id,name:e.kind==='player'?'Игрок':(typeof e.extra?.name==='string'?e.extra.name:'Житель'),position:[e.x,e.y,e.z] as Vec3,yaw:e.yaw,phase:e.phase,speed:Math.hypot(e.vx,e.vz),kind:e.kind==='player'?0:1})),vehicles:[],lift:f.lifts.find(l=>l.id===b.buildingId)??{floor:0,target:0,elevation:0,door:0,phase:'idle' as const,velocity:0},weather:{temperatureC:f.air.temperatureC,humidity:f.weather.humidity,wind:[f.air.wind[0],0,f.air.wind[1]] as Vec3,sunlight:Math.max(0,Math.sin(el)),groundMoisture:f.weather.wetness,precipitation:f.weather.rain>.5?'frequent' as const:f.weather.rain>.1?'occasional' as const:'rare' as const,snowfall:(f.environment.snow??0)>.7?'heavy' as const:(f.environment.snow??0)>.3?'moderate' as const:(f.environment.snow??0)>.01?'light' as const:'none' as const,sunDirection:[Math.cos(az)*Math.cos(el),Math.sin(el),Math.sin(az)*Math.cos(el)] as Vec3,sunIntensity:v.sunIntensity,skyColor:[.23,.33,.45] as Vec3},connected:this.status.state==='connected',layoutRevision:b.geometryRevision??0,canonical:f};
  if(!s)return base;const account=network?.snapshot?.account,observed=account?.observingBodyId?f.entities.find(e=>e.id===account.observingBodyId):undefined,rendered=f.entities.find(e=>e.id===s.id),p=rendered??s,state=characterState(p.x,p.y,p.z,p.yaw),ack=network!.snapshot!.ack??0,focus=account?.observingActorId?observed:rendered,liftInteraction=focus?this.liftView?.present(f.geometry?f:{...f,...(this.geometry?{geometry:this.geometry}:{})},focus)??null:null;return {...base,liftInteraction,...(account?{account:{...account}}:{}),...(observed?{viewSubject:{id:observed.id,position:[observed.x,observed.y,observed.z] as Vec3,yaw:observed.yaw,ack,state:characterState(observed.x,observed.y,observed.z,observed.yaw)}}:{}),self:{id:s.id,position:[p.x,p.y,p.z],yaw:p.yaw,ack,state}};
 }
 dispose(){this.releaseControls();this.disposed=true;this.controlGeneration++;if(this.timer)clearTimeout(this.timer);if(this.inputTimer)clearInterval(this.inputTimer);if(this.voiceRetry)clearTimeout(this.voiceRetry);if(this.voicePing)clearInterval(this.voicePing);this.abort?.abort();this.socket?.close();this.voice.dispose();this.network?.close();this.liftView?.dispose();this.liftView=null;this.frames=[];this.geometry=undefined;this.realtime=null;this.presented=null;this.cancelLifts('Соединение закрыто');this.cancelActors('Соединение закрыто');this.setStatus({state:'closed',controlling:false,voice:false});}
}
