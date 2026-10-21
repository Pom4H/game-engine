import {test,expect} from 'bun:test';
import {createWorldHost,type Socket} from '../host.ts';
import {worldPoint,actorsProjection,vehiclesProjection,type OfficeState,type WorldPacket} from '../shared.ts';
import {characterState,idleCharacterInput} from '../../../src/runtime/character-motor.ts';
import {materializeCrowd} from '../game/crowd.ts';

class TestSocket implements Socket{
 messages:Record<string,any>[]=[];closed:{code?:number;reason?:string}[]=[];
 send(text:string){this.messages.push(JSON.parse(text));return 1;}
 close(code?:number,reason?:string){this.closed.push({code,reason});}
 last(type:string){return this.messages.findLast(m=>m.type===type);}
}
function fixture(){
 const host=createWorldHost({seed:29,epoch:1,now:()=>0});
 const connect=(role:'player'|'observer',session=host.session(null).session,editor=false,entry='street')=>{const socket=new TestSocket();host.open(socket,session,editor);host.message(socket,JSON.stringify({type:'hello',role,entry,name:'Гость'}));return{socket,session};};
 const message=(socket:TestSocket,value:unknown)=>host.message(socket,JSON.stringify(value));
 const ticks=(n=3)=>{for(let i=0;i<n;i++)host.step();};
 return{host,connect,message,ticks};
}
const blank=():OfficeState=>({version:1,revision:0,floors:[{id:'main',name:'Офис',wallpaper:'ivory'}],objects:[],activeFloor:'main',selection:null});

test('office observers create no player and see each visiting resident exactly once with server weather and traffic',()=>{
 const f=fixture(),observer=f.connect('observer'),visitor=f.connect('player',undefined,true,'office');
 expect(f.host.game.peers.size).toBe(1);const peer=f.host.game.peers.get(visitor.session.id)!;
 f.ticks(6);const packet=observer.socket.last('world') as WorldPacket;
 expect(packet.self).toBeUndefined();expect(actorsProjection.read(packet.actors).rows.filter(r=>r.id===peer.residentId)).toHaveLength(1);
 expect(new Set(packet.actors.rows.map(r=>r.id)).size).toBe(packet.actors.rows.length);
 expect(vehiclesProjection.read(packet.vehicles).rows.length).toBeGreaterThan(0);
 expect(packet.weather).toEqual(visitor.socket.last('world')!.weather);expect(packet.lift).toEqual(visitor.socket.last('world')!.lift);
 expect(f.host.inspect().observers).toBe(1);f.host.dispose();
});

test('a real street session walks through server controls, rides into Office, and returns while its observer sees the same actor',()=>{
 const f=fixture(),observer=f.connect('observer'),visitor=f.connect('player'),peer=f.host.game.peers.get(visitor.session.id)!,actor=peer.residentId;
 let seq=visitor.socket.last('control')!.inputSequence,command=0;
 const walk=(x:number,z:number)=>{
  const target=worldPoint(f.host.world.binding,[x,0,z]);
  for(let i=0;i<700;i++){
   const dx=target[0]-peer.state.x,dz=target[2]-peer.state.z,d=Math.hypot(dx,dz);
   if(d<.06){f.ticks(12);return;}
   f.message(visitor.socket,{type:'input',items:[{seq:++seq,input:{...idleCharacterInput(Math.atan2(dx,dz)),forward:Math.min(1,d*1.8)}}]});f.ticks(1);
  }
  throw new Error(`Street session did not walk to ${x},${z}`);
 };
 const lift=(floor:number)=>{
  const commandId=`journey:${++command}`;f.message(visitor.socket,{type:'lift',floor,commandId});f.ticks(1);
  expect(visitor.socket.last('command')?.ok).toBe(true);
  for(let i=0;i<1600;i++){if(f.host.world.lift.floor===floor&&f.host.world.lift.phase==='idle'&&f.host.world.lift.door===1)return;f.ticks(1);}
  throw new Error(`Street session lift did not reach ${floor}`);
 };
 expect(f.host.world.toLocal([peer.state.x,peer.state.y,peer.state.z])[2]).toBeGreaterThan(10);
 walk(0,-7.2);lift(0);walk(0,-9.4);lift(2);walk(0,-6.2);f.ticks(3);
 expect(peer.residentId).toBe(actor);expect(peer.state.y).toBeCloseTo(6.6,6);
 const packet=observer.socket.last('world') as WorldPacket,row=packet.actors.rows.find(r=>r.id===actor)!;
 const visitorPacket=visitor.socket.last('world') as WorldPacket;
 expect(row).toBeDefined();expect(row.values[1]).toBeCloseTo(6.6,6);expect(packet.tick).toBe(visitorPacket.tick);expect(row.values[2]).toBe(visitorPacket.self!.state.z);
 walk(0,-9.4);lift(0);walk(0,12);
 expect(peer.residentId).toBe(actor);expect(peer.state.y).toBe(0);expect(f.host.game.peers.size).toBe(1);f.host.dispose();
});

test('one session hands control between street and Office without changing actor identity or acknowledging unexecuted input',()=>{
 const f=fixture(),first=f.connect('player'),peer=f.host.game.peers.get(first.session.id)!,actor=peer.residentId;
 f.message(first.socket,{type:'input',items:[{seq:1,input:{...idleCharacterInput(),forward:1}}]});
 expect(peer.received).toBe(1);expect(peer.ack).toBe(0);
 const next=f.connect('observer',first.session,true,'office');f.message(next.socket,{type:'control',enabled:true});f.ticks(1);
 expect(f.host.game.peers.size).toBe(1);expect(peer.residentId).toBe(actor);expect(first.socket.last('control')?.controlling).toBe(false);
 expect(next.socket.last('control')?.controlling).toBe(true);expect(peer.ack).toBe(0);
 const before={...peer.state};
 f.message(first.socket,{type:'input',items:[{seq:2,input:{...idleCharacterInput(),forward:1}}]});
 expect(first.socket.last('error')?.message).toMatch(/Controller/);expect(peer.received).toBe(0);
 const sequence=next.socket.last('control')!.inputSequence+1;
 f.message(next.socket,{type:'input',items:[{seq:sequence,input:{...idleCharacterInput(),forward:1}}]});
 expect(peer.ack).toBe(0);f.ticks(1);expect(peer.ack).toBe(sequence);expect(peer.state.z).not.toBe(before.z);
 f.host.close(first.socket);expect(f.host.game.peers.get(next.session.id)?.residentId).toBe(actor);f.host.dispose();
});

test('a stale observer relinquishing control cannot cancel the active controller input queue',()=>{
 const f=fixture(),first=f.connect('player'),next=f.connect('observer',first.session),peer=f.host.game.peers.get(first.session.id)!;
 f.message(next.socket,{type:'control',enabled:true});f.ticks(1);
 const sequence=next.socket.last('control')!.inputSequence+1;
 f.message(next.socket,{type:'input',items:[{seq:sequence,input:idleCharacterInput()},{seq:sequence+1,input:idleCharacterInput()}]});
 f.message(first.socket,{type:'control',enabled:false});f.ticks(1);
 expect(peer.ack).toBe(sequence);expect(peer.received).toBe(sequence+1);expect(peer.inputs).toHaveLength(1);
 f.ticks(1);expect(peer.ack).toBe(sequence+1);expect(f.host.game.peers.size).toBe(1);f.host.dispose();
});

test('an Office observer alone anchors walking city residents on authority ticks',()=>{
 const f=fixture(),available=materializeCrowd(f.host.world,[],{x:-224,z:-20},0,48).find(p=>!f.host.game.transit.hasResident(p.id));
 expect(available).toBeDefined();
 // Trusted spatial fixture: place the Office next to an available ambient resident.
 // At the default address the nearest residents are currently owned by transit.
 f.host.world.binding.origin=[available!.data.position[0],0,available!.data.position[2]-12];
 const observer=f.connect('observer');f.ticks(6);
 expect(f.host.game.peers.size).toBe(0);expect(f.host.game.npcs.size).toBeGreaterThan(0);
 const packet=observer.socket.last('world') as WorldPacket;
 expect(packet.actors.rows.some(row=>f.host.game.npcs.has(row.id))).toBe(true);f.host.dispose();
});

test('Office snapshots retain ordinary ambient city residents outside the nearby NPC promotion radius',()=>{
 const f=fixture(),observer=f.connect('observer');f.ticks(6);
 const packet=observer.socket.last('world') as WorldPacket;
 const ordinary=materializeCrowd(f.host.world,[],{x:f.host.world.binding.origin[0],z:f.host.world.binding.origin[2]},packet.tick,48)
  .filter(p=>!f.host.game.transit.hasResident(p.id)&&!f.host.game.npcs.has(p.id));
 expect(ordinary.length).toBeGreaterThan(0);
 expect(packet.actors.rows.some(row=>ordinary.some(p=>p.id===row.id))).toBe(true);f.host.dispose();
});

test('backpressure retains only the latest unsent absolute world and never resends an already queued Bun packet',()=>{
 const f=fixture(),session=f.host.session(null).session;
 class SlowSocket extends TestSocket{
  blockWorld=true;
  override send(text:string){super.send(text);if(this.blockWorld&&JSON.parse(text).type==='world')return-1;return 1;}
 }
 const socket=new SlowSocket();f.host.open(socket,session);f.message(socket,{type:'hello',role:'observer'});
 f.ticks(3);expect(socket.messages.filter(m=>m.type==='world').map(m=>m.tick)).toEqual([3]);
 f.ticks(6);expect(socket.messages.filter(m=>m.type==='world').map(m=>m.tick)).toEqual([3]);
 socket.blockWorld=false;f.host.drain(socket);
 expect(socket.messages.filter(m=>m.type==='world').map(m=>m.tick)).toEqual([3,9]);
 f.host.drain(socket);expect(socket.messages.filter(m=>m.type==='world')).toHaveLength(2);expect(f.host.stats.replaced).toBe(1);f.host.dispose();
});

test('input spoofing is rejected atomically and lift actions require physical proximity',()=>{
 const f=fixture(),visitor=f.connect('player'),observer=f.connect('observer'),peer=f.host.game.peers.get(visitor.session.id)!;
 const before=structuredClone(peer.state);
 f.message(visitor.socket,{type:'input',items:[{seq:1,input:idleCharacterInput()},{seq:2,input:{...idleCharacterInput(),position:[0,99,0]}}]});
 expect(visitor.socket.last('error')?.message).toMatch(/bounded controls/);expect(peer.received).toBe(0);expect(peer.inputs).toHaveLength(0);expect(peer.state).toEqual(before);
 f.message(observer.socket,{type:'input',items:[{seq:1,input:idleCharacterInput()}]});expect(observer.socket.last('error')?.message).toMatch(/Controller/);
 // Trusted fixture: put the visitor outside the lift call radius on the street.
 Object.assign(peer.state,characterState(...worldPoint(f.host.world.binding,[5,0,12])));
 f.message(visitor.socket,{type:'lift',floor:5,commandId:'remote'});expect(visitor.socket.last('command')).toBeUndefined();f.ticks(1);
 expect(visitor.socket.last('command')?.ok).toBe(false);expect(f.host.world.lift.target).toBe(2);
 f.message(observer.socket,{type:'lift',floor:0,commandId:'observer'});f.ticks(1);expect(observer.socket.last('command')?.ok).toBe(false);
 f.host.dispose();
});

for(const initial of [false,true])test(`occupied office rejects layout atomically with ${initial?'an existing':'no existing'} layout`,()=>{
 const f=fixture();if(initial)f.host.layout(blank());const visitor=f.connect('player',undefined,true,'office'),peer=f.host.game.peers.get(visitor.session.id)!;
 // Trusted fixture: a known occupant intersects the proposed desk.
 Object.assign(peer.state,f.host.world.officeSpawn());const before={layout:structuredClone(f.host.world.layout),revision:f.host.world.layoutRevision,binding:structuredClone(f.host.world.binding)};
 const next=blank();next.revision=1;next.objects.push({id:'blocking-desk',floor:'main',kind:'desk',x:-.6,z:-6.2,rotation:0,color:'oak',label:'Стол'});
 f.message(visitor.socket,{type:'layout',state:next});f.ticks(1);
 expect(visitor.socket.last('error')?.message).toMatch(/occupant/);expect(f.host.world.layout).toEqual(before.layout);expect(f.host.world.layoutRevision).toBe(before.revision);expect(f.host.world.binding).toEqual(before.binding);
 expect(f.host.world.blocked(peer.state.x,peer.state.y,peer.state.z,1.8,.29)).toBe(false);f.host.dispose();
});

test('snapshots include server transit residents as well as physically materialized vehicles',()=>{
 const f=fixture(),observer=f.connect('observer');f.ticks(6);
 const packet=observer.socket.last('world') as WorldPacket,eye=worldPoint(f.host.world.binding,[0,0,0],2);
 const nearby=f.host.game.transit.passengersState().filter(p=>{const pose=f.host.game.transit.passengerPose(p.residentId,packet.time);return pose&&Math.hypot(pose.position[0]-eye[0],pose.position[2]-eye[2])<512;});
 expect(nearby.length).toBeGreaterThan(0);expect(packet.vehicles.rows.length).toBeGreaterThan(0);
 expect(packet.actors.rows.some(row=>nearby.some(p=>p.residentId===row.id))).toBe(true);f.host.dispose();
});

test('input ACK advances only on the server tick that executes its canonical motor step',()=>{
 const f=fixture(),visitor=f.connect('player'),peer=f.host.game.peers.get(visitor.session.id)!;
 f.message(visitor.socket,{type:'input',items:[{seq:1,input:idleCharacterInput()},{seq:2,input:idleCharacterInput()},{seq:3,input:idleCharacterInput()}]});
 expect(peer.ack).toBe(0);expect(peer.received).toBe(3);
 for(let ack=1;ack<=3;ack++){f.ticks(1);expect(peer.ack).toBe(ack);}
 const packet=visitor.socket.last('world') as WorldPacket;expect(packet.self?.ack).toBe(3);expect(packet.tick).toBe(3);f.host.dispose();
});

test('voice signaling maps the visitor actor on the Office floor and rejects adjacent-floor or observer publishing',()=>{
 const f=fixture(),observer=f.connect('observer'),visitor=f.connect('player',undefined,true,'office'),peer=f.host.game.peers.get(visitor.session.id)!;
 f.message(visitor.socket,{type:'voice',enabled:true});f.ticks(1);
 const roster=observer.socket.last('voice-peers')!,observerId=roster.selfId;
 expect(roster.peers.some((p:any)=>p.actorId===peer.residentId&&p.publishing)).toBe(true);
 f.message(visitor.socket,{type:'signal',to:observerId,value:{description:{type:'offer',sdp:'test-sdp'}}});
 expect(observer.socket.last('signal')?.actorId).toBe(peer.residentId);
 const signals=observer.socket.messages.filter(m=>m.type==='signal').length;
 // Trusted fixture: the same speaker is now standing on the floor directly above Office.
 Object.assign(peer.state,characterState(...worldPoint(f.host.world.binding,[0,0,-6.2],3)));f.ticks(3);
 expect(observer.socket.last('voice-peers')!.peers.some((p:any)=>p.actorId===peer.residentId)).toBe(false);
 f.message(visitor.socket,{type:'signal',to:observerId,value:{candidate:{candidate:'test'}}});
 expect(visitor.socket.last('error')?.message).toMatch(/permitted/);expect(observer.socket.messages.filter(m=>m.type==='signal')).toHaveLength(signals);
 f.message(observer.socket,{type:'voice',enabled:true});f.ticks(1);
 expect(observer.socket.last('error')?.message).toMatch(/Enter the world/);f.host.dispose();
});
