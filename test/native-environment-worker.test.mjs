import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {NativeEnvironmentWorker} from '../tools/native/environment-worker.mjs';
import {bakeEnvironmentMap} from '../dist/render/environment-map.js';
const input={radiance:{origin:[0,1,0],background:[.3,.4,.5],ground:[.2,.2,.2],proxies:[]},sun:[0,1,0],sunColor:[1,.9,.7],sky:[.2,.3,.4],intensity:2};
const digest=data=>{const hash=createHash('sha256');hash.update(data.irradiance);for(const mip of data.mips)hash.update(mip);return hash.digest('hex');};
test('native thread transfers exact lighting buffers without DOM or GPU',async()=>{
 const worker=new NativeEnvironmentWorker();try{
  const response=new Promise((yes,no)=>{worker.onmessage=e=>yes(e.data);worker.onerror=e=>no(e.error);});worker.postMessage(input);const result=await response;
  assert.equal(digest(result),digest(bakeEnvironmentMap(input)));assert.equal(worker.inspect().completed,1);assert.equal(worker.inspect().transferredBytes,4194288+144);
 }finally{await worker.terminate();}assert.equal(worker.inspect().disposed,true);
});
test('missing worker entry reports failure instead of hanging',async()=>{
 const worker=new NativeEnvironmentWorker(new URL('./missing-native-worker.mjs',import.meta.url));
 try{const error=await new Promise(resolve=>{worker.onerror=e=>resolve(e.error);});assert.ok(error instanceof Error);assert.equal(worker.inspect().failed,true);}finally{await worker.terminate();}
});
