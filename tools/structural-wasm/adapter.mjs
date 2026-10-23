import assert from 'node:assert/strict';
import {StructuralBody} from '../../dist/physics/structure.js';

// Explicit experiment ABI. Private TS fields are read only by this experiment;
// a renamed/retyped field fails here, never silently produces a different solver.
export const fields=['position','previous','velocity','force','mass','inverseMass','originalPosition','kind','ia','ib','ic','id','originalRest','rest','compliance','yieldLimit','breakLimit','plasticity','yieldForce','lambda','predictedMeasure','impulseWeights','broken'];
export function wasmBody(module,definition){
  const body=new StructuralBody(definition),instance=new WebAssembly.Instance(module,{math:{hypot:Math.hypot,exp:Math.exp,pow:Math.pow}});
  const {memory,step,__heap_base:heapBase}=instance.exports;
  assert.ok(memory instanceof WebAssembly.Memory&&typeof step==='function');
  let cursor=Number(heapBase.value);const offsetPointer=cursor;cursor+=fields.length*4;cursor=Math.ceil(cursor/8)*8;
  const scalarPointer=cursor;cursor+=24;const allocations=[];
  for(const field of fields){
    const value=body[field],type=['kind','broken'].includes(field)?Uint8Array:['ia','ib','ic','id'].includes(field)?Uint16Array:Float64Array;
    assert.ok(value instanceof type,`Structural ABI changed: ${field} must be ${type.name}`);
    cursor=Math.ceil(cursor/8)*8;allocations.push({field,value,pointer:cursor});cursor+=value.byteLength;
  }
  const pages=Math.ceil(cursor/65536);if(pages>memory.buffer.byteLength/65536)memory.grow(pages-memory.buffer.byteLength/65536);
  const offsets=new Uint32Array(memory.buffer,offsetPointer,fields.length),scalars=new Float64Array(memory.buffer,scalarPointer,3);
  allocations.forEach(({field,value,pointer},index)=>{offsets[index]=pointer;const view=new value.constructor(memory.buffer,pointer,value.length);view.set(value);body[field]=view;});
  body.step=function(dt,gravity=[0,-9.81,0],contactProjector){
    if(this.mode==='dormant')return;
    if(contactProjector)throw new Error('This experiment does not port external contact-projector callbacks');
    if(!Number.isFinite(dt)||dt<=0||dt>1/30)throw new RangeError('Structural dt must be in (0, 1/30]');
    if(!gravity.every(Number.isFinite))throw new TypeError('Structural gravity must be finite');
    this.dt=dt;scalars[0]=this.plasticWorkJ;scalars[1]=this.quietTime;scalars[2]=this.steps;
    const bake=step(this.nodeCount,this.constraintCount,this.iterations,offsetPointer,scalarPointer,dt,...gravity,this.internalDamping,this.thermalScale,this.sleepSpeed,this.sleepDelay);
    this.plasticWorkJ=scalars[0];this.quietTime=scalars[1];this.steps=scalars[2];if(bake)this.bake();
  };
  return {body,memory,logicalBufferBytes:allocations.reduce((total,{value})=>total+value.byteLength,0),arenaBytes:cursor-Number(heapBase.value)};
}
