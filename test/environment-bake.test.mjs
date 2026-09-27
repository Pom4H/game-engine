import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {bakeEnvironment} from '../dist/render/environment-bake.js';
import {EnvironmentBaker} from '../dist/render/environment-jobs.js';
const input={sun:[0,1,0],sunColor:[1,.9,.8],sky:[.2,.3,.5],intensity:3,
 radiance:{origin:[10,20,30],background:[.1,.2,.3],ground:[.05,.04,.03],proxies:[{direction:[1,0,0],color:[.8,.1,.05],threshold:.9,strength:1.5}]}};
function mock(){return{onmessage:null,onerror:null,sent:[],dead:false,postMessage(v){this.sent.push(v);},terminate(){this.dead=true;}};}
test('environment bake retains every old 256px face, nine mips and exact half-float bytes',()=>{
 const mips=bakeEnvironment(input),h=createHash('sha256');for(const m of mips)h.update(new Uint8Array(m.pixels.buffer));
 assert.equal(mips.length,9);assert.equal(mips.reduce((n,m)=>n+m.pixels.byteLength,0),4194288);
 assert.deepEqual(mips.map(m=>m.size),[256,128,64,32,16,8,4,2,1]);
 assert.equal(h.digest('hex'),'2c3060f3caeed7ac3dd31389c443e6aa4b844ac24f62e71053e78be631e78739');
});
test('background bake coalesces requests and publishes only complete results',()=>{
 const w=mock(),jobs=new EnvironmentBaker(e=>{throw e;},()=>w);jobs.request('a',input);for(let i=0;i<100;i++)jobs.request('pending'+i,input);
 assert.equal(w.sent.length,1);assert.equal(jobs.inspect().active,1);assert.equal(jobs.inspect().pending,1);assert.equal(jobs.take(),undefined);
 const first=w.sent[0];w.onmessage({data:{...first,mips:[{mip:0,size:1,pixels:new Uint16Array(24)}]}});
 assert.equal(jobs.take().key,'a');assert.equal(w.sent.length,2);assert.equal(w.sent[1].key,'pending99');jobs.dispose();assert.ok(w.dead);
});
test('returning to an active request drops obsolete pending origin; reset rejects old scene completion',()=>{
 const w=mock(),jobs=new EnvironmentBaker(e=>{throw e;},()=>w);jobs.request('a',input);jobs.request('b',input);jobs.request('a',input);assert.equal(jobs.inspect().pending,0);
 const old=w.sent[0];jobs.reset();w.onmessage({data:{...old,mips:[]}});assert.equal(jobs.take(),undefined);assert.equal(jobs.inspect().active,0);jobs.dispose();
});
test('worker failure is visible, bounded and does not fall back to a synchronous per-frame bake',()=>{
 const w=mock(),errors=[],jobs=new EnvironmentBaker(e=>errors.push(e),()=>w);jobs.request('a',input);w.onerror({message:'worker unavailable'});
 for(let i=0;i<100;i++)jobs.request(String(i),input);assert.equal(errors.length,1);assert.equal(w.sent.length,1);assert.equal(jobs.inspect().failed,true);jobs.dispose();
});
