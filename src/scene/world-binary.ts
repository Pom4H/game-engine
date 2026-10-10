import type {MaterialKind} from '../materials/catalog.js';
import type {BodySpec,EntitySpec,Primitive,SceneSpec} from './types.js';
import {validateScene} from './validate.js';

/**
 * World compiler binary ABI v1 (WSCN).
 * Header: 160 bytes; entity records: 160 bytes each; trailing UTF-8 ID table.
 * All integers and floats are little-endian. Values are SI and f64 unless stated.
 * See compiler/README.md for the fixed byte offsets.
 *
 * This module executes only at scene load, never during simulation/render ticks.
 * Physics/renderer continue to consume the engine's native SceneSpec.
 */
export const WORLD_BINARY_VERSION=1;
const HEADER_BYTES=160,RECORD_BYTES=160,MAX_BYTES=32*1024*1024,MAX_ENTITIES=20_000;
const MATERIALS=['default','glass','steel','wood','concrete','asphalt','snow','rubber','plastic','aluminum','mirror'] as const satisfies readonly MaterialKind[];
const SNOWFALL=['none','light','moderate','heavy'] as const;
const ENTITY_FLAGS=0xff;
const WORLD_FLAGS=0x07;

function fail(message:string):never{throw new TypeError('WSCN: '+message);}

/** Decode compiled World assets into the authoritative engine scene contract. */
export function decodeWorldBinary(input:ArrayBuffer|Uint8Array):SceneSpec{
  const bytes=input instanceof Uint8Array?input:new Uint8Array(input);
  if(bytes.byteLength<HEADER_BYTES||bytes.byteLength>MAX_BYTES)fail('invalid byte length');
  if(bytes[0]!==87||bytes[1]!==83||bytes[2]!==67||bytes[3]!==78)fail('invalid magic');
  const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
  const u8=(at:number)=>view.getUint8(at);
  const u16=(at:number)=>view.getUint16(at,true);
  const u32=(at:number)=>view.getUint32(at,true);
  const f32=(at:number)=>view.getFloat32(at,true);
  const f64=(at:number)=>view.getFloat64(at,true);
  const finite=(value:number,label:string)=>Number.isFinite(value)?value:fail(label+' is non-finite');
  const vec3=(at:number):[number,number,number]=>[
    finite(f64(at),'vector'),finite(f64(at+8),'vector'),finite(f64(at+16),'vector'),
  ];
  if(u16(4)!==WORLD_BINARY_VERSION)fail('unsupported ABI version');
  if(u16(6)!==HEADER_BYTES||u32(8)!==RECORD_BYTES)fail('unsupported record layout');
  const count=u32(12),recordsOffset=u32(16),stringsOffset=u32(20),total=u32(24),worldFlags=u32(28);
  if(count>MAX_ENTITIES)fail('too many entities');
  if((worldFlags&~WORLD_FLAGS)!==0)fail('unknown world flags');
  const recordEnd=HEADER_BYTES+RECORD_BYTES*count;
  if(recordsOffset!==HEADER_BYTES||stringsOffset!==recordEnd||total!==bytes.byteLength)fail('invalid offsets/length');
  const stringLength=bytes.byteLength-stringsOffset;
  const decoder=new TextDecoder('utf-8',{fatal:true});
  const readString=(start:number,size:number):string=>{
    if(start>stringLength||size>stringLength-start)fail('invalid string bounds');
    return decoder.decode(bytes.subarray(stringsOffset+start,stringsOffset+start+size));
  };
  // Metadata name is retained in the file for tools; it is not a runtime entity.
  readString(u32(144),u32(148));
  const scene:SceneSpec={version:1,seed:u32(32),gravity:vec3(40),ground:finite(f64(64),'ground'),entities:[]};
  if(worldFlags&1)scene.camera={
    position:vec3(72),target:vec3(96),fov:finite(f64(120),'camera.fov'),
  };
  if(worldFlags&6){
    const environment:NonNullable<SceneSpec['environment']>={};
    if(worldFlags&2)environment.temperatureC=finite(f64(128),'environment.temperature');
    if(worldFlags&4){
      const snowfall=SNOWFALL[u32(136)];
      if(snowfall===undefined)fail('invalid snowfall');
      environment.snowfall=snowfall;
    }
    scene.environment=environment;
  }
  const entities:EntitySpec[]=[];
  const ids=new Set<string>();
  for(let index=0;index<count;index++){
    const at=recordsOffset+index*RECORD_BYTES;
    const id=readString(u32(at),u16(at+4));
    if(!id||ids.has(id))fail('empty or duplicate entity id');
    ids.add(id);
    const primitiveTag=u8(at+6),materialIndex=u8(at+7),flags=u32(at+8);
    if((flags&~ENTITY_FLAGS)!==0)fail('unknown entity flags');
    const kind=MATERIALS[materialIndex];
    if(kind===undefined)fail('unknown material');
    const dimensions=vec3(at+88);
    let mesh:Primitive;
    switch(primitiveTag){
      case 1:mesh={kind:'box',size:dimensions};break;
      case 2:mesh={kind:'sphere',radius:dimensions[0]};break;
      case 3:mesh={kind:'plane',size:[dimensions[0],dimensions[1]]};break;
      case 4:mesh={kind:'cylinder',radius:dimensions[0],height:dimensions[1]};break;
      default:return fail('unknown mesh tag');
    }
    const material:NonNullable<EntitySpec['material']>={kind};
    if(flags&8)material.roughness=finite(f32(at+144),'roughness');
    const entity:EntitySpec={
      id,position:vec3(at+16),rotation:vec3(at+40),scale:vec3(at+64),mesh,material,
    };
    if(flags&4)entity.renderOnly=true;
    if(flags&1){
      const mass=finite(f64(at+112),'mass');
      if(!!(flags&2)!==(mass>0))fail('invalid dynamic mass flag');
      const body:BodySpec=mass>0?{mass,motion:'dynamic'}:{};
      if(flags&16)body.velocity=vec3(at+120);
      if(flags&32)body.friction=finite(f32(at+152),'friction');
      if(flags&64)body.restitution=finite(f32(at+156),'restitution');
      entity.body=body;
    }else if(flags&(2|16|32|64))fail('physics flags without body');
    if(flags&128)entity.environmental={snowDepthM:finite(f32(at+148),'snow_depth')};
    entities.push(entity);
  }
  // Normal validator remains the single authority for physical/render invariants.
  scene.entities=entities;
  return validateScene(scene);
}

/** Binary detection for fetched assets (independent of filename/MIME). */
export function isWorldBinary(input:Uint8Array):boolean{
  return input.byteLength>=4&&input[0]===87&&input[1]===83&&input[2]===67&&input[3]===78;
}
