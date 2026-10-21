import {test,expect,afterEach} from 'bun:test';
import type {CanonicalActorsFactory} from '../client/canonical-actors.ts';
import type {CanonicalUrbanFactory} from '../client/canonical-urban.ts';
import type {CanonicalSceneryFactory} from '../client/canonical-scenery.ts';
import type {CanonicalRoadFactory} from '../client/canonical-roads.ts';
import type {CanonicalTerrainFactory} from '../client/canonical-terrain.ts';
import {CanonicalOfficeConnection,readCanonicalFrame,sampleCanonicalFrames} from '../client/canonical-connection.ts';
import type {CanonicalFrame,CanonicalEntity,CanonicalGeometry} from '../client/canonical-types.ts';
import {GameControlSampler} from '../../../../thegame/src/game/input-controls.ts';
import {ThirdPersonCamera as GameControlCamera} from '../../../../thegame/src/game/camera.ts';
import {createOfficeLiftView} from '../../../../thegame/src/game/office-lift-view.ts';
import type {AccountView,ActorControlCommand} from '../../../../thegame/src/game/account-model.ts';

const flush=async()=>{for(let i=0;i<40;i++)await Promise.resolve();};
function deferred<T>(){let resolve!:(value:T)=>void,reject!:(reason:unknown)=>void;const promise=new Promise<T>((yes,no)=>{resolve=yes;reject=no;});return{promise,resolve,reject};}
const restores:(()=>void)[]=[];
afterEach(()=>{while(restores.length)restores.pop()!();});
function frame(changes:Partial<CanonicalFrame>={}):CanonicalFrame{
 const core={depth:8,floorHeight:3.3,worldSeed:29,style:1,color:[.2,.3,.4] as [number,number,number],zone:0,lift:{x:0,z:-4,doorZ:-2,width:3,depth:3}};
 return{source:'thegame',schema:'thegame-office/1',seed:29,revision:17,epoch:73,tick:60,time:1,worldMinute:480.3,
  binding:{worldId:'thegame:29:17',buildingId:'real-office',epoch:73,origin:[100,10,200],yaw:.4,floorHeight:3.3,floorCount:6,officeFloor:2,width:28,depth:22,core,layoutStatus:'unbound'},
  entities:[{id:'player:existing-human',kind:'player',x:100,y:16.6,z:200,yaw:0,vx:0,vy:0,vz:0,phase:0,animation:'idle'}],
  lifts:[{id:'real-office',floor:2,target:2,elevation:6.6,door:1,velocity:0,phase:'idle'}],humanoidStyles:{},vehicleSpecs:{},
  environment:{minute:480.3,sunAzimuth:.5,rain:.1,weather:'clear',wind:[2,4],gust:.2,visual:{sunElevation:.5,sunTemperature:5200,skyTurbidity:2,humidity:.5,cloudCoverage:.1,fogDensity:.01,wetness:.3,exposureBias:0,artificialLightIntensity:.1,sunIntensity:4,skyIntensity:1}},
  weather:{kind:'clear',rain:.1,cloudCoverage:.1,fog:.01,wetness:.3,humidity:.5},air:{temperatureC:18,wind:[2,4],speed:4.5,direction:.5,gust:.2},...changes};
}
function geometry():CanonicalGeometry{return{building:{version:1,id:'real-office',x:100,y:10,z:200,yaw:.4,width:28,depth:22,height:19.8,boxes:[],levels:Array.from({length:6},(_,floor)=>({id:String(floor),elevation:floor*3.3,height:3.3})),core:frame().binding.core},nearbyBuildings:[],roads:[],urban:{boxes:[],props:[],lots:[]},trees:[],chunks:[],terrain:{step:8,startX:96,startZ:192,width:2,depth:2,heights:[10,10,10,10]}};}
function scopedFrame(kind:'office'|'controller',x:number,z:number,tick:number,entities?:CanonicalEntity[]):CanonicalFrame{
 const center:[number,number,number]=kind==='controller'?[(Math.floor(x/128)+.5)*128,0,(Math.floor(z/128)+.5)*128]:[100,0,200],key=kind+':'+center.join(':');
 return frame({tick,time:tick/60,view:{kind,center,geometryKey:key},geometry:{...geometry(),key,terrain:{step:8,startX:Math.floor((center[0]-192)/8)*8,startZ:Math.floor((center[2]-192)/8)*8,width:49,depth:49,heights:Array(49*49).fill(10)}},entities:entities??[{...frame().entities[0]!,x,z}]});
}

function browser(actorFactory?:CanonicalActorsFactory,urbanFactory?:CanonicalUrbanFactory,sceneryFactory?:CanonicalSceneryFactory,roadFactory?:CanonicalRoadFactory,terrainFactory?:CanonicalTerrainFactory,lighting?:import('../client/canonical-lighting.js').CanonicalLightingSource,surfaces?:import('../client/canonical-surface-effects.js').CanonicalSurfaceFactory,audioFactory?:import('../client/canonical-audio.js').CanonicalAudioFactory){
 const keys=['fetch','WebSocket','performance','navigator','location','setTimeout','clearTimeout','setInterval','clearInterval'],previous=new Map(keys.map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)]));
 let clock=0,serial=0;const tasks=new Map<number,{callback:()=>void;delay:number;at:number;interval:boolean}>(),requests:{url:string;options:RequestInit|undefined}[]=[],sockets:Socket[]=[],networks:FakeNetwork[]=[];
 const looks:{yaw:number;pitch:number}[]=[];
 let current=frame(),sourceCalls=0,loaded=0,sessionGate:ReturnType<typeof deferred<Response>>|null=null,networkGate:ReturnType<typeof deferred<void>>|null=null;
 const config={protocol:7,seed:29,revision:17,session:'existing-causal-session',webTransport:{url:'https://127.0.0.1:3009/game',certificateHash:'existing-cert'}};
 class Socket {
  static OPEN=1;readyState=0;bufferedAmount=0;sent:unknown[]=[];closed=0;onopen:(()=>void)|null=null;onmessage:((event:{data:string})=>void)|null=null;onclose:(()=>void)|null=null;onerror:(()=>void)|null=null;
  constructor(readonly url:string|URL){sockets.push(this);}open(){this.readyState=1;this.onopen?.();}send(text:string){this.sent.push(JSON.parse(text));}close(){this.closed++;this.readyState=3;this.onclose?.();}message(value:unknown){this.onmessage?.({data:JSON.stringify(value)});}
 }
 class FakeNetwork {
  status='offline';residentId:string|null=null;snapshot:{self:{id:string;x:number;y:number;z:number;yaw:number;seat?:string|null;seatRole?:string|null;controlRevision?:number};ack:number|null;account?:AccountView;entities?:CanonicalEntity[];instruments?:{vehicleId:string;powered?:boolean;flight?:{altitude:number;airspeed?:number;verticalSpeed?:number;throttle?:number;stall?:number}}}|null=null;closed=0;inputs:unknown[]=[];lifts:{buildingId:string;floor:number}[]=[];actorRequests:ActorControlCommand[]=[];connects:{config:unknown;origin:string}[]=[];allowLift=true;allowActor=true;
  onReceipt: (receipt:{status:string;result:unknown;id?:number;tick?:number},command:{kind:string;value?:unknown})=>void=()=>{};
  constructor(){networks.push(this);}
  async connect(value:unknown,origin:string){this.connects.push({config:value,origin});if(networkGate)await networkGate.promise;this.status='online';this.snapshot={self:{id:'player:existing-human',x:100,y:16.6,z:200,yaw:0},ack:10};}
  close(){this.closed++;this.status='disconnected';this.snapshot=null;}send(value:unknown){this.inputs.push(value);return true;}lift(value:{buildingId:string;floor:number}){this.lifts.push(value);return this.allowLift;}
  liftRequest(value:{buildingId:string;floor:number}){if(!this.allowLift)return null;this.lift(value);return this.lifts.length;}
  actorRequest(value:ActorControlCommand){if(!this.allowActor)return null;const id=this.actorRequests.length;this.actorRequests.push(value);return id;}
  presented:CanonicalEntity[]|null=null;presentedLifts:CanonicalFrame['lifts']|undefined;presentedMarks:CanonicalFrame['tireMarks']|undefined;presentedAudio:CanonicalFrame['audio']|undefined;presentedTime:number|undefined;presents=0;
  present(_now:number){this.presents++;return{tick:current.tick,time:this.presentedTime??current.time,entities:this.presented??current.entities,...(this.presentedLifts?{lifts:this.presentedLifts}:{}),...(this.presentedMarks?{tireMarks:this.presentedMarks}:{}),...(this.presentedAudio?{audio:this.presentedAudio}:{})};}
  receipt(status:string,kind='lift',floor?:number){const last=this.lifts.at(-1);this.onReceipt({id:this.lifts.length,tick:61,status,result:{ok:status==='applied',message:status==='applied'?'Лифт вызван.':'Лифт сейчас недоступен.'}},{kind,value:{buildingId:last?.buildingId??'real-office',floor:floor??last?.floor??3}});}
 }
 const idleInput=()=>({forward:0,right:0,yaw:0,sprint:false,jump:false,pitch:0,crouch:false,interact:false,passenger:false,door:false,aim:false,handbrake:false,attack:false,block:false});
 const schedule=(callback:()=>void,delay=0,interval=false)=>{const id=++serial;tasks.set(id,{callback,delay,at:clock+delay,interval});return id;};
 const values={
  location:{protocol:'http:',hostname:'127.0.0.1',href:'http://127.0.0.1:8765/'},performance:{now:()=>clock},WebSocket:Socket,
  navigator:{mediaDevices:{getUserMedia:async()=>{sourceCalls++;throw new Error('Physical microphone must never be requested by observer');}}},
  fetch:async(url:URL|string,options?:RequestInit)=>{requests.push({url:String(url),options});return new URL(url).pathname==='/api/office/session'?(sessionGate?sessionGate.promise:Response.json(config)):Response.json(current);},
  setTimeout:(callback:()=>void,delay:number)=>schedule(callback,delay),clearTimeout:(id:number)=>tasks.delete(id),setInterval:(callback:()=>void,delay:number)=>schedule(callback,delay,true),clearInterval:(id:number)=>tasks.delete(id),
 };
 for(const [key,value]of Object.entries(values))Object.defineProperty(globalThis,key,{value,writable:true,configurable:true});
 restores.push(()=>{for(const [key,value]of previous){if(value)Object.defineProperty(globalThis,key,value);else Reflect.deleteProperty(globalThis,key);}});
 const options={url:'http://127.0.0.1:3007',onLook:(view:{yaw:number;pitch:number})=>looks.push({...view}),loadController:async()=>{loaded++;return{GameNetwork:FakeNetwork,idleInput,GameControlSampler,GameControlCamera,createOfficeLiftView,isAircraftType:(type:string)=>type==='monoplane',...(actorFactory?{createOfficeActors:actorFactory}:{}),...(urbanFactory?{createOfficeUrban:urbanFactory}:{}),...(sceneryFactory?{createOfficeScenery:sceneryFactory}:{}),...(roadFactory?{createOfficeRoads:roadFactory}:{}),...(terrainFactory?{createOfficeTerrain:terrainFactory}:{}),...(lighting?{officeLightingSource:lighting}:{}),...(surfaces?{createOfficeSurfaceEffects:surfaces}:{}),...(audioFactory?{createOfficeAudio:audioFactory}:{})};}};
 const connection=new CanonicalOfficeConnection(options);restores.push(()=>connection.dispose());
 return{connection,sockets,requests,networks,config,tasks,looks,get loaded(){return loaded;},get sourceCalls(){return sourceCalls;},set frame(value:CanonicalFrame){current=value;},get frame(){return current;},set sessionGate(value:ReturnType<typeof deferred<Response>>|null){sessionGate=value;},set networkGate(value:ReturnType<typeof deferred<void>>|null){networkGate=value;},
  async boot(){connection.connect();await flush();sockets[0]!.open();return this;},
  cabin(){const b=current.binding,lift=current.lifts[0]!,s=b.core.lift!,c=Math.cos(b.yaw),sn=Math.sin(b.yaw),position={x:b.origin[0]+c*s.x+sn*s.z,y:b.origin[1]+lift.elevation+.04,z:b.origin[2]-sn*s.x+c*s.z},n=networks.at(-1)!;Object.assign(n.snapshot!.self,position);n.presented=[{...current.entities[0]!,...position}];connection.present(clock/1000);},
  async timeout(delay:number){const entry=[...tasks].find(([,value])=>!value.interval&&value.delay===delay);if(!entry)throw new Error(`No pending timeout ${delay}`);tasks.delete(entry[0]);clock=entry[1].at;entry[1].callback();await flush();},
  interval(delay:number,elapsed=delay){const task=[...tasks.values()].find(value=>value.interval&&Math.abs(value.delay-delay)<.001);if(!task)throw new Error(`No interval ${delay}`);clock+=elapsed;task.callback();},
  async advance(ms:number){const target=clock+ms;for(let count=0;count<5000;count++){const next=[...tasks].filter(([,task])=>task.at<=target).sort((a,b)=>a[1].at-b[1].at)[0];if(!next){clock=target;return;}clock=next[1].at;tasks.delete(next[0]);if(next[1].interval)tasks.set(next[0],{...next[1],at:clock+next[1].delay});next[1].callback();await flush();}throw new Error('Mock timer loop exceeded bound');},
 };
}

test('rounded browser timers sample exactly 60 Hz and stalls cannot create an unbounded input burst',async()=>{
 const env=await browser().boot();await env.connection.control(true);const n=env.networks[0]!;env.connection.keyboard({keys:['KeyW'],yaw:0,pitch:0});
 for(let i=0;i<2000;i++)env.interval(1000/60,16);
 expect(n.inputs).toHaveLength(1920);expect(n.inputs.at(-1)).toMatchObject({forward:1});
 const before=n.inputs.length;env.interval(1000/60,5000);expect(n.inputs.length-before).toBe(6);
 env.connection.releaseControls();env.interval(1000/60);expect(n.inputs.at(-1)).toMatchObject({forward:0,interact:false});
});

test('character actions wait for the matching authority receipt, including request zero and late replies',async()=>{
 const env=await browser().boot(),c=env.connection;await c.control(true);const n=env.networks[0]!;
 c.keyboard({keys:['KeyW'],yaw:0,pitch:0});env.interval(1000/60);const request=c.actor({action:'observe',actorId:'resident:neighbor'});expect(c.inspectControl().input.forward).toBe(0);expect(n.actorRequests).toEqual([{action:'observe',actorId:'resident:neighbor'}]);expect((await c.actor({action:'return'})).ok).toBe(false);
 let finished=false;void request.then(()=>{finished=true;});n.onReceipt({id:99,status:'applied',result:{message:'Wrong action'}},{kind:'actor'});await flush();expect(finished).toBe(false);n.onReceipt({id:0,status:'rejected',result:{message:'Житель занят'}},{kind:'actor'});expect(await request).toEqual({ok:false,message:'Житель занят'});
 const timeout=c.actor({action:'possess',actorId:'resident:neighbor'});await env.timeout(8000);expect((await timeout).ok).toBe(false);const next=c.actor({action:'return'});finished=false;void next.then(()=>{finished=true;});n.onReceipt({id:1,status:'applied',result:{}},{kind:'actor'});await flush();expect(finished).toBe(false);n.onReceipt({id:2,status:'applied',result:{message:'Вернулись'}},{kind:'actor'});expect(await next).toEqual({ok:true,message:'Вернулись'});
 const cancelled=c.actor({action:'return'});await c.control(false);expect((await cancelled).ok).toBe(false);
});

test('observing follows the presented NPC while retaining account ownership and suppressing body movement',async()=>{
 const env=await browser().boot(),c=env.connection;await c.control(true);const n=env.networks[0]!,own=n.snapshot!.self.id;
 const account:AccountView={version:1,id:'same-account',ownerActorId:'resident:human:same-account',activeActorId:'resident:human:same-account',controlRevision:1,bodyId:own,observingActorId:'resident:neighbor',observingBodyId:'resident:neighbor'};n.snapshot!.account=account;n.snapshot!.self.controlRevision=1;env.frame={...frame(),entities:[{...frame().entities[0]!,id:'resident:neighbor',kind:'pedestrian',x:500,y:3,z:600}]};
 const shown=c.present()!;expect(shown.self!.id).toBe(own);expect(shown.account!.id).toBe('same-account');expect(shown.viewSubject).toMatchObject({id:'resident:neighbor',position:[500,3,600]});c.keyboard({keys:['KeyW','KeyE'],yaw:0,pitch:0});env.interval(1000/60);expect(n.inputs.at(-1)).toMatchObject({forward:0,interact:false});c.input({forward:1,right:0,yaw:0,sprint:true,jump:true});env.interval(1000/60);expect(n.inputs.at(-1)).toMatchObject({forward:0,jump:false});
 c.watchResident('resident:neighbor');expect(n.residentId).toBe('resident:neighbor');c.watchResident(null);expect(n.residentId).toBeNull();expect(()=>c.actor({action:'possess'})).toThrow();
 n.snapshot!.self={...n.snapshot!.self,id:'resident:neighbor',x:500,y:3,z:600,controlRevision:2};n.snapshot!.account={...account,activeActorId:'resident:neighbor',bodyId:'resident:neighbor',controlRevision:2,observingActorId:null,observingBodyId:null};env.interval(1000/60);const possessed=c.present()!;expect(possessed.self!.id).toBe('resident:neighbor');expect(possessed.viewSubject).toBeUndefined();expect(possessed.account!.ownerActorId).toBe(account.ownerActorId);expect(possessed.account!.id).toBe(account.id);expect(n.inputs.at(-1)).toMatchObject({forward:0,interact:false});
});

test('a geometry response from the previous viewed body is discarded after a focus revision',async()=>{
 const env=await browser().boot(),c=env.connection;await c.control(true);const gate=deferred<Response>(),fetchBefore=globalThis.fetch;globalThis.fetch=async()=>gate.promise;await env.timeout(200);const n=env.networks[0]!;n.snapshot!.self.controlRevision=1;const stale=frame({tick:120,time:2});stale.view={kind:'controller',center:[500,0,600],geometryKey:'old-body-scope'};stale.geometry={...geometry(),key:'old-body-scope'};gate.resolve(Response.json(stale));await flush();expect(c.present()!.canonical!.view).toBeUndefined();globalThis.fetch=fetchBefore;
});

test('remote observation holds one complete scene until the matching district arrives',async()=>{
 const env=browser();env.frame=scopedFrame('office',100,200,60);await env.boot();const c=env.connection;c.present();await c.control(true);env.frame=scopedFrame('controller',100,200,61);await env.timeout(200);const old=c.present()!,n=env.networks[0]!,owner=n.snapshot!.self.id;
 const npc={...frame().entities[0]!,id:'resident:far',kind:'pedestrian' as const,x:500,z:600};
 n.snapshot!.account={version:1,id:'same-account',ownerActorId:'resident:human:owner',activeActorId:'resident:human:owner',controlRevision:1,bodyId:owner,observingActorId:npc.id,observingBodyId:npc.id};n.snapshot!.self.controlRevision=1;
 env.frame=scopedFrame('controller',npc.x,npc.z,62,[npc]);const gate=deferred<Response>(),nativeFetch=globalThis.fetch;globalThis.fetch=async()=>gate.promise;await env.timeout(200);
 const count=n.presents,held=c.present();expect(held).toBe(old);expect(n.presents).toBe(count+1);expect(held!.account?.observingBodyId).not.toBe(npc.id);expect(c.presentationPending).toBe(true);
 c.keyboard({keys:['KeyW'],yaw:0,pitch:0});env.interval(1000/60);expect(n.inputs.at(-1)).toMatchObject({forward:0});
 gate.resolve(Response.json(env.frame));await flush();globalThis.fetch=nativeFetch;
 const next=c.present()!;expect(next.viewSubject!.id).toBe(npc.id);expect(next.viewSubject!.position).toEqual([500,16.6,600]);expect(next.canonical!.view!.center).toEqual([448,0,576]);expect(c.presentationPending).toBe(false);
});

test('return waits for the real presented owner instead of falling back to latest-arrival coordinates',async()=>{
 const env=browser();env.frame=scopedFrame('office',100,200,60);await env.boot();const c=env.connection;await c.control(true);const n=env.networks[0]!,owner=n.snapshot!.self.id;
 const npc={...frame().entities[0]!,id:'resident:far',kind:'pedestrian' as const,x:500,z:600};n.snapshot!.self={...n.snapshot!.self,id:npc.id,x:500,z:600,controlRevision:2};n.snapshot!.account={version:1,id:'same-account',ownerActorId:'resident:human:owner',activeActorId:npc.id,controlRevision:2,bodyId:npc.id,observingActorId:null,observingBodyId:null};env.frame=scopedFrame('controller',500,600,61,[npc]);await env.timeout(200);const old=c.present()!,identity=c.presentationIdentity;
 n.snapshot!.self={...n.snapshot!.self,id:owner,x:100,z:200,controlRevision:3};n.snapshot!.account={...n.snapshot!.account,activeActorId:'resident:human:owner',bodyId:owner,controlRevision:3};env.frame=scopedFrame('controller',100,200,62);n.presented=[npc];await env.timeout(200);
 expect(c.present()).toBe(old);expect(c.presentationIdentity).toBe(identity);expect(c.presentationPending).toBe(true);
 n.presented=null;const returned=c.present()!;expect(returned.self!.id).toBe(owner);expect(returned.self!.position).toEqual([100,16.6,200]);expect(returned.canonical!.view!.center).toEqual([64,0,192]);expect(c.presentationIdentity).not.toBe(identity);expect(c.presentationPending).toBe(false);
});

test('leaving control retains its last valid district until the Office observer geometry is ready',async()=>{
 const env=browser();env.frame=scopedFrame('office',100,200,60);await env.boot();const c=env.connection;await c.control(true);env.frame=scopedFrame('controller',100,200,61);await env.timeout(200);const old=c.present()!;
 await c.control(false);expect(c.present()).toBe(old);expect(c.presentationPending).toBe(true);
 env.frame=scopedFrame('office',100,200,62);await env.timeout(200);const observer=c.present()!;expect(observer.self).toBeUndefined();expect(observer.canonical!.view!.kind).toBe('office');expect(c.presentationPending).toBe(false);
});

test('possession in an already displayed cell commits without waiting for another HTTP poll',async()=>{
 const env=browser();env.frame=scopedFrame('office',100,200,60);await env.boot();const c=env.connection;await c.control(true);env.frame=scopedFrame('controller',100,200,61);await env.timeout(200);c.present();const n=env.networks[0]!,npc={...frame().entities[0]!,id:'resident:near',kind:'pedestrian' as const,x:110,z:210};
 n.snapshot!.self={...n.snapshot!.self,id:npc.id,x:npc.x,z:npc.z,controlRevision:1};n.presented=[npc];const count=env.requests.length,shown=c.present()!;
 expect(shown.self!.id).toBe(npc.id);expect(shown.self!.position).toEqual([110,16.6,210]);expect(env.requests.length).toBe(count);expect(c.presentationPending).toBe(false);
 c.keyboard({keys:['KeyW'],yaw:0,pitch:0});env.interval(1000/60);expect(n.inputs.at(-1)).toMatchObject({forward:1});
});

test('ordinary travel keeps held movement while the next cell loads without mixing camera districts',async()=>{
 const env=browser();env.frame=scopedFrame('office',100,200,60);await env.boot();const c=env.connection;await c.control(true);env.frame=scopedFrame('controller',100,200,61);await env.timeout(200);c.present();const n=env.networks[0]!;
 c.keyboard({keys:['KeyW'],yaw:0,pitch:0});env.interval(1000/60);n.presented=[{...frame().entities[0]!,x:140}];expect(c.present()!.self!.position[0]).toBe(140);expect(c.presentationPending).toBe(false);
 const old=c.present();n.presented=[{...frame().entities[0]!,x:210}];expect(c.present()).toBe(old);expect(c.presentationPending).toBe(true);env.interval(1000/60);expect(n.inputs.at(-1)).toMatchObject({forward:1});
 env.frame=scopedFrame('controller',210,200,62);await env.timeout(200);expect(c.present()!.self!.position[0]).toBe(210);expect(c.presentationPending).toBe(false);
});

test('Office physical keys use the original Game sampler every tick and retain held intent',async()=>{
 const env=await browser().boot(),c=env.connection;
 c.keyboard({keys:['KeyW'],yaw:.2,pitch:.1});expect(env.loaded).toBe(0);expect(env.networks).toHaveLength(0);
 await c.control(true);const n=env.networks[0]!,tick=()=>{env.interval(1000/60);return n.inputs.at(-1);};
 c.keyboard({keys:['KeyE'],yaw:.2,pitch:.1});expect(tick()).toMatchObject({interact:true,passenger:false,yaw:.2,pitch:.1});expect(tick()).toMatchObject({interact:true});
 c.keyboard({keys:['KeyG'],yaw:0,pitch:0});expect(tick()).toMatchObject({interact:true,passenger:true});
 c.keyboard({keys:['Space','KeyF','KeyC'],yaw:0,pitch:0});expect(tick()).toMatchObject({jump:true,handbrake:false,crouch:true,door:true});
 n.snapshot!.self.seat='car';n.snapshot!.self.seatRole='driver';expect(c.controlContext).toEqual({seat:'car',seatRole:'driver',aircraft:false,vehicleAids:false,vehicleSystems:null,flight:null});expect(tick()).toMatchObject({jump:false,handbrake:true,crouch:false});
 c.keyboard({keys:['ArrowUp'],yaw:0,pitch:0});expect(tick()).toMatchObject({forward:0,vehicle:'up'});expect((tick() as {vehicle?:string}).vehicle).toBeUndefined();
 c.keyboard({keys:['KeyW','KeyS'],yaw:0,pitch:0});expect(tick()).toMatchObject({forward:0,forwardBrake:true});
 c.releaseControls();expect(tick()).toMatchObject({forward:0,interact:false,handbrake:false,passenger:false,door:false,jump:false});
 n.snapshot!.self.seatRole='passenger';c.keyboard({keys:['KeyW'],yaw:0,pitch:0});expect(tick()).toMatchObject({forward:1});
 // Intent remains untrusted: existing GameAuthority driver ownership checks decide its effect.
 await c.control(false);await c.control(true);env.interval(1000/60);expect(env.networks[1]!.inputs.at(-1)).toMatchObject({forward:0,interact:false});
});
test('Office mouse buttons use original aim, attack and block, and body changes release them',async()=>{
 const env=await browser().boot(),c=env.connection;await c.control(true);const n=env.networks[0]!,tick=()=>{env.interval(1000/60);return n.inputs.at(-1);};
 c.keyboard({keys:['ShiftLeft'],yaw:.4,pitch:.2,mouseButtons:3});expect(tick()).toMatchObject({aim:true,attack:true,block:true,sprint:false});expect(tick()).toMatchObject({aim:true,attack:true});
 c.keyboard({keys:[],yaw:.4,pitch:.2,mouseButtons:0});expect(tick()).toMatchObject({aim:false,attack:false,block:false});
 c.keyboard({keys:[],yaw:.4,pitch:.2,mouseButtons:3});n.snapshot!.self.controlRevision=8;expect(tick()).toMatchObject({aim:false,attack:false});
 for(const mouseButtons of [-1,32,.5,NaN,Infinity])expect(()=>c.keyboard({keys:[],yaw:0,pitch:0,mouseButtons})).toThrow();
});

test('Office reads the browser gamepad each fixed tick and forwards original camera look and release',async()=>{
 const env=await browser().boot(),c=env.connection;await c.control(true);const n=env.networks[0]!;
 let polls=0;const pad={axes:[.3,-.7,.4,-.2],buttons:Array.from({length:12},(_,i)=>({pressed:[0,4,6,7,10].includes(i),value:1,touched:true}))} as unknown as Gamepad;
 Object.defineProperty(navigator,'getGamepads',{configurable:true,value:()=>{polls++;return[pad];}});
 const reference=new GameControlSampler(),camera=new GameControlCamera();camera.yaw=.4;camera.pitch=.2;
 c.keyboard({keys:[],yaw:.4,pitch:.2});env.interval(1000/60);
 const expected=reference.sample(new Set(),{camera,gamepad:pad,now:1/60});
 expect(n.inputs.at(-1)).toEqual(expected);expect(env.looks.at(-1)).toEqual({yaw:camera.yaw,pitch:camera.pitch});expect(polls).toBe(1);
 pad.axes[0]=-.5;pad.axes[1]=.8;env.interval(1000/60);expect(n.inputs.at(-1)).toEqual(reference.sample(new Set(),{camera,gamepad:pad,now:2/60}));expect(polls).toBe(2);
 c.releaseControls();env.interval(1000/60);expect(n.inputs.at(-1)).toMatchObject({forward:0,right:0,aim:false,attack:false});expect(polls).toBe(2);
 Object.defineProperty(navigator,'getGamepads',{configurable:true,value:()=>{throw new Error('Gamepad permission unavailable');}});
 c.keyboard({keys:['KeyW'],yaw:0,pitch:0});env.interval(1000/60);expect(n.inputs.at(-1)).toMatchObject({forward:1,aim:false,attack:false});
});

test('Office camera uses original sensitivity and vehicle aids are one-tick pulses owned by the current driver',async()=>{
 const env=await browser().boot(),c=env.connection;await c.control(true);const n=env.networks[0]!,tick=()=>{env.interval(1000/60);return n.inputs.at(-1);};
 c.keyboard({keys:[],yaw:.4,pitch:.2});const reference=new GameControlCamera();reference.yaw=.4;reference.pitch=.2;reference.look(180,-90,0);c.look(180,-90);
 expect(env.looks.at(-1)).toEqual({yaw:reference.yaw,pitch:reference.pitch});expect(tick()).toMatchObject({yaw:reference.yaw,pitch:reference.pitch});
 expect(c.vehicleAid('abs')).toBe(false);n.snapshot!.self.seat='car';n.snapshot!.self.seatRole='driver';n.snapshot!.entities=[{...env.frame.entities[0]!,id:'car',kind:'vehicle',type:'wagon'}];n.snapshot!.instruments={vehicleId:'car',powered:true};
 for(const command of ['abs','esp','auto'] as const){expect(c.vehicleAid(command)).toBe(true);expect(tick()).toMatchObject({vehicle:command});expect((tick() as any).vehicle).toBeUndefined();}
 c.vehicleAid('abs');c.releaseControls();expect((tick() as any).vehicle).toBeUndefined();n.snapshot!.self.seatRole='passenger';expect(c.vehicleAid('esp')).toBe(false);
 expect(()=>c.look(NaN,0)).toThrow();
});

test('Office vehicle UI context distinguishes powered cars, pilots, pedals, passengers and stale instruments',async()=>{
 const env=await browser().boot(),c=env.connection;await c.control(true);const n=env.networks[0]!;
 c.keyboard({keys:[],yaw:0,pitch:0});n.snapshot!.self.seat='vehicle';n.snapshot!.self.seatRole='driver';n.snapshot!.entities=[{...env.frame.entities[0]!,id:'vehicle',kind:'vehicle',type:'wagon'}];n.snapshot!.instruments={vehicleId:'vehicle',powered:true};
 expect(c.controlContext).toMatchObject({aircraft:false,vehicleAids:true});expect(c.vehicleAid('abs')).toBe(true);
 expect(c.controlContext!.vehicleSystems).toBeNull();n.snapshot!.entities[0]!.extra={abs:true,esp:false,manual:true};expect(c.controlContext!.vehicleSystems).toEqual({abs:true,esp:false,manual:true});
 c.vehicleAid('esp');expect(c.controlContext!.vehicleSystems!.esp).toBe(false);n.snapshot!.entities[0]!.extra.esp=true;expect(c.controlContext!.vehicleSystems!.esp).toBe(true);
 n.snapshot!.entities[0]!.type='monoplane';expect(c.controlContext).toMatchObject({aircraft:true,vehicleAids:false});expect(c.vehicleAid('abs')).toBe(false);
 n.snapshot!.instruments.flight={airspeed:91,altitude:12,verticalSpeed:2.4,throttle:80,stall:7};expect(c.controlContext!.flight).toEqual(n.snapshot!.instruments.flight);
 c.controlContext!.flight!.throttle=0;expect(n.snapshot!.instruments.flight.throttle).toBe(80);n.snapshot!.instruments.vehicleId='other-plane';expect(c.controlContext!.flight).toBeNull();n.snapshot!.instruments.vehicleId='vehicle';
 n.snapshot!.instruments.flight.airspeed=NaN;expect(c.controlContext!.flight).toBeNull();n.snapshot!.instruments.flight={altitude:12};expect(c.controlContext!.flight).toBeNull();
 n.snapshot!.entities[0]!.type='bicycle';n.snapshot!.instruments.powered=false;expect(c.controlContext!.vehicleAids).toBe(false);
 n.snapshot!.entities[0]!.type='wagon';n.snapshot!.instruments.powered=true;n.snapshot!.self.seatRole='passenger';expect(c.controlContext!.vehicleAids).toBe(false);expect(c.vehicleAid('auto')).toBe(false);
 n.snapshot!.self.seatRole='driver';n.snapshot!.instruments.vehicleId='stale-car';expect(c.controlContext!.vehicleAids).toBe(false);
 expect(c.controlContext!.vehicleSystems).toBeNull();
});

test('Office vehicle diagnostics retain execution receipts and never equate a rejection with success',async()=>{
 const env=await browser().boot(),c=env.connection;await c.control(true);const n=env.networks[0]!;
 n.onReceipt({id:1,tick:90,status:'applied',result:{ok:true,message:'Applied'}},{kind:'vehicle',value:'abs'});
 n.onReceipt({id:2,tick:91,status:'rejected',result:{ok:false,message:'No driver'}},{kind:'vehicle',value:'esp'});
 expect(c.inspectControl().vehicleActions).toEqual([{id:1,command:'abs',status:'applied',ok:true,message:'Applied',tick:90},{id:2,command:'esp',status:'rejected',ok:false,message:'No driver',tick:91}]);
 const external=c.inspectControl().vehicleActions;external[0]!.ok=false;expect(c.inspectControl().vehicleActions[0]!.ok).toBe(true);
 for(let i=3;i<30;i++)n.onReceipt({id:i,tick:90+i,status:'applied',result:{ok:true}},{kind:'vehicle',value:'auto'});
 expect(c.inspectControl().vehicleActions).toHaveLength(16);expect(c.inspectControl().vehicleActions.at(-1)!.id).toBe(29);
});

test('Office preserves original mixed keyboard and gamepad flight across takeoff, airborne release and landing',async()=>{
 const env=await browser().boot(),c=env.connection;await c.control(true);const n=env.networks[0]!;
 n.snapshot!.self.seat='plane';n.snapshot!.self.seatRole='driver';n.snapshot!.entities=[{...env.frame.entities[0]!,id:'plane',kind:'vehicle',type:'monoplane'}];
 const pad={axes:[.3,-.4,.1,.1],buttons:Array.from({length:12},()=>({pressed:false,value:0,touched:false}))} as unknown as Gamepad;
 Object.defineProperty(navigator,'getGamepads',{configurable:true,value:()=>[pad]});
 const reference=new GameControlSampler(),camera=new GameControlCamera();camera.yaw=.2;camera.pitch=.1;
 const variants=[['KeyW'],[],['KeyW'],['KeyW','ShiftLeft'],['KeyA','ArrowUp'],['KeyS','ShiftRight'],['Space','ArrowRight']];
 for(let i=0;i<900;i++){
  const altitude=i<100||i>=800?0:5,keys=i<120?['KeyW']:variants[Math.floor((i-120)/30)%variants.length]!;
  n.snapshot!.instruments={vehicleId:'plane',flight:{altitude}};pad.axes[0]=i%120<60?.3:-.5;pad.axes[1]=i%90<45?-.4:.6;
  c.keyboard({keys,yaw:camera.yaw,pitch:camera.pitch,mouseButtons:i%2?3:0});env.interval(1000/60);
  expect(n.inputs.at(-1)).toEqual(reference.sample(new Set(keys),{camera,seated:true,aircraft:true,altitudeAgl:altitude,mouseButtons:i%2?3:0,aiming:!!(i%2),gamepad:pad,now:(i+1)/60}));
 }
 c.releaseControls();env.interval(1000/60);expect((n.inputs.at(-1) as any).flight).toBeUndefined();
});

test('body ownership changes release held keys and reject non-keyboard or non-finite input',async()=>{
 const env=await browser().boot(),c=env.connection;await c.control(true);const n=env.networks[0]!;
 c.keyboard({keys:['KeyE','KeyW'],yaw:0,pitch:0});env.interval(1000/60);expect(n.inputs.at(-1)).toMatchObject({interact:true,forward:1});
 n.snapshot!.self.controlRevision=2;env.interval(1000/60);expect(n.inputs.at(-1)).toMatchObject({interact:false,forward:0});
 c.keyboard({keys:['KeyG'],yaw:0,pitch:0});n.snapshot!.self.id='another-body';env.interval(1000/60);expect(n.inputs.at(-1)).toMatchObject({interact:false,passenger:false});
 for(const value of [{keys:['seat:driver'],yaw:0,pitch:0},{keys:['KeyW'],yaw:NaN,pitch:0},{keys:[],yaw:0,pitch:Infinity}])expect(()=>c.keyboard(value)).toThrow();
});
test('Office flight intent uses the authoritative driver and actual aircraft instruments',async()=>{
 const env=await browser().boot(),c=env.connection;await c.control(true);const n=env.networks[0]!;
 n.snapshot!.self.seat='plane';n.snapshot!.self.seatRole='driver';n.snapshot!.entities=[{...env.frame.entities[0]!,id:'plane',kind:'vehicle',type:'monoplane'}];n.snapshot!.instruments={vehicleId:'plane',flight:{altitude:0}};
 c.keyboard({keys:['KeyW'],yaw:0,pitch:0});env.interval(1000/60);expect(n.inputs.at(-1)).toMatchObject({forward:0,flight:{throttle:.85/60,pitch:0}});
 c.releaseControls();env.interval(1000/60);expect((n.inputs.at(-1) as {flight?:unknown}).flight).toBeUndefined();
 c.keyboard({keys:[],yaw:0,pitch:0});env.interval(1000/60);expect(n.inputs.at(-1)).toMatchObject({flight:{throttle:0}});
 n.snapshot!.self.seatRole='passenger';env.interval(1000/60);expect((n.inputs.at(-1) as {flight?:unknown}).flight).toBeUndefined();
});
test('original actor, street and scenery loading is read-only and shares the same loaded library with later control',async()=>{
 const factory:CanonicalActorsFactory=()=>{throw Error('Visual factory should not be invoked by a connection');},urban:CanonicalUrbanFactory=()=>{throw Error('Street factory should not be invoked by a connection');},scenery:CanonicalSceneryFactory=()=>{throw Error('Scenery factory should not be invoked by a connection');},env=await browser(factory,urban,scenery).boot();
 const loaded=await Promise.all([env.connection.loadActorFactory(),env.connection.loadUrbanFactory(),env.connection.loadSceneryFactory()]);expect(loaded).toEqual([factory,urban,scenery]);expect(await env.connection.loadActorFactory()).toBe(factory);expect(await env.connection.loadUrbanFactory()).toBe(urban);expect(await env.connection.loadSceneryFactory()).toBe(scenery);expect(env.loaded).toBe(1);expect(env.networks).toHaveLength(0);expect(env.requests.some(r=>r.url.endsWith('/api/office/session'))).toBe(false);expect(env.sourceCalls).toBe(0);
 await env.connection.control(true);expect(env.loaded).toBe(1);expect(env.networks).toHaveLength(1);expect(env.connection.status.controlling).toBe(true);
});

test('original road assets use the same read-only library without opening a session or microphone',async()=>{
 const roads:CanonicalRoadFactory=()=>{throw Error('Connection must not invoke the visual factory');},env=await browser(undefined,undefined,undefined,roads).boot();
 expect(await env.connection.loadRoadFactory()).toBe(roads);expect(await env.connection.loadRoadFactory()).toBe(roads);expect(env.loaded).toBe(1);expect(env.networks).toHaveLength(0);expect(env.requests.some(r=>r.url.endsWith('/api/office/session'))).toBe(false);expect(env.sourceCalls).toBe(0);
 await env.connection.control(true);expect(env.loaded).toBe(1);expect(env.networks).toHaveLength(1);expect(env.connection.status.controlling).toBe(true);
});

test('original terrain loading shares the observer library without starting control, physics or microphone capture',async()=>{
 const terrain:CanonicalTerrainFactory=()=>{throw Error('A connection must not instantiate a visual factory');},env=await browser(undefined,undefined,undefined,undefined,terrain).boot();expect(await env.connection.loadTerrainFactory()).toBe(terrain);expect(await env.connection.loadTerrainFactory()).toBe(terrain);expect(env.loaded).toBe(1);expect(env.networks).toHaveLength(0);expect(env.sourceCalls).toBe(0);expect(env.requests.some(r=>r.url.endsWith('/api/office/session'))).toBe(false);
});
test('repeated enter does not invalidate the existing controller or its reliable lift receipt',async()=>{
 const env=await browser().boot(),c=env.connection;await c.control(true);await c.control(true);expect(env.networks).toHaveLength(1);
 env.cabin();const request=c.lift(3);env.networks[0]!.receipt('applied');expect(await request).toEqual({ok:true});
});

test('canonical Office starts with a read-only observer and never loads or joins gameplay or captures audio',async()=>{
 const env=await browser().boot(),{connection}=env;
 expect(connection.status.state).toBe('connected');expect(connection.status.controlling).toBe(false);expect(env.loaded).toBe(0);expect(env.networks).toHaveLength(0);expect(env.sourceCalls).toBe(0);
 expect(env.requests.map(request=>new URL(request.url).pathname)).toEqual(['/api/office/world']);expect(env.requests[0]!.url).toContain('geometry=1');expect(env.requests[0]!.options?.credentials).toBeUndefined();
 expect(new URL(env.sockets[0]!.url).pathname).toBe('/api/office/voice');expect(new URL(env.sockets[0]!.url).searchParams.get('role')).toBe('observer');expect(new URL(env.sockets[0]!.url).searchParams.has('session')).toBe(false);
 await expect(connection.publishVoice(true)).rejects.toThrow('Войди');expect(env.sourceCalls).toBe(0);expect(env.sockets[0]!.sent).toEqual([]);
});

test('controller scope uses credentials and replaces cached geometry when its server key changes',async()=>{
 const env=browser(),scoped=(kind:'office'|'controller',key:string,tick:number,startX=96)=>frame({tick,time:tick/60,view:{kind,center:[startX,0,192],geometryKey:key},entities:[{...frame().entities[0]!,x:startX+4}],geometry:{...geometry(),key,terrain:{...geometry().terrain,startX}}});
 const nativeFetch=globalThis.fetch;globalThis.fetch=async(url,options)=>{const response=await nativeFetch(url,options);if(new URL(String(url)).pathname!=='/api/office/world')return response;const value=await response.json();if(new URL(String(url)).searchParams.get('geometry')!=='1')delete value.geometry;return Response.json(value);};
 env.frame=scoped('office','office:a',60);await env.boot();expect(env.connection.present()!.canonical!.geometry!.key).toBe('office:a');
 await env.connection.control(true);env.frame=scoped('controller','controller:a',61);await env.timeout(200);
 expect(env.requests.at(-1)!.url).toContain('view=controller');expect(env.requests.at(-1)!.options?.credentials).toBe('include');expect(env.connection.present()!.canonical!.geometry!.key).toBe('controller:a');
 env.frame=scoped('controller','controller:a',62);await env.timeout(200);expect(env.requests.at(-1)!.url).not.toContain('geometry=1');
 env.frame=scoped('controller','controller:b',63,224);await env.timeout(200);expect(env.requests.at(-1)!.url).toContain('geometry=1');expect(env.connection.present()!.canonical!.geometry!.terrain.startX).toBe(224);
 await env.connection.control(false);env.frame=scoped('office','office:a',64);await env.timeout(200);expect(env.requests.at(-1)!.url).toContain('view=office');expect(env.requests.at(-1)!.options?.credentials).toBeUndefined();expect(env.connection.present()!.canonical!.geometry!.key).toBe('office:a');expect(env.loaded).toBe(1);expect(env.sourceCalls).toBe(0);
});

test('a cache-aware authority supplies a changed controller district in one HTTP request',async()=>{
 const env=browser(),nativeFetch=globalThis.fetch,key='controller:one+two,three/?#=',scoped=(value:string,tick:number,x:number)=>({...scopedFrame('controller',x,200,tick),view:{kind:'controller' as const,center:[x,0,192] as [number,number,number],geometryKey:value},geometry:{...geometry(),key:value,terrain:{...geometry().terrain,startX:x}}});
 globalThis.fetch=async(url,options)=>{const response=await nativeFetch(url,options),u=new URL(String(url));if(u.pathname!=='/api/office/world')return response;const f=await response.json();if(u.searchParams.get('geometry')!=='1'&&(!u.searchParams.has('knownGeometryKey')||u.searchParams.get('knownGeometryKey')===f.view.geometryKey))delete f.geometry;return Response.json(f);};
 env.frame=scopedFrame('office',100,200,60);await env.boot();await env.connection.control(true);env.frame=scoped(key,61,96);await env.timeout(200);env.connection.present();
 const before=env.requests.length;env.frame=scoped('controller:next',62,224);await env.timeout(200);
 expect(env.requests.length-before).toBe(1);const request=new URL(env.requests.at(-1)!.url);expect(request.searchParams.get('knownGeometryKey')).toBe(key);expect(request.searchParams.has('geometry')).toBe(false);expect(env.connection.present()!.canonical!.geometry!.key).toBe('controller:next');
 const warm=env.requests.length;env.frame=scoped('controller:next',63,224);await env.timeout(200);expect(env.requests.length-warm).toBe(1);expect(env.connection.present()!.canonical!.geometry!.key).toBe('controller:next');
});

test('a failed old controller world request cannot replace explicit observer status',async()=>{
 const env=await browser().boot();await env.connection.control(true);const nativeFetch=globalThis.fetch,gate=deferred<void>();
 globalThis.fetch=async(url,options)=>{const response=await nativeFetch(url,options);if(new URL(String(url)).searchParams.get('view')==='controller')await gate.promise;return response;};
 await env.timeout(200);await env.connection.control(false);gate.reject(new Error('Old controller request failed'));await flush();
 expect(env.connection.status.state).toBe('connected');expect(env.connection.status.controlling).toBe(false);expect(env.networks[0]!.closed).toBeGreaterThan(0);
});

test('wire scope validation rejects geometry from a different view',()=>{
 for(const view of [null,{kind:'other',center:[0,0,0],geometryKey:'one'},{kind:'controller',center:[NaN,0,0],geometryKey:'one'},{kind:'controller',center:[0,0,0],geometryKey:''}])expect(()=>readCanonicalFrame(frame({view:view as any}))).toThrow('область');
 expect(()=>readCanonicalFrame(frame({view:{kind:'controller',center:[0,0,0],geometryKey:'new'},geometry:{...geometry(),key:'old'}}))).toThrow('область');
});

test('only explicit control fetches a credentialed session and uses the injected real GameNetwork interface',async()=>{
 const env=await browser().boot(),{connection}=env;await connection.control(true);
 expect(env.requests.filter(request=>new URL(request.url).pathname==='/api/office/session')).toHaveLength(1);expect(env.requests.at(-1)!.options?.credentials).toBe('include');expect(env.loaded).toBe(1);expect(env.networks).toHaveLength(1);
 const network=env.networks[0]!;expect(network.connects).toEqual([{config:env.config,origin:'http://127.0.0.1:3007'}]);expect(connection.status.controlling).toBe(true);expect(new URL(env.sockets.at(-1)!.url).searchParams.get('role')).toBe('player');
 connection.input({forward:.5,right:-.25,yaw:.7,sprint:true,jump:false});env.interval(1000/60);
 expect(network.inputs).toEqual([{forward:.5,right:-.25,yaw:.7,sprint:true,jump:false,pitch:0,crouch:false,interact:false,passenger:false,door:false,aim:false,handbrake:false,attack:false,block:false}]);
 await connection.control(false);expect(network.closed).toBe(1);expect(connection.status.controlling).toBe(false);expect(new URL(env.sockets.at(-1)!.url).searchParams.get('role')).toBe('observer');expect(env.sourceCalls).toBe(0);
});

test('lift resolves on the actual executed receipt, ignoring other commands and blocking a duplicate request',async()=>{
 const env=await browser().boot();await env.connection.control(true);env.cabin();let finished=false;
 const pending=env.connection.lift(3).then(result=>{finished=true;return result;});await flush();const network=env.networks[0]!;
 expect(network.lifts).toEqual([{buildingId:'real-office',floor:3}]);expect(finished).toBe(false);
 network.receipt('applied','life');await flush();expect(finished).toBe(false);expect((await env.connection.lift(4)).ok).toBe(false);expect(network.lifts).toHaveLength(1);
 network.receipt('applied');expect(await pending).toEqual({ok:true});
 const rejected=env.connection.lift(3);network.receipt('rejected');expect((await rejected).ok).toBe(false);
 const unknown=env.connection.lift(3);network.receipt('unknown');expect((await unknown).ok).toBe(false);
});

test('lift timeout and disposed connection resolve pending work without claiming arrival or execution',async()=>{
 const env=await browser().boot();await env.connection.control(true);env.cabin();
 const timeout=env.connection.lift(3);await env.timeout(8000);expect((await timeout).ok).toBe(false);
 const closed=env.connection.lift(3);env.connection.dispose();expect(await closed).toEqual({ok:false,error:'Соединение закрыто'});expect(env.connection.status.state).toBe('closed');expect(env.connection.status.controlling).toBe(false);
});

test('lift interaction follows the presented body at another original building and sends only that lift command',async()=>{
 const env=await browser().boot(),b=env.frame.binding,s=b.core.lift!,other={...geometry().building,id:'other-original-lift',x:-300,y:2,z:400,yaw:1.3},state={...env.frame.lifts[0]!,id:other.id},c=Math.cos(other.yaw),sn=Math.sin(other.yaw),person={...env.frame.entities[0]!,x:other.x+c*s.x+sn*s.z,y:other.y+state.elevation+.04,z:other.z-sn*s.x+c*s.z};
 env.frame=frame({tick:61,time:1.1,geometry:{...geometry(),nearbyBuildings:[other]},entities:[person],lifts:[state]});await env.advance(200);await env.connection.control(true);const network=env.networks[0]!;network.presented=[person];network.snapshot!.self={...network.snapshot!.self,x:1000,y:0,z:1000};
 const shown=env.connection.present(1.1)!;expect(shown.liftInteraction).toMatchObject({buildingId:other.id,floor:2,inside:true,available:true});expect(shown.self!.position).toEqual([person.x,person.y,person.z]);const samples=network.presents;
 expect((await env.connection.lift(3,b.buildingId)).ok).toBe(false);expect(network.lifts).toHaveLength(0);const request=env.connection.lift(3,other.id);expect(network.lifts).toEqual([{buildingId:other.id,floor:3}]);expect(network.presents).toBe(samples);network.receipt('applied');expect(await request).toEqual({ok:true});
});

test('the one causal sample supplies both passenger and lift, ahead of delayed HTTP geometry metadata',async()=>{
 const env=await browser().boot();await env.connection.control(true);env.cabin();const n=env.networks[0]!,body={...n.presented![0]!,y:14.44},lift={...env.frame.lifts[0]!,floor:1,target:2,elevation:4.4,door:0,velocity:2.2,phase:'moving' as const};n.presented=[body];n.presentedLifts=[lift];n.snapshot!.self.y=999;const before=n.presents,shown=env.connection.present(1.1)!;
 expect(n.presents).toBe(before+1);expect(shown.self!.position[1]).toBe(body.y);expect(shown.lift).toEqual(lift);expect(shown.canonical!.lifts).toEqual([lift]);expect(shown.liftInteraction).toMatchObject({buildingId:lift.id,inside:true,available:false,state:lift});expect(shown.lift.elevation+.04+shown.binding.origin[1]).toBeCloseTo(body.y,12);expect(env.frame.lifts[0]!.elevation).toBe(6.6);
});

test('a late receipt for an expired lift command cannot complete the next request on the same connection',async()=>{
 const env=await browser().boot();await env.connection.control(true);env.cabin();const network=env.networks[0]!,first=env.connection.lift(3);await env.timeout(8000);expect((await first).ok).toBe(false);
 let finished=false;const second=env.connection.lift(4).then(value=>{finished=true;return value;});network.onReceipt({id:1,status:'applied',result:{}},{kind:'lift'});await flush();expect(finished).toBe(false);network.onReceipt({id:2,status:'applied',result:{}},{kind:'lift'});expect(await second).toEqual({ok:true});
});

test('hall callers can request only their landing and observing cannot submit a lift request',async()=>{
 const env=await browser().boot();await env.connection.control(true);const network=env.networks[0]!;env.connection.present(0);expect((await env.connection.lift(3)).ok).toBe(false);expect(network.lifts).toHaveLength(0);
 const call=env.connection.lift(2);network.receipt('applied');expect(await call).toEqual({ok:true});env.cabin();network.snapshot!.account={version:1,id:'account',ownerActorId:'resident:human:account',activeActorId:'resident:human:account',bodyId:'player:existing-human',observingActorId:'resident:other',observingBodyId:'resident:other',controlRevision:1};expect((await env.connection.lift(3)).ok).toBe(false);expect(network.lifts).toHaveLength(1);
});

test('relinquishing control immediately resolves an outstanding lift rather than leaving it until timeout',async()=>{
 const env=await browser().boot();await env.connection.control(true);env.cabin();let result:{ok:boolean;error?:string}|undefined;const pending=env.connection.lift(3).then(value=>result=value);
 await env.connection.control(false);await flush();expect(result?.ok).toBe(false);await pending;
});

test('cancelled pending control cannot later fetch/install a controller after the user leaves',async()=>{
 const env=await browser().boot(),gate=deferred<Response>();env.sessionGate=gate;const enabling=env.connection.control(true);await flush();await env.connection.control(false);gate.resolve(Response.json(env.config));await enabling;
 expect(env.connection.status.controlling).toBe(false);expect(env.networks.every(network=>network.closed>0)).toBe(true);expect(new URL(env.sockets.at(-1)!.url).searchParams.get('role')).toBe('observer');
});

test('a stale old controller receipt cannot finish a lift requested by its replacement connection',async()=>{
 const env=await browser().boot();await env.connection.control(true);env.cabin();const first=env.networks[0]!,oldRequest=env.connection.lift(3);await env.connection.control(false);await oldRequest;
 await env.connection.control(true);env.cabin();const second=env.networks[1]!;let finished=false;const current=env.connection.lift(4).then(value=>{finished=true;return value;});
 first.receipt('applied','lift',3);await flush();expect(finished).toBe(false);second.receipt('applied','lift',4);expect(await current).toEqual({ok:true});
});

test('cancelling a pending real-network handshake preserves the explicit leave after it completes',async()=>{
 const env=await browser().boot(),gate=deferred<void>();env.networkGate=gate;const enabling=env.connection.control(true);await flush();expect(env.networks).toHaveLength(1);await env.connection.control(false);gate.resolve();await enabling;
 expect(env.connection.status.controlling).toBe(false);expect(env.networks[0]!.closed).toBeGreaterThan(0);expect(new URL(env.sockets.at(-1)!.url).searchParams.get('role')).toBe('observer');
});

test('rejected gameplay-session access cannot load a controller or report that control was granted',async()=>{
 const env=await browser().boot(),gate=deferred<Response>();env.sessionGate=gate;gate.resolve(new Response('Forbidden',{status:403}));
 await expect(env.connection.control(true)).rejects.toThrow('403');expect(env.loaded).toBe(0);expect(env.networks).toHaveLength(0);expect(env.connection.status.controlling).toBe(false);expect(env.sourceCalls).toBe(0);
});

test('observer voice sends bounded heartbeats without requesting any player session',async()=>{
 const env=await browser().boot();await env.advance(4100);expect(env.sockets[0]!.sent).toContainEqual({type:'ping'});expect(env.requests.every(request=>new URL(request.url).pathname==='/api/office/world')).toBe(true);expect(env.sourceCalls).toBe(0);
});

test('Office observation requests only its installed voice floor and resends it after reconnect',async()=>{
 const env=browser();env.frame={...env.frame,binding:{...env.frame.binding,placement:{floors:[{index:2},{index:3}]} as any}};await env.boot();const c=env.connection;
 c.setListeningFloor(3);c.setListeningFloor(3);expect(env.sockets[0]!.sent.filter((p:any)=>p.type==='listen')).toEqual([{type:'listen',floor:3}]);
 env.sockets[0]!.message({type:'listener',floor:3});expect(c.inspectVoice().confirmedFloor).toBe(3);expect(env.networks).toHaveLength(0);expect(env.sourceCalls).toBe(0);
 env.sockets[0]!.close();await env.timeout(2000);env.sockets.at(-1)!.open();expect(env.sockets.at(-1)!.sent).toContainEqual({type:'listen',floor:3});
 const count=env.sockets.at(-1)!.sent.length;c.setListeningFloor(4);expect(env.sockets.at(-1)!.sent).toHaveLength(count);expect(()=>c.setListeningFloor(NaN)).toThrow();
});
test('canonical voice must receive the real floor permission before it can request capture',async()=>{
 const env=await browser().boot();await env.connection.control(true);const socket=env.sockets.at(-1)!;socket.open();socket.message({type:'welcome',canPublish:false,actorId:'player:existing-human'});
 await expect(env.connection.publishVoice(true)).rejects.toThrow('этаж');expect(env.sourceCalls).toBe(0);
 socket.message({type:'permission',canPublish:true});expect(env.connection.status.voiceAllowed).toBe(true);
 socket.message({type:'permission',canPublish:false});expect(env.connection.status.voiceAllowed).toBe(false);await expect(env.connection.publishVoice(true)).rejects.toThrow('этаж');expect(env.sourceCalls).toBe(0);
 await env.connection.control(false);socket.message({type:'permission',canPublish:true});expect(env.connection.status.voiceAllowed).toBe(false);
});

test('a changed server epoch at the same tick replaces the sampled world and its geometry',async()=>{
 const env=browser();env.frame=frame({geometry:geometry()});await env.boot();expect(env.connection.present()!.binding.epoch).toBe(73);
 const next=frame({epoch:74,geometry:geometry()});next.binding.epoch=74;next.binding.width=30;next.geometry!.building.width=30;env.frame=next;await env.timeout(200);
 const shown=env.connection.present();expect(shown).not.toBeNull();expect(shown!.binding.epoch).toBe(74);expect(shown!.canonical!.geometry!.building.width).toBe(30);
});

test('canonical sample shares one city clock, shortest rotation and vehicle/player movement time',()=>{
 const a=frame(),b=frame({tick:120,time:2,worldMinute:480.6});a.entities[0]!.yaw=3.1;a.entities[0]!.phase=3.1;b.entities[0]!.yaw=-3.1;b.entities[0]!.phase=-3.1;b.entities[0]!.x=110;
 const vehicle=(x:number):CanonicalEntity=>({id:'vehicle:9',kind:'vehicle',x,y:10,z:200,yaw:0,vx:10,vy:0,vz:0,phase:0,animation:'idle'});a.entities.push(vehicle(200));b.entities.push(vehicle(220));
 const sample=sampleCanonicalFrames(a,b,1.5);expect(sample.time).toBe(1.5);expect(sample.worldMinute).toBeCloseTo(480.45);expect(sample.entities[0]!.x).toBe(105);expect(sample.entities[1]!.x).toBe(210);expect(sample.entities[0]!.yaw).toBeCloseTo(Math.PI);expect(sample.entities[0]!.phase).toBeCloseTo(Math.PI);
 expect(sampleCanonicalFrames(a,b,0).time).toBe(1);expect(sampleCanonicalFrames(a,b,10).time).toBe(2);
});

test('weather, air, sun and moving lift use the same interpolation time as their actors',()=>{
 const a=frame(),b=frame({tick:120,time:2,worldMinute:480.6});a.weather.humidity=.2;b.weather.humidity=.8;a.air.temperatureC=10;b.air.temperatureC=20;b.air.wind=[4,8];b.environment.wind=[4,8];b.environment.visual.sunIntensity=8;b.environment.minute=480.6;b.lifts[0]!.elevation=8.6;b.lifts[0]!.door=.4;b.lifts[0]!.phase='moving';
 const sample=sampleCanonicalFrames(a,b,1.5);expect(sample.weather.humidity).toBeCloseTo(.5);expect(sample.air.temperatureC).toBe(15);expect(sample.air.wind).toEqual([3,6]);expect(sample.environment.wind).toEqual([3,6]);expect(sample.environment.minute).toBeCloseTo(sample.worldMinute);expect(sample.environment.visual.sunIntensity).toBe(6);expect(sample.lifts[0]!.elevation).toBeCloseTo(7.6);expect(sample.lifts[0]!.door).toBeCloseTo(.7);
});

test('canonical sampler refuses a mixed epoch or non-finite presentation clock',()=>{
 const a=frame(),b=frame({time:2,epoch:74});b.binding.epoch=74;expect(()=>sampleCanonicalFrames(a,b,1.5)).toThrow();expect(()=>sampleCanonicalFrames(a,frame({time:2}),NaN)).toThrow();
});

test('snow intensity uses the actor presentation clock and older frames remain dry',()=>{
 const a=frame(),b=frame({tick:120,time:2});b.environment.snow=.8;
 expect(sampleCanonicalFrames(a,b,1.5).environment.snow).toBeCloseTo(.4);
 expect(sampleCanonicalFrames(a,b,0).environment.snow).toBe(0);
 expect(sampleCanonicalFrames(a,b,3).environment.snow).toBe(.8);
 expect(readCanonicalFrame(a)).toBe(a);expect(readCanonicalFrame(b)).toBe(b);
 for(const snow of [NaN,Infinity,-.1,1.1]){
  const invalid=frame();invalid.environment.snow=snow;
  expect(()=>readCanonicalFrame(invalid)).toThrow('осадки');
 }
});

test('acknowledged Office revision discards stale interpolation and requests its new core geometry',async()=>{
 const env=browser();env.frame={...frame(),geometry:geometry()};await env.boot();
 const next=frame({tick:120,time:2});next.binding.geometryRevision=1;next.entities[0]!.x=108;env.frame=next;await env.timeout(200);
 expect(env.connection.present()!.actors[0]!.position[0]).toBe(108);expect(env.connection.present()!.layoutRevision).toBe(1);expect(env.connection.present()!.canonical!.geometry).toBeUndefined();
 next.geometry=geometry();next.tick=121;env.frame=next;await env.timeout(200);expect(env.requests.at(-1)!.url).toContain('geometry=1');expect(env.connection.present()!.canonical!.geometry).toEqual(next.geometry);
});

test('canonical wire validation rejects malformed causes before geometry, audio or render consumes them',()=>{
 expect(readCanonicalFrame(frame())).toEqual(frame());
 const cases:((f:CanonicalFrame)=>void)[]=[
  f=>f.epoch=NaN,f=>f.binding.epoch=74,f=>f.binding.worldId='',f=>f.tick=-1,f=>f.time=Infinity,f=>f.worldMinute=NaN,
  f=>f.entities[0]!.x=NaN,f=>f.entities.push({...f.entities[0]!}),f=>f.weather.humidity=NaN,f=>f.weather.rain=Infinity,
  f=>f.air.wind[0]=NaN,f=>f.air.temperatureC=Infinity,f=>f.environment.visual.sunIntensity=NaN,f=>f.environment.sunAzimuth=Infinity,
  f=>f.lifts[0]!.door=2,f=>f.lifts[0]!.floor=64,f=>f.lifts[0]!.elevation=NaN,
 ];
 for(const mutate of cases){const invalid=frame();mutate(invalid);expect(()=>readCanonicalFrame(invalid)).toThrow();}
});


test("original lighting shares the observer library without a session, source invocation or microphone",async()=>{
 const light:import("../client/canonical-lighting.js").CanonicalLightingSource=()=>{throw Error("A loader must not sample or create a light scene");},env=await browser(undefined,undefined,undefined,undefined,undefined,light).boot();expect(await env.connection.loadLightingSource()).toBe(light);expect(await env.connection.loadLightingSource()).toBe(light);expect(env.loaded).toBe(1);expect(env.networks).toHaveLength(0);expect(env.sourceCalls).toBe(0);expect(env.requests.some(r=>r.url.endsWith("/api/office/session"))).toBe(false);await env.connection.control(true);expect(env.loaded).toBe(1);expect(env.networks).toHaveLength(1);
});

test('the original surface factory loads once for observers without activating a player or creating a scene',async()=>{
 const surfaces:import('../client/canonical-surface-effects.js').CanonicalSurfaceFactory=()=>{throw Error('Loading must not create a surface scene');},env=await browser(undefined,undefined,undefined,undefined,undefined,undefined,surfaces).boot();expect(await env.connection.loadSurfaceFactory()).toBe(surfaces);expect(await env.connection.loadSurfaceFactory()).toBe(surfaces);expect(env.loaded).toBe(1);expect(env.networks).toHaveLength(0);expect(env.sourceCalls).toBe(0);expect(env.requests.some(r=>r.url.endsWith('/api/office/session'))).toBe(false);
});

test('realtime tyre marks, actors and their clock come from one presentation even when HTTP records are stale',async()=>{
 const mark:NonNullable<CanonicalFrame['tireMarks']>[number]={id:1,at:.5,a:[100,10,200],b:[100,10,201],n:[0,1,0],width:.22,strength:.5,dirt:false,kind:'rubber'},env=browser();env.frame=frame({tireMarks:[mark]});await env.boot();await env.connection.control(true);const network=env.networks[0]!,live=[{...mark,id:2,at:1.2}];network.presentedMarks=live;network.presentedTime=.8;const before=network.presents,shown=env.connection.present()!;expect(network.presents-before).toBe(1);expect(shown.time).toBe(.8);expect(shown.canonical!.time).toBe(.8);expect(shown.canonical!.tireMarks).toBe(live);expect(shown.canonical!.entities).toBe(env.frame.entities);network.presentedMarks=[];expect(env.connection.present()!.canonical!.tireMarks).toEqual([]);
});

test('source audio library loading is passive and realtime sound shares one pose sampling call',async()=>{
 const factory:import('../client/canonical-audio.js').CanonicalAudioFactory=()=>{throw Error('Loading may not start audio');},env=await browser(undefined,undefined,undefined,undefined,undefined,undefined,undefined,factory).boot();expect(await env.connection.loadAudioFactory()).toBe(factory);expect(env.sourceCalls).toBe(0);expect(env.networks).toHaveLength(0);expect(env.requests.some(r=>r.url.endsWith('/api/office/session'))).toBe(false);await env.connection.control(true);const network=env.networks[0]!,sound:NonNullable<CanonicalFrame['audio']>=[['vehicle:1',1800,20,[],1,4]];network.presentedAudio=sound;network.presentedTime=.5;const before=network.presents,shown=env.connection.present()!;expect(network.presents-before).toBe(1);expect(shown.time).toBe(.5);expect(shown.canonical!.audio).toBe(sound);network.presentedAudio=[];expect(env.connection.present()!.canonical!.audio).toEqual([]);expect(env.loaded).toBe(1);
});
