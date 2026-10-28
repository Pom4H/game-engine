import {randomBytes} from 'node:crypto';
import {ThegameAuthority,type Peer} from './game/session.js';
import {materializeCrowd} from './game/crowd.js';
import {characterState} from '../../src/runtime/character-motor.js';
import {BuildingWorld,BuildingLift,readOfficeState} from './building.js';
import {actorsProjection,vehiclesProjection,serverWeather,worldPoint,localPoint,type OfficeState,type WorldPacket,type CharacterState} from './shared.js';

export interface Socket{send(text:string):number|void;close(code?:number,reason?:string):void}
export type SavedSession={secret:string;id:string;name:string;residentId?:string;state?:CharacterState;discovered?:number};
type Link={id:string;socket:Socket;session:SavedSession;editor:boolean;hello:boolean;controller:boolean;publishing:boolean;entry:'office'|'street';commands:Record<string,unknown>[];results:Map<string,unknown>;roster:string;sentLayout:number;blocked:boolean;pending?:string;lastMessage:number};
export function createWorldHost({seed=29,epoch=Date.now(),saved=[] as SavedSession[],layout=null as OfficeState|null,now=()=>performance.now()}={}){
 const world=new BuildingWorld(seed,epoch),game=new ThegameAuthority({seed},epoch,false,world),lift=new BuildingLift(world),links=new Map<Socket,Link>(),sessions=new Map(saved.map(s=>[s.secret,s])),controllers=new Map<string,Link>();
 if(layout)world.setLayout(layout);
 let sequence=0;const stats={connections:0,rejected:0,published:0,backpressure:0,replaced:0};
 const layoutRequests:{state:unknown;resolve:(revision:number)=>void;reject:(error:Error)=>void}[]=[];
 function applyLayout(raw:unknown):number{
  const next=readOfficeState(raw);if(world.layout&&next.revision<world.layout.revision)throw new Error('Stale office revision');
  if(world.layout&&JSON.stringify([next.revision,next.activeFloor,next.floors,next.objects])===JSON.stringify([world.layout.revision,world.layout.activeFloor,world.layout.floors,world.layout.objects]))return world.layoutRevision;
  const candidate=new BuildingWorld(seed,epoch);Object.assign(candidate.lift,world.lift);candidate.setLayout(next);
  try{if([...game.peers.values()].some(p=>candidate.blocked(p.state.x,p.state.y,p.state.z,1.8,.29)))throw new Error('Office edit intersects an occupant');}finally{candidate.dispose();}
  world.setLayout(next);for(const link of links.values())link.sentLayout=-1;return world.layoutRevision;
 }
 function send(l:Link,message:unknown,state=false):void{const text=JSON.stringify(message);if(state&&l.blocked){if(l.pending)stats.replaced++;l.pending=text;return;}const result=l.socket.send(text);if(result===-1){stats.backpressure++;l.blocked=true;}else if(result===0){l.socket.close(1011,'Send failed');}}
 function peer(l:Link):Peer|undefined{return game.peers.get(l.session.id);}
 function save(l:Link):void{const p=peer(l);if(!p)return;l.session.state=lift.recover(p.state);l.session.residentId=p.residentId;l.session.discovered=p.discovered;l.session.name=p.name;}
 function setControl(l:Link,enabled:boolean):void{
  if(enabled){
   const old=controllers.get(l.session.id);if(old&&old!==l){old.controller=false;old.publishing=false;send(old,{type:'control',controlling:false,inputSequence:peer(old)?.received??0});}
   let p=peer(l);
   if(!p){p=game.join(l.session.id,l.session.name,l.session.state?{state:l.session.state,discovered:l.session.discovered??0,...(l.session.residentId?{residentId:l.session.residentId}:{})}:undefined);if(!l.session.state){if(l.entry==='office'&&l.editor)Object.assign(p.state,world.officeSpawn(game.peers.size-1));else{const spawn=world.spawn(game.peers.size-1);Object.assign(p.state,characterState(spawn.x,spawn.y,spawn.z,Math.PI));}}}
   p.inputs.length=0;p.received=p.ack;controllers.set(l.session.id,l);l.controller=true;
  }else{const owned=controllers.get(l.session.id)===l;if(owned)controllers.delete(l.session.id);l.controller=false;l.publishing=false;const p=peer(l);if(p&&owned){p.inputs.length=0;p.received=p.ack;}save(l);}
  send(l,{type:'control',controlling:l.controller,inputSequence:peer(l)?.received??0,actorId:peer(l)?.residentId});voiceRosters();
 }
 function observation(l:Link):[number,number,number]{const p=l.controller?peer(l):undefined;return p?[p.state.x,p.state.y,p.state.z]:worldPoint(world.binding,[0,0,0],world.binding.officeFloor+(world.layout?.floors.findIndex(f=>f.id===world.layout?.activeFloor)??0));}
 function eligible(a:Link,b:Link):boolean{const p=observation(a),q=observation(b);return Math.hypot(p[0]-q[0],p[2]-q[2])<36&&Math.abs(p[1]-q[1])<2.5;}
 function voiceRosters():void{
  const ready=[...links.values()].filter(l=>l.hello);
  for(const l of ready){const peers=ready.filter(other=>other!==l&&(other.publishing||l.publishing)&&eligible(l,other)).map(other=>({id:other.id,actorId:peer(other)?.residentId??`observer:${other.id}`,publishing:other.publishing}));const key=JSON.stringify(peers);if(key!==l.roster){l.roster=key;send(l,{type:'voice-peers',selfId:l.id,peers});}}
 }
 function packet(l:Link):WorldPacket{
  const eye=observation(l),p=peer(l),time=game.tick/60,stamp={epoch,sequence:++sequence,tick:game.tick,time,paused:false},players=[...game.peers.values()].filter(other=>Math.hypot(other.state.x-eye[0],other.state.z-eye[2])<512);
  const seen=new Set(players.map(p=>p.residentId)),rows=players.map(p=>({id:p.residentId,data:{position:[p.state.x,p.state.y,p.state.z] as const,yaw:p.state.yaw,phase:p.state.phase,speed:p.state.speed,kind:0}}));
  for(const row of game.npcs.rowsAround({x:eye[0],z:eye[2]},512,96-rows.length))if(!seen.has(row.id)){rows.push(row);seen.add(row.id);}
  for(const passenger of game.transit.passengersState()){
   if(seen.has(passenger.residentId)||rows.length>=96)continue;const service=game.transit.serviceForTransitResident(passenger.residentId,time),promoted=service?game.transitVehicles.servicePose(service.id,time):undefined,pose=game.transit.passengerPose(passenger.residentId,time,promoted?{position:promoted.position,yaw:promoted.yaw,speed:promoted.speed}:undefined);
   if(pose&&Math.hypot(pose.position[0]-eye[0],pose.position[2]-eye[2])<512){rows.push({id:passenger.residentId,data:{position:pose.position,yaw:pose.yaw,phase:0,speed:pose.speed,kind:1}});seen.add(passenger.residentId);}
  }
  for(const row of materializeCrowd(world,[],{x:eye[0],z:eye[2]},game.tick,Math.min(48,96-rows.length)))if(!seen.has(row.id)&&!game.npcs.has(row.id)&&!game.transit.hasResident(row.id)&&Math.hypot(row.data.position[0]-eye[0],row.data.position[2]-eye[2])<512){rows.push(row);seen.add(row.id);}
  const traffic=game.transitVehicles.frame(stamp,{x:eye[0],z:eye[2]},time),vehicles=vehiclesProjection.capture(stamp,traffic.rows.map(r=>({id:r.id,data:{position:[r.values[0]!,r.values[1]!,r.values[2]!] as const,yaw:r.values[3]!,speed:r.values[4]!,mode:r.values[6]!,doors:r.values[5]!}})));
  const minute=480+time*.3,result:WorldPacket={type:'world',binding:{...world.binding},tick:game.tick,time,worldMinute:minute,actors:actorsProjection.capture(stamp,rows),vehicles,names:rows.map(r=>({id:r.id,residentId:r.id,name:players.find(p=>p.residentId===r.id)?.name??'Житель'})),lift:{...world.lift},weather:serverWeather(minute,seed),layoutRevision:world.layoutRevision};
  if(l.controller&&p)result.self={id:p.residentId,position:[p.state.x,p.state.y,p.state.z],yaw:p.state.yaw,ack:p.ack,state:{...p.state}};return result;
 }
 function execute(l:Link,c:Record<string,unknown>):void{
  if(c.type==='control'){if(typeof c.enabled!=='boolean')throw new Error('Invalid control mode');setControl(l,c.enabled);return;}
  if(c.type==='voice'){if(typeof c.enabled!=='boolean'||c.enabled&&!l.controller)throw new Error('Enter the world before publishing voice');l.publishing=!!c.enabled;send(l,{type:'voice',enabled:l.publishing});voiceRosters();return;}
  if(c.type==='layout'){if(!l.editor)throw new Error('Editor access required');applyLayout(c.state);return;}
  if(c.type==='lift'){
   const id=c.commandId;if(typeof id!=='string'||!/^[A-Za-z0-9_:-]{1,100}$/.test(id))throw new Error('Invalid command id');if(l.results.has(id)){send(l,l.results.get(id));return;}
   const p=l.controller?peer(l):undefined,ok=!!p&&typeof c.floor==='number'&&lift.request(p,c.floor,game.tick/60),result={type:'command',commandId:id,ok,...(!ok?{error:'Войдите в кабину; снаружи можно вызвать только свой этаж.'}:{})};
   if(l.results.size>=128)l.results.delete(l.results.keys().next().value!);l.results.set(id,result);send(l,result);return;
  }throw new Error('Unknown command');
 }
 return{
  game,world,lift,stats,
  session(secret:string|null):{session:SavedSession;fresh:boolean}{const found=secret?sessions.get(secret):undefined;if(found)return{session:found,fresh:false};if(sessions.size>=512)throw new Error('Session capacity');const session:SavedSession={secret:randomBytes(32).toString('hex'),id:'p'+randomBytes(8).toString('hex'),name:'Игрок'};sessions.set(session.secret,session);return{session,fresh:true};},
  open(socket:Socket,session:SavedSession,editor=false):void{if(links.size>=64){socket.close(1013,'World capacity');return;}links.set(socket,{id:'c'+randomBytes(8).toString('hex'),socket,session,editor,hello:false,controller:false,publishing:false,entry:'street',commands:[],results:new Map(),roster:'',sentLayout:-1,blocked:false,lastMessage:now()});stats.connections++;},
  message(socket:Socket,text:string):void{
   const l=links.get(socket);if(!l)return;l.lastMessage=now();
   try{
    if(text.length>750000)throw new Error('Packet limit');const c=JSON.parse(text) as Record<string,unknown>;if(!c||Array.isArray(c))throw new Error('Invalid message');
    if(c.type==='hello'){
     if(l.hello||!['player','observer'].includes(String(c.role)))throw new Error('Invalid hello');l.entry=c.entry==='office'?'office':'street';l.session.name=typeof c.name==='string'?c.name.replace(/[<>\u0000-\u001f]/g,'').slice(0,24)||'Игрок':l.session.name;l.hello=true;
     if(c.role==='player')setControl(l,true);send(l,{type:'welcome',binding:world.binding,layout:world.layout,controlling:l.controller,actorId:peer(l)?.residentId,inputSequence:peer(l)?.received??0});voiceRosters();return;
    }
    if(!l.hello)throw new Error('Hello required');if(c.type==='ping'){send(l,{type:'pong'});return;}
    if(c.type==='input'){if(!l.controller||controllers.get(l.session.id)!==l)throw new Error('Controller required');game.enqueue(l.session.id,c.items);return;}
    if(c.type==='signal'){const target=[...links.values()].find(t=>t.id===c.to);if(!target||!eligible(l,target)||!l.publishing&&!target.publishing||JSON.stringify(c.value).length>16000)throw new Error('Voice peer not permitted');send(target,{type:'signal',from:l.id,actorId:peer(l)?.residentId??`observer:${l.id}`,value:c.value});return;}
    if(l.commands.length>=64)throw new Error('Command queue capacity');l.commands.push(c);
   }catch(error){stats.rejected++;send(l,{type:'error',message:String((error as Error).message)});}
  },
  step():void{
   for(const request of layoutRequests.splice(0,4))try{request.resolve(applyLayout(request.state));}catch(error){request.reject(error as Error);}
   for(const l of links.values()){for(const c of l.commands.splice(0,8))try{execute(l,c);}catch(error){stats.rejected++;send(l,{type:'error',message:String((error as Error).message)});}}
   if([...links.values()].some(l=>l.hello&&!l.controller))game.npcs.refresh([...game.peers.values(),{id:'observer:office',state:characterState(...worldPoint(world.binding,[0,0,12]))}],game.tick+1);
   lift.step(game.peers.values());game.step();
   if(game.tick%3===0){voiceRosters();for(const l of links.values())if(l.hello){if(l.sentLayout!==world.layoutRevision){send(l,{type:'layout',layout:world.layout,layoutRevision:world.layoutRevision});l.sentLayout=world.layoutRevision;}send(l,packet(l),true);stats.published++;}}
   for(const l of links.values())if(now()-l.lastMessage>15000)l.socket.close(1001,'Heartbeat timeout');
  },
  drain(socket:Socket):void{const l=links.get(socket);if(l){l.blocked=false;if(l.pending){const text=l.pending;delete l.pending;const result=socket.send(text);if(result===-1)l.blocked=true;else if(result===0)socket.close(1011,'Send failed');}}},
  close(socket:Socket):void{const l=links.get(socket);if(!l)return;save(l);if(controllers.get(l.session.id)===l)controllers.delete(l.session.id);links.delete(socket);if(![...links.values()].some(other=>other.session.id===l.session.id)){game.leave(l.session.id);lift.forget(l.session.id);}voiceRosters();},
  checkpoint():SavedSession[]{for(const l of links.values())save(l);return[...sessions.values()].map(s=>structuredClone(s));},
  layout(state:unknown):void{applyLayout(state);},
  queueLayout(state:unknown):Promise<number>{if(layoutRequests.length>=16)return Promise.reject(new Error('Editor queue capacity'));const validated=readOfficeState(state);return new Promise((resolve,reject)=>layoutRequests.push({state:validated,resolve,reject}));},
  inspect(){return{seed,epoch,revision:world.binding.revision,tick:game.tick,players:game.peers.size,observers:[...links.values()].filter(l=>l.hello&&!l.controller).length,building:world.binding,lift:world.lift,layoutRevision:world.layoutRevision,...stats};},
  dispose():void{for(const request of layoutRequests.splice(0))request.reject(new Error('Server stopping'));for(const l of links.values())l.socket.close(1001,'Server stopping');links.clear();game.dispose();},
 };
}
