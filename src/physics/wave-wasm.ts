import {AcousticWaveField,type AcousticWaveFieldSpec,type AcousticWaveKernel,type AcousticPressurePlane} from './wave-field.js';

/**
 * Minimal stable Wasm32 ABI: one field owns an instance and its linear memory.
 * The arrays are the *authoritative* field state, not copied snapshots.
 * The module can be compiled once and instantiated for many independent fields.
 */
interface WaveWasmExports {
  readonly memory:WebAssembly.Memory;
  world_wave_new(nx:number,ny:number,nz:number):number;
  world_wave_free(handle:number):void;
  world_wave_step(handle:number,velocityScale:number,velocityKick:number,pressureKick:number):number;
  world_wave_pressure(handle:number):number;
  world_wave_vx(handle:number):number;
  world_wave_vy(handle:number):number;
  world_wave_vz(handle:number):number;
  world_wave_solid(handle:number):number;
  world_wave_pack_y(handle:number,y:number):number;
  world_wave_stride_bytes(handle:number):number;
}

function wasmExports(value:WebAssembly.Exports):WaveWasmExports{
  const candidate=value as unknown as Record<string,unknown>;
  if(!(candidate.memory instanceof WebAssembly.Memory))throw new TypeError('World wave WASM must export memory');
  for(const name of ['world_wave_new','world_wave_free','world_wave_step','world_wave_pressure','world_wave_vx',
                     'world_wave_vy','world_wave_vz','world_wave_solid','world_wave_pack_y','world_wave_stride_bytes']){
    if(typeof candidate[name]!=='function')throw new TypeError('World wave WASM missing export '+name);
  }
  return value as unknown as WaveWasmExports;
}

/**
 * Bind Rust to the existing physical field without replacing its public API.
 * Create this field once before simulation; all pressure/velocity/obstacle edits
 * operate directly on Wasm memory. step(dt) crosses the ABI exactly once.
 *
 * Pass a compiled WebAssembly.Module to reuse compile costs across scenes.
 * Never share an instance between fields: Vec allocations may grow its memory.
 */
export async function createWasmAcousticWaveField(
  spec:AcousticWaveFieldSpec,
  wasm:WebAssembly.Module|ArrayBuffer|Uint8Array,
):Promise<AcousticWaveField>{
  const source=wasm instanceof WebAssembly.Module?wasm:
    await WebAssembly.compile(wasm instanceof Uint8Array?new Uint8Array(wasm).buffer:wasm);
  const instance=await WebAssembly.instantiate(source,{});
  const exports=wasmExports(instance.exports);
  const [nx,ny,nz]=spec.size;
  if(![nx,ny,nz].every(value=>Number.isSafeInteger(value)&&value>=2&&value<=2048))throw new RangeError('Invalid World wave dimensions');
  const handle=exports.world_wave_new(nx,ny,nz)>>>0;
  if(handle===0)throw new RangeError('World wave kernel rejected grid dimensions or size (max 2 million cells)');
  let released=false;
  try{
    const memory=exports.memory;
    const buffer=memory.buffer;
    const f64View=(pointer:number,count:number):Float64Array=>{
      const at=pointer>>>0;
      if(at%8!==0||at+count*8>buffer.byteLength)throw new RangeError('World wave kernel returned an invalid f64 offset');
      return new Float64Array(buffer,at,count);
    };
    const solidPtr=exports.world_wave_solid(handle)>>>0;
    const cellCount=nx*ny*nz;
    if(solidPtr+cellCount>buffer.byteLength)throw new RangeError('World wave kernel returned an invalid solid offset');
    const planeBytesPerRow=exports.world_wave_stride_bytes(handle)>>>0;
    if(planeBytesPerRow<nx*4||planeBytesPerRow%256!==0)throw new RangeError('Invalid GPU plane stride');
    const kernel:AcousticWaveKernel={
      pressurePa:f64View(exports.world_wave_pressure(handle),cellCount),
      velocityXMps:f64View(exports.world_wave_vx(handle),(nx+1)*ny*nz),
      velocityYMps:f64View(exports.world_wave_vy(handle),nx*(ny+1)*nz),
      velocityZMps:f64View(exports.world_wave_vz(handle),nx*ny*(nz+1)),
      solid:new Uint8Array(buffer,solidPtr,cellCount),
      planeBytesPerRow,
      step(scale,kick,pressureKick){
        if(released)throw new Error('World wave kernel has been disposed');
        if(exports.world_wave_step(handle,scale,kick,pressureKick)!==1)throw new Error('World wave WASM step rejected coefficients');
        if(memory.buffer!==buffer)throw new Error('World wave kernel memory grew during step');
      },
      packPressurePlane(y):Float32Array{
        if(released)throw new Error('World wave kernel has been disposed');
        const ptr=exports.world_wave_pack_y(handle,y)>>>0;
        const count=planeBytesPerRow*nz/4;
        if(!ptr||ptr%4!==0||ptr+count*4>buffer.byteLength)throw new Error('World wave kernel failed to pack GPU plane');
        if(memory.buffer!==buffer)throw new Error('World wave kernel memory grew while packing');
        return new Float32Array(buffer,ptr,count);
      },
      dispose(){
        if(released)return;
        released=true;
        exports.world_wave_free(handle);
      },
    };
    return new AcousticWaveField(spec,kernel);
  }catch(error){
    if(!released)exports.world_wave_free(handle);
    throw error;
  }
}

/**
 * Upload physical pressure to a GPU r32float texture, via already packed,
 * 256-byte-aligned bytes. Works with WebGPU's queue.writeTexture contract.
 * WebGPU still performs an unavoidable CPU->GPU transfer; no GPU memory aliasing
 * or misleading zero-copy claim is made.
 */
export function uploadAcousticPressurePlane<TTexture>(
  field:AcousticWaveField,
  queue:{
    writeTexture(destination:{texture:TTexture},data:Float32Array,layout:{bytesPerRow:number;rowsPerImage:number},size:readonly [number,number,number]):void;
  },
  texture:TTexture,
  y:number,
):Readonly<{width:number;height:number;bytes:number;bytesPerRow:number}>{
  const plane:AcousticPressurePlane=field.pressurePlaneForGPU(y);
  queue.writeTexture({texture},plane.data,{bytesPerRow:plane.bytesPerRow,rowsPerImage:plane.height},[plane.width,plane.height,1]);
  return Object.freeze({width:plane.width,height:plane.height,bytes:plane.data.byteLength,bytesPerRow:plane.bytesPerRow});
}
