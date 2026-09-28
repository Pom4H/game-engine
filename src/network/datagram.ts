import {Projection,type Frame,safeInteger} from './projection.js';
/** A prepared singleton projection wire layout. One absolute state fits one QUIC datagram.
 * No deltas, fragmentation, JSON/schema strings per packet, or reliable-state fallback. */
export class SnapshotDatagram {
 readonly size:number;readonly signature:number;
 private readonly channels:{offset:number;byte:number;integer:boolean;origin:number;scale:number;width:number;min:number;max:number}[]=[];
 constructor(readonly projection:Projection,readonly id:string,quantized:Readonly<Record<string,{origin:string;step:number}>>={},readonly mtu=1200){
  let byte=40,hash=2166136261;
  for(const e of projection.layout){
   const q=quantized[e.name],origin=q?projection.layout.find(f=>f.name===q.origin):undefined;
   if(q&&(!origin||origin.field.width!==3||origin.offset>=e.offset||e.field.width%3||!Number.isFinite(q.step)||q.step<=0))throw new TypeError('Invalid relative quantizer');
   this.channels.push({offset:e.offset,byte,integer:!!e.field.integer,origin:origin?.offset??-1,scale:q?.step??0,width:e.field.width,min:e.field.min,max:e.field.max});byte+=e.field.width*(q?2:4);
  }
  for(const c of JSON.stringify([projection.signature,id,quantized]))hash=Math.imul(hash^c.charCodeAt(0),16777619);
  this.signature=hash>>>0;this.size=byte;
  if(!Number.isInteger(mtu)||mtu<128||mtu>1200||byte>mtu)throw new RangeError(`Absolute snapshot ${byte} exceeds datagram MTU ${mtu}`);
 }
 encode(f:Frame):Uint8Array {
  if(f.schema!==this.projection.signature||f.rows.length!==1||f.rows[0]!.id!==this.id||f.rows[0]!.values.length!==this.projection.stride)throw new TypeError('Wrong datagram projection');
  if(!safeInteger(f.epoch)||!safeInteger(f.sequence,0,0xffffffff)||!safeInteger(f.tick,0,0xffffffff)||!safeInteger(f.rows[0]!.generation,0,0xffffffff)||!Number.isFinite(f.time)||f.time<0||typeof f.paused!=='boolean')throw new TypeError('Invalid datagram clock');
  const bytes=new Uint8Array(this.size),d=new DataView(bytes.buffer),v=f.rows[0]!.values;
  d.setUint32(0,0x41524e32,true);d.setUint32(4,this.signature,true);d.setFloat64(8,f.epoch,true);d.setUint32(16,f.sequence,true);d.setUint32(20,f.tick,true);d.setFloat64(24,f.time,true);d.setUint32(32,f.rows[0]!.generation,true);d.setUint8(36,Number(f.paused));
  for(const c of this.channels)for(let k=0;k<c.width;k++){
   const n=v[c.offset+k]!;
   if(!Number.isFinite(n)||n<c.min||n>c.max||c.integer&&!safeInteger(n,0,0xffffffff))throw new RangeError('Invalid datagram number');
   if(c.scale){const q=Math.round((n-v[c.origin+k%3]!)/c.scale);if(q< -32768||q>32767)throw new RangeError('Deformation exceeds quantizer range');d.setInt16(c.byte+k*2,q,true);}
   else if(c.integer)d.setUint32(c.byte+k*4,n,true);
   else{const value=Math.fround(n);if(!Number.isFinite(value))throw new RangeError('Float32 overflow');d.setFloat32(c.byte+k*4,value,true);}
  }
  return bytes;
 }
 decode(bytes:Uint8Array):Frame {
  if(!(bytes instanceof Uint8Array)||bytes.byteLength!==this.size)throw new RangeError('Truncated/oversized datagram');
  const d=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
  if(d.getUint32(0,true)!==0x41524e32||d.getUint32(4,true)!==this.signature||d.getUint32(36,true)>1)throw new TypeError('Incompatible datagram');
  const v=new Array<number>(this.projection.stride);
  for(const c of this.channels)for(let k=0;k<c.width;k++)v[c.offset+k]=c.scale?d.getInt16(c.byte+k*2,true)*c.scale+v[c.origin+k%3]!:c.integer?d.getUint32(c.byte+k*4,true):d.getFloat32(c.byte+k*4,true);
  return this.projection.read({schema:this.projection.signature,epoch:d.getFloat64(8,true),sequence:d.getUint32(16,true),tick:d.getUint32(20,true),time:d.getFloat64(24,true),paused:!!d.getUint8(36),rows:[{id:this.id,generation:d.getUint32(32,true),values:v}]});
 }
}
/** One active send plus one replaceable pending absolute state. Await transport capacity
 * BEFORE choosing the latest packet; input accumulated during backpressure is never replayed. */
export class DatagramOutbox {
 private pending:{bytes:Uint8Array;at:number}|undefined;private busy=false;private closed=false;
 readonly stats={replaced:0,expired:0,sent:0,bytes:0};
 constructor(private readonly send:(bytes:Uint8Array)=>Promise<void>,private readonly clock:()=>number=()=>performance.now(),readonly maxAgeMs=50,private readonly failed:(e:unknown)=>void=()=>{},private readonly ready?:()=>Promise<unknown>){if(!Number.isFinite(maxAgeMs)||maxAgeMs<=0||maxAgeMs>1000)throw new RangeError('Datagram age budget');}
 offer(bytes:Uint8Array):void {if(this.closed)return;if(bytes.length>1200)throw new RangeError('Datagram MTU');if(this.pending)this.stats.replaced++;this.pending={bytes,at:this.clock()};void this.flush();}
 private async flush():Promise<void>{
  if(this.busy||this.closed)return;this.busy=true;
  try{while(this.pending&&!this.closed){if(this.ready)await this.ready();if(this.closed||!this.pending)break;const p=this.pending;this.pending=undefined;if(this.clock()-p.at>this.maxAgeMs){this.stats.expired++;continue;}await this.send(p.bytes);this.stats.sent++;this.stats.bytes+=p.bytes.length;}}
  catch(e){const report=!this.closed;this.close();if(report)this.failed(e);}finally{this.busy=false;}
 }
 get queued():number{return Number(this.busy)+Number(!!this.pending);}
 close():void{this.closed=true;this.pending=undefined;}
}
