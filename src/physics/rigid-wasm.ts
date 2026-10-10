import type {RigidBody,ContactCandidate,CollisionHit,RigidContactKernel} from './world.js';

/** ABI for world-rigid Rust/WASM: two 32-f64 temporary body records,
 * one 16-f64 result record. The JS world remains the source of truth.
 * No interpreter or asynchronous work occurs during contact evaluation. */
const STRIDE=32,RECORDS=2,RESULT=16,MAX_BATCH=256,BATCH_OUTPUT_STRIDE=16;

interface WasmRigidExports{
  readonly memory:WebAssembly.Memory;
  world_rigid_new():number;
  world_rigid_free(handle:number):void;
  world_rigid_input(handle:number):number;
  world_rigid_output(handle:number):number;
  world_rigid_intersect(handle:number):number;
  world_rigid_resolve(handle:number):number;
  world_rigid_batch_input(handle:number):number;
  world_rigid_batch_output(handle:number):number;
  world_rigid_batch_resolve(handle:number,count:number):number;
}
function rigidExports(instance:WebAssembly.Instance):WasmRigidExports{
  const e=instance.exports as Record<string,unknown>;
  if(!(e.memory instanceof WebAssembly.Memory))throw new TypeError('Rust rigid ABI missing linear memory');
  for(const key of ['world_rigid_new','world_rigid_free','world_rigid_input','world_rigid_output','world_rigid_intersect','world_rigid_resolve',
    'world_rigid_batch_input','world_rigid_batch_output','world_rigid_batch_resolve'])
    if(typeof e[key]!=='function')throw new TypeError('Rust rigid ABI missing '+key);
  return instance.exports as unknown as WasmRigidExports;
}
function finiteBuffer(pointer:number,numbers:number,memory:ArrayBuffer,label:string):Float64Array{
  if(!pointer||pointer%8!==0||pointer+numbers*8>memory.byteLength)
    throw new RangeError('Rust rigid ABI returned invalid '+label+' offset');
  return new Float64Array(memory,pointer,numbers);
}
function writeBody(data:Float64Array,at:number,body:RigidBody):void{
  data.set(body.position,at);
  data.set(body.rotation,at+3);
  data.set(body.velocity,at+6);
  data.set(body.angularVelocity,at+9);
  data[at+12]=body.invMass;
  data.set(body.invInertiaLocal,at+13);
  data[at+16]=body.shape.kind==='sphere'?0:1;
  if(body.shape.kind==='sphere'){
    data[at+17]=body.shape.radius;
    data[at+18]=0;data[at+19]=0;
  }else data.set(body.collisionHalf??body.shape.half,at+17);
  data.set(body.collisionOffsetLocal,at+20);
  data[at+23]=body.restitution;data[at+24]=body.friction;
}
function readBody(data:Float64Array,at:number,body:RigidBody):void{
  // Update original body-owned arrays in-place: vehicle/control/render users
  // retain their references. No new authoritative scene or body instance.
  for(let i=0;i<3;i++){
    body.position[i]=data[at+i]!;
    body.velocity[i]=data[at+6+i]!;
    body.angularVelocity[i]=data[at+9+i]!;
  }
}

/** Reuse compiled wasm module across worlds; each world gets a dedicated
 * instance/arena, making re-entrant World stepping deterministic. */
export async function createWasmRigidContactKernel(
  source:WebAssembly.Module|Uint8Array|ArrayBuffer,
):Promise<RigidContactKernel>{
  const module=source instanceof WebAssembly.Module?source:
    await WebAssembly.compile(source instanceof Uint8Array?Uint8Array.from(source).buffer:source);
  const instance=await WebAssembly.instantiate(module,{
    math:{hypot:Math.hypot,sin:Math.sin,cos:Math.cos},
  });
  const wasm=rigidExports(instance),handle=wasm.world_rigid_new()>>>0;
  if(!handle)throw new Error('Could not create Rust rigid contact scratch');
  let disposed=false;
  try{
    const memory=wasm.memory,buffer=memory.buffer;
    const input=finiteBuffer(wasm.world_rigid_input(handle)>>>0,STRIDE*RECORDS,buffer,'input');
    const output=finiteBuffer(wasm.world_rigid_output(handle)>>>0,RESULT,buffer,'output');
    const batchInput=finiteBuffer(wasm.world_rigid_batch_input(handle)>>>0,(MAX_BATCH+1)*STRIDE,buffer,'batch input');
    const batchOutput=finiteBuffer(wasm.world_rigid_batch_output(handle)>>>0,MAX_BATCH*BATCH_OUTPUT_STRIDE,buffer,'batch output');
    const check=()=>{if(disposed)throw new Error('Rust rigid contact kernel was disposed');
      if(memory.buffer!==buffer)throw new Error('Rust rigid contact memory grew during simulation');};
    const set=(a:RigidBody,b:RigidBody)=>{writeBody(input,0,a);writeBody(input,STRIDE,b);};
    return{
      maxBatchSize:MAX_BATCH,
      batch(a,others){
        check();
        if(others.length>MAX_BATCH)throw new RangeError('Rigid batch exceeds fixed solver capacity');
        if(others.some(body=>body===a)||new Set(others).size!==others.length)
          throw new TypeError('Rigid batches require distinct body candidates excluding A');
        writeBody(batchInput,0,a);
        for(let i=0;i<others.length;i++)writeBody(batchInput,(i+1)*STRIDE,others[i]!);
        const count=wasm.world_rigid_batch_resolve(handle,others.length)>>>0;
        if(count>others.length)throw new Error('Invalid Rust rigid batch hit count');
        const result=[];
        let hits=0,anyWakeA=false;
        for(let i=0;i<others.length;i++){
          const at=i*BATCH_OUTPUT_STRIDE;
          if(batchOutput[at]!==1)continue;
          hits++;
          const b=others[i]!;
          const hit:CollisionHit={
            normal:[batchOutput[at+1]!,batchOutput[at+2]!,batchOutput[at+3]!],
            penetration:batchOutput[at+4]!,
            point:[batchOutput[at+5]!,batchOutput[at+6]!,batchOutput[at+7]!],
            approachSpeed:batchOutput[at+8]!,
            effectiveMass:batchOutput[at+13]!,
            normalEnergy:batchOutput[at+9]!,
          };
          const impulse=batchOutput[at+10]!;
          if(![...hit.normal,hit.penetration,...hit.point,hit.approachSpeed,hit.normalEnergy,impulse].every(Number.isFinite))
            throw new Error('Nonfinite native batch contact');
          readBody(batchInput,(i+1)*STRIDE,b);
          if(batchOutput[at+12])b.wake();
          anyWakeA||=batchOutput[at+11]!==0;
          result.push({b,hit,impulse});
        }
        if(hits!==count)throw new Error('Rust rigid batch hit count mismatch');
        if(hits)readBody(batchInput,0,a);
        if(anyWakeA)a.wake();
        return result;
      },
      test(a,b){
        check();set(a,b);
        if(wasm.world_rigid_intersect(handle)!==1)return null;
        const hit:CollisionHit={
          normal:[output[0]!,output[1]!,output[2]!],
          penetration:output[3]!,
          point:[output[4]!,output[5]!,output[6]!],
          approachSpeed:output[7]!,
          effectiveMass:output[8]!,
          normalEnergy:output[9]!,
        };
        if(![...hit.normal,hit.penetration,...hit.point,hit.approachSpeed,hit.effectiveMass,hit.normalEnergy].every(Number.isFinite))
          throw new Error('Rust rigid kernel returned non-finite contact');
        return hit;
      },
      resolve(contact:ContactCandidate){
        check();
        const {a,b}=contact;
        set(a,b);
        output.set(contact.normal,0);
        output[3]=contact.penetration;
        output.set(contact.point,4);
        output[7]=contact.approachSpeed;output[8]=contact.effectiveMass;
        if(wasm.world_rigid_resolve(handle)!==1)
          throw new Error('Rust rigid solver rejected contact');
        readBody(input,0,a);
        readBody(input,STRIDE,b);
        if(output[11])a.wake();
        if(output[12])b.wake();
        const impulse=output[10]!;
        if(!Number.isFinite(impulse))throw new Error('Rust rigid solver produced nonfinite impulse');
        return impulse;
      },
      dispose(){if(disposed)return;disposed=true;wasm.world_rigid_free(handle);},
    };
  }catch(error){wasm.world_rigid_free(handle);throw error;}
}
