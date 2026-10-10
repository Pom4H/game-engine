import {
  StructuralBody,STRUCTURAL_KERNEL_FIELDS,
  type StructuralDefinition,type StructuralKernelField,
  type StructuralKernelBuffer,type StructuralNumericalKernel,
} from './structure.js';

interface StructureExports {
  readonly memory:WebAssembly.Memory;
  world_structure_new(nodes:number,constraints:number):number;
  world_structure_free(handle:number):void;
  world_structure_field(handle:number,field:number):number;
  world_structure_scalars(handle:number):number;
  world_structure_step(
    handle:number,iterations:number,dt:number,gx:number,gy:number,gz:number,
    damping:number,thermal:number,sleepSpeed:number,sleepDelay:number,contacts:number,
  ):number;
}
function exportsOf(instance:WebAssembly.Instance):StructureExports{
  const source=instance.exports as Record<string,unknown>;
  if(!(source.memory instanceof WebAssembly.Memory))
    throw new TypeError('World structure WASM must export memory');
  for(const name of ['world_structure_new','world_structure_free','world_structure_field','world_structure_scalars','world_structure_step']){
    if(typeof source[name]!=='function')throw new TypeError('World structure WASM missing '+name);
  }
  return instance.exports as unknown as StructureExports;
}

/** Compiled code may be reused. Each structure gets its own instance and memory.
 * Rust buffers become the *real* StructuralBody buffers before activation.
 * The default TS solver remains available for arbitrary contact projectors.
 */
export async function createWasmStructuralBody(
  definition:StructuralDefinition,source:WebAssembly.Module|ArrayBuffer|Uint8Array,
):Promise<StructuralBody>{
  // Validates all constraints/material properties with existing engine rules.
  const body=new StructuralBody(definition);
  const module=source instanceof WebAssembly.Module?source:
    await WebAssembly.compile(source instanceof Uint8Array?new Uint8Array(source).buffer:source);
  // Supplied host Math.hypot/exp/pow match the production numerical contract.
  const instance=await WebAssembly.instantiate(module,{
    math:{hypot:Math.hypot,exp:Math.exp,pow:Math.pow},
    world:{project:()=>{throw new Error('Unexpected structural callback from Rust');}},
  });
  const wasm=exportsOf(instance);
  const handle=wasm.world_structure_new(body.nodeCount,body.constraintCount)>>>0;
  if(handle===0)throw new RangeError('WASM refused structural node/constraint count');
  let released=false;
  try{
    const memory=wasm.memory,buffer=memory.buffer;
    const buffers={} as Record<StructuralKernelField,StructuralKernelBuffer>;
    for(const [index,key] of STRUCTURAL_KERNEL_FIELDS.entries()){
      const old=(body as unknown as Record<StructuralKernelField,StructuralKernelBuffer>)[key];
      const pointer=wasm.world_structure_field(handle,index)>>>0;
      if(pointer===0||pointer%old.BYTES_PER_ELEMENT!==0||pointer+old.byteLength>buffer.byteLength)
        throw new RangeError('WASM structural field offset or alignment invalid: '+key);
      if(old instanceof Float64Array)buffers[key]=new Float64Array(buffer,pointer,old.length);
      else if(old instanceof Uint16Array)buffers[key]=new Uint16Array(buffer,pointer,old.length);
      else buffers[key]=new Uint8Array(buffer,pointer,old.length);
    }
    const scalarPointer=wasm.world_structure_scalars(handle)>>>0;
    if(scalarPointer===0||scalarPointer%8!==0||scalarPointer+24>buffer.byteLength)
      throw new RangeError('WASM structural scalar buffer is invalid');
    const scalars=new Float64Array(buffer,scalarPointer,3);
    const kernel:StructuralNumericalKernel={
      buffers,
      solve(input){
        if(released)throw new Error('World structural kernel has been disposed');
        if(memory.buffer!==buffer)throw new Error('Structural Wasm memory moved');
        scalars[0]=input.plasticWorkJ;scalars[1]=input.quietTime;scalars[2]=input.steps;
        const [gx,gy,gz]=input.gravity;
        const status=wasm.world_structure_step(
          handle,input.iterations,input.dt,gx,gy,gz,input.damping,input.thermalScale,
          input.sleepSpeed,input.sleepDelay,0,
        );
        if(status!==1&&status!==2)throw new Error('Rust structural solver rejected step');
        return{plasticWorkJ:scalars[0]!,quietTime:scalars[1]!,steps:scalars[2]!,shouldBake:status===2};
      },
      dispose(){
        if(released)return;
        released=true;
        wasm.world_structure_free(handle);
      },
    };
    body.installKernel(kernel);
    return body;
  }catch(error){
    if(!released)wasm.world_structure_free(handle);
    throw error;
  }
}
