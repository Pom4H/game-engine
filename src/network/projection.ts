/** Explicit numeric projections. Unlisted simulation fields never enter a packet.
 * RU: Авторитетное состояние остаётся у симуляции; проекция выбирает только факты. */
export type Sampling='linear'|'angle'|'step'|'quaternion';
export interface Field<W extends number=number>{readonly width:W;readonly sample:Sampling;readonly min:number;readonly max:number;readonly buffer?:true;readonly integer?:true}
export type NumericBuffer=readonly number[]|Float32Array|Float64Array|Int8Array|Uint8Array|Uint8ClampedArray|Int16Array|Uint16Array|Int32Array|Uint32Array;
/** Fixed-size buffers (nodes, joints, packed flags). Width belongs to the installed schema. */
export const buffer=(width:number,options:{sample?:Sampling;min?:number;max?:number;integer?:boolean}={}):Field & {readonly buffer:true}=>Object.freeze({
 width,sample:options.sample??'linear',min:options.min??-1e12,max:options.max??1e12,buffer:true,...(options.integer?{integer:true as const}:{}),
});
const numeric=(v:unknown,f:Field):v is number=>typeof v==='number'&&Number.isFinite(v)&&v>=f.min&&v<=f.max&&(!f.integer||Number.isSafeInteger(v));
export const scalar=(sample:Sampling='step',min=-1e12,max=1e12):Field<1>=>Object.freeze({width:1,sample,min,max});
export const vector3=(sample:Sampling='linear',min=-1e12,max=1e12):Field<3>=>Object.freeze({width:3,sample,min,max});
export type Fields=Readonly<Record<string,Field>>;
export type Values<S extends Fields>={readonly[K in keyof S]:S[K] extends {readonly buffer:true}?NumericBuffer:S[K]['width'] extends 1?number:readonly[number,number,number]|Float32Array|Float64Array};
export interface Stamp{readonly epoch:number;readonly sequence:number;readonly tick:number;readonly time:number;readonly paused:boolean}
export interface Row{readonly id:string;readonly generation:number;readonly values:readonly number[]}
export interface Frame extends Stamp{readonly schema:string;readonly rows:readonly Row[]}
export interface Layout{readonly name:string;readonly offset:number;readonly field:Field}
export const safeInteger=(n:unknown,min=0,max=Number.MAX_SAFE_INTEGER):n is number=>typeof n==='number'&&Number.isSafeInteger(n)&&n>=min&&n<=max;
export const identity=(v:unknown):v is string=>typeof v==='string'&&v.length>0&&v.length<=160&&!['__proto__','constructor','prototype'].includes(v);
function stamp(s:Stamp):void{if(!safeInteger(s.epoch)||!safeInteger(s.sequence)||!safeInteger(s.tick)||!Number.isFinite(s.time)||s.time<0||typeof s.paused!=='boolean')throw new TypeError('Invalid projection clock');}
export class Projection<S extends Fields=Fields>{
 readonly layout:readonly Layout[];readonly stride:number;readonly signature:string;
 readonly stats={captures:0,records:0,encodes:0};
 /** Both flat numeric payload and encoded UTF-8 are bounded; this is not a total heap cap. */
 constructor(readonly name:string,readonly fields:S,readonly maxEntities=1024,readonly maxBytes=2_000_000,readonly maxStride=128){
  if(!identity(name)||!safeInteger(maxEntities,1,10000)||!safeInteger(maxBytes,128,16_000_000)||!safeInteger(maxStride,1,32768))throw new RangeError('Invalid projection budget');
  let offset=0;this.layout=Object.freeze(Object.entries(fields).map(([name,f])=>{
   if(!identity(name)||!safeInteger(f.width,1,maxStride)||(!f.buffer&&![1,3].includes(f.width))||(f.buffer!==undefined&&f.buffer!==true)||(f.integer!==undefined&&f.integer!==true)||(f.integer&&f.sample!=='step')||!['linear','angle','step','quaternion'].includes(f.sample)||(f.sample==='quaternion'&&f.width!==4)||!Number.isFinite(f.min)||!Number.isFinite(f.max)||f.min>f.max)throw new TypeError('Invalid projected field');
   const entry=Object.freeze({name,offset,field:Object.freeze({...f})});offset+=f.width;return entry;
  }));if(offset<1||offset>maxStride)throw new RangeError('Projection stride exceeds budget');this.stride=offset;
  this.signature=JSON.stringify([name,this.layout.map(x=>[x.name,x.field.width,x.field.sample,x.field.min,x.field.max,...(x.field.buffer?['buffer']:[]),...(x.field.integer?['integer']:[])])]);
 }
 capture(at:Stamp,sources:Iterable<{readonly id:string;readonly generation?:number;readonly data:Values<S>}>):Frame{
  stamp(at);const rows:Row[]=[],ids=new Set<string>();
  for(const source of sources){
   if(rows.length>=this.maxEntities||(rows.length+1)*this.stride*8>this.maxBytes||!identity(source.id)||ids.has(source.id)||!safeInteger(source.generation??0))throw new RangeError('Invalid/duplicate projection identity or capacity');
   ids.add(source.id);const values:number[]=[];
   for(const {name,field} of this.layout){
    const raw=source.data[name],single=field.width===1&&!field.buffer;
    if(!single&&((!Array.isArray(raw)&&!ArrayBuffer.isView(raw))||!('length' in raw)||raw.length!==field.width))throw new TypeError(`Invalid ${source.id}.${name}`);
    for(let k=0;k<field.width;k++){const value=single?raw:(raw as NumericBuffer)[k];if(!numeric(value,field))throw new TypeError(`Invalid ${source.id}.${name}`);values.push(value);}
   }
   for(const e of this.layout)if(e.field.sample==='quaternion'&&Math.abs(Math.hypot(...values.slice(e.offset,e.offset+4))-1)>1e-5)throw new TypeError('Quaternion must be normalized');
   rows.push(Object.freeze({id:source.id,generation:source.generation??0,values:Object.freeze(values)}));
  }
  this.stats.captures++;this.stats.records+=rows.length;return Object.freeze({...at,schema:this.signature,rows:Object.freeze(rows)});
 }
 /** Validate fully before touching a receiver. Copies only the selected flat channels. */
 read(input:unknown):Frame{
  if(!input||typeof input!=='object')throw new TypeError('Expected projection frame');
  const f=input as Frame;stamp(f);
  if(f.schema!==this.signature||!Array.isArray(f.rows)||f.rows.length>this.maxEntities||f.rows.length*this.stride*8>this.maxBytes)throw new TypeError('Incompatible projection');
  const ids=new Set<string>(),rows:Row[]=[];
  for(const r of f.rows){
   if(!r||!identity(r.id)||ids.has(r.id)||!safeInteger(r.generation)||!Array.isArray(r.values)||r.values.length!==this.stride)throw new TypeError('Invalid projection row');ids.add(r.id);
   for(const e of this.layout)for(let k=0;k<e.field.width;k++)if(!numeric(r.values[e.offset+k],e.field))throw new RangeError('Invalid projected number');
   for(const e of this.layout)if(e.field.sample==='quaternion'&&Math.abs(Math.hypot(...r.values.slice(e.offset,e.offset+4))-1)>1e-5)throw new TypeError('Quaternion must be normalized');
   rows.push(Object.freeze({id:r.id,generation:r.generation,values:Object.freeze([...r.values])}));
  }
  return Object.freeze({epoch:f.epoch,sequence:f.sequence,tick:f.tick,time:f.time,paused:f.paused,schema:f.schema,rows:Object.freeze(rows)});
 }
 decode(text:string):Frame{if(text.length>this.maxBytes||new TextEncoder().encode(text).length>this.maxBytes)throw new RangeError('Packet too large');return this.read(JSON.parse(text));}
 encode(frame:Frame):string{const text=JSON.stringify(frame);if(new TextEncoder().encode(text).length>this.maxBytes)throw new RangeError('Packet too large');this.stats.encodes++;return text;}
}
export const projection=<const S extends Fields>(name:string,fields:S,limits?:{maxEntities?:number;maxBytes?:number;maxStride?:number})=>new Projection(name,fields,limits?.maxEntities,limits?.maxBytes,limits?.maxStride);
/** One immutable publication/encoding per cohort; share it among viewers, never serialize in render(). */
export class Publication{
 private encoded:string|undefined;
 constructor(readonly projection:Projection,readonly frame:Frame){}
 text():string{return this.encoded??=this.projection.encode(this.frame);}
}
/** Latest absolute state may replace unsent absolute state. Never use this for commands or events. */
export class LatestStateOutbox<T>{
 private value:T|undefined;replaced=0;
 offer(value:T):void{if(this.value!==undefined)this.replaced++;this.value=value;}
 take():T|undefined{const value=this.value;this.value=undefined;return value;}
 get size():number{return this.value===undefined?0:1;}
 clear():void{this.value=undefined;}
}
