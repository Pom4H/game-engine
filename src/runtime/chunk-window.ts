export interface ChunkTicket {readonly key:string;readonly x:number;readonly z:number;readonly serial:number}
/** A bounded spatial working set: one active preparation, one ready result, no job backlog.
 * The caller owns workers and GPU resources. Admission happens only at its render boundary. */
export class ChunkWindow<T> {
 private desired:ChunkTicket[]=[];private wanted=new Set<string>();private resident=new Map<string,T>();
 private active:ChunkTicket|undefined;private ready:{ticket:ChunkTicket;value:T}|undefined;private serial=0;private center='';
 readonly stats={requests:0,admitted:0,evicted:0,stale:0};
 constructor(private readonly release:(key:string,value:T)=>void){}
 want(x:number,z:number,radius:number):void{
  if(!Number.isSafeInteger(x)||!Number.isSafeInteger(z)||!Number.isSafeInteger(radius)||radius<1||radius>4)throw new RangeError('Invalid chunk window');
  const center=`${x}:${z}:${radius}`;if(center===this.center)return;this.center=center;this.desired=[];this.wanted.clear();
  for(let dz=-radius;dz<=radius;dz++)for(let dx=-radius;dx<=radius;dx++){const key=`${x+dx}:${z+dz}`;this.desired.push({x:x+dx,z:z+dz,key,serial:0});this.wanted.add(key);}
  this.desired.sort((a,b)=>Math.hypot(a.x-x,a.z-z)-Math.hypot(b.x-x,b.z-z));
  for(const [key,value] of this.resident)if(!this.wanted.has(key)){this.resident.delete(key);this.release(key,value);this.stats.evicted++;}
  if(this.ready&&!this.wanted.has(this.ready.ticket.key)){this.release(this.ready.ticket.key,this.ready.value);this.ready=undefined;this.stats.stale++;}
 }
 next():ChunkTicket|undefined{
  if(this.active||this.ready)return;const next=this.desired.find(t=>!this.resident.has(t.key));if(!next)return;
  this.active={...next,serial:++this.serial};this.stats.requests++;return this.active;
 }
 prepared(ticket:ChunkTicket,value:T):boolean{
  if(ticket.serial!==this.active?.serial){this.stats.stale++;return false;}
  this.active=undefined;if(!this.wanted.has(ticket.key)){this.release(ticket.key,value);this.stats.stale++;return false;}
  this.ready={ticket,value};return true;
 }
 /** The previous frame never sees a partially installed chunk. Failed installs stay retryable. */
 admit(install:(ticket:ChunkTicket,value:T)=>void):boolean{
  if(!this.ready)return false;const {ticket,value}=this.ready;install(ticket,value);this.resident.set(ticket.key,value);this.ready=undefined;this.stats.admitted++;return true;
 }
 has(key:string):boolean{return this.resident.has(key);}
 inspect(){return {resident:this.resident.size,desired:this.desired.length,active:this.active?1:0,ready:this.ready?1:0,...this.stats};}
 dispose():void{for(const [key,value] of this.resident)this.release(key,value);if(this.ready)this.release(this.ready.ticket.key,this.ready.value);this.resident.clear();this.wanted.clear();this.desired=[];this.active=this.ready=undefined;this.center='';this.serial++;}
}
