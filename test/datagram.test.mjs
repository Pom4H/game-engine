import test from 'node:test';import assert from 'node:assert/strict';
import {CarBallArena,arenaDatagram,arenaProjection} from '../dist/examples/car-ball.js';
import {SnapshotDatagram,DatagramOutbox} from '../dist/network/datagram.js';
import {encodeArcadeInput,decodeArcadeInput} from '../dist/network/arcade-wire.js';
import {Replica} from '../dist/network/playback.js';
import {idleInput} from '../dist/vehicles/arcade.js';
import {quaternionFromEuler} from '../dist/physics/rotation.js';
import {projection,buffer} from '../dist/network/projection.js';
const stamp=a=>({epoch:1770000000000,sequence:a.tick+1,tick:a.tick,time:a.time,paused:false});
test('complete coherent binary state, including all soft nodes, fits one datagram; precise fields and quantified error',t=>{
 const a=new CarBallArena();a.phase=1;let maxError=0,jsonBytes=0;
 const replica=new Replica(arenaProjection,1770000000000,1000);let saved;
 for(let i=0;i<180;i++){
  a.input(0,i+1,{...idleInput(),throttle:1,boost:true});a.step();if(i%2)continue;
  const frame=a.capture(stamp(a)),packet=arenaDatagram.encode(frame),got=arenaDatagram.decode(packet);saved=packet;jsonBytes=Math.max(jsonBytes,new TextEncoder().encode(JSON.stringify(frame)).length);
  for(const entry of arenaProjection.layout)for(let j=0;j<entry.field.width;j++){
   const x=frame.rows[0].values[entry.offset+j],y=got.rows[0].values[entry.offset+j],error=Math.abs(x-y);
   if(entry.field.integer)assert.equal(x,y);else {const bound=entry.name==='nodes'?.00051:Math.max(1e-12,Math.abs(x)*2**-24);assert.ok(error<=bound, `${entry.name}: ${error} > ${bound}`);};if(entry.name==='nodes')maxError=Math.max(maxError,error);
  }
  assert.equal(got.epoch,frame.epoch);assert.equal(got.tick,frame.tick);replica.receive(got,frame.time);
 }
 assert.ok(arenaDatagram.size<=1200);assert.equal(replica.receive(arenaDatagram.decode(saved),999),false);
 t.diagnostic(JSON.stringify({datagramBytes:arenaDatagram.size,jsonBytes,maxNodeComponentError:maxError,stateBytesPerSecondAt60Hz:arenaDatagram.size*60}));a.dispose();
});
test('drop/reordering never combines a new car pose with old soft-body nodes; corrupted frames are atomic',()=>{
 const a=new CarBallArena(),frames=[];for(let i=0;i<24;i++){a.step();frames.push(arenaDatagram.encode(a.capture(stamp(a))));}
 const replica=new Replica(arenaProjection,1770000000000);for(const i of [0,2,6,5,10,22,21,23])replica.receive(arenaDatagram.decode(frames[i]),i/120);
 assert.equal(replica.latest().tick,24);const before=replica.latest();
 for(const packet of [frames[0].subarray(1),new Uint8Array(1201),new Uint8Array(frames[0].length)])assert.throws(()=>replica.receive(arenaDatagram.decode(packet),1));
 const corrupt=frames[23].slice();new DataView(corrupt.buffer).setFloat32(40,Infinity,true);assert.throws(()=>replica.receive(arenaDatagram.decode(corrupt),1));assert.equal(replica.latest(),before);
 const bad=structuredClone(before);bad.rows[0].values[arenaProjection.layout.find(e=>e.name==='nodes').offset]=1e4;assert.throws(()=>arenaDatagram.encode(bad));
 assert.throws(()=>new SnapshotDatagram(arenaProjection,'arena',{},512));a.dispose();
});
test('input binary preserves independently controlled axes and repeatable jump counter; stale/malformed identity is rejected',()=>{
 const input={...idleInput(),throttle:.56,steer:-1,pitch:.7,roll:-.3,jump:true,boost:true,jumpSerial:101};const bytes=encodeArcadeInput(1770000000000,37,input),got=decodeArcadeInput(bytes);
 assert.equal(bytes.length,28);assert.equal(got.controls.jumpSerial,101);assert.equal(got.sequence,37);assert.equal(got.epoch,1770000000000);
 for(const key of ['throttle','steer','pitch','roll'])assert.ok(Math.abs(got.controls[key]-input[key])<1/127);
 for(const bit of ['boost','slide','jump'])assert.equal(got.controls[bit],input[bit]);
 bytes[27]=1;assert.throws(()=>decodeArcadeInput(bytes));assert.throws(()=>encodeArcadeInput(0,0,input));
});
test('quaternion presentation crosses Euler singularities without choosing a wrong rotation path',()=>{
 const s=projection('q',{r:buffer(4,{sample:'quaternion',min:-1,max:1})}),replica=new Replica(s,1);
 const q=quaternionFromEuler([.2,Math.PI/2,.3]),frame=(t,r)=>s.capture({epoch:1,sequence:t,tick:t,time:t,paused:false},[{id:'x',data:{r}}]);
 replica.receive(frame(0,q),0);replica.receive(frame(1,q.map(x=>-x)),1);const got=replica.at(.5).rows[0].values;
 assert.ok(Math.abs(Math.abs(q.reduce((sum,x,k)=>sum+x*got[k],0))-1)<1e-12);assert.throws(()=>frame(2,new Float64Array(4)));
});
test('slow datagram sender retains at most one active and one latest packet; expired pending state is dropped',async()=>{
 let now=0,release;const sent=[],errors=[],out=new DatagramOutbox(async b=>{sent.push(b[0]);await new Promise(r=>release=r);},()=>now,50,e=>errors.push(e));
 out.offer(new Uint8Array([1]));out.offer(new Uint8Array([2]));out.offer(new Uint8Array([3]));assert.equal(out.queued,2);assert.equal(out.stats.replaced,1);now=70;release();await new Promise(r=>setImmediate(r));assert.deepEqual(sent,[1]);assert.equal(out.stats.expired,1);
 out.offer(new Uint8Array([4]));release();await new Promise(r=>setImmediate(r));assert.deepEqual(sent,[1,4]);out.close();out.offer(new Uint8Array([5]));assert.equal(out.queued,0);assert.deepEqual(errors,[]);
});
