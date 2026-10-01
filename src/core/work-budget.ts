/** Byte/operation bounds are hard. Time is an admission deadline, not preemption of
 * JavaScript, driver calls, GC or OS scheduling. All work units must be bounded too. */
export class WorkBudget {
 private deadline=0;private remainingBytes=0;private remainingOps=0;
 bytes=0;operations=0;overruns=0;
 constructor(readonly maxBytes=128*1024,readonly maxOperations=8,readonly milliseconds=1,private readonly now:()=>number=()=>performance.now()){
  if(!Number.isSafeInteger(maxBytes)||maxBytes<4||maxBytes%4||!Number.isSafeInteger(maxOperations)||maxOperations<1||!Number.isFinite(milliseconds)||milliseconds<=0)throw new RangeError('Invalid work budget');
 }
 begin():this{this.deadline=this.now()+this.milliseconds;this.remainingBytes=this.maxBytes;this.remainingOps=this.maxOperations;this.bytes=this.operations=0;return this;}
 claim(bytes=0):boolean{
  if(!Number.isSafeInteger(bytes)||bytes<0||bytes%4)throw new RangeError('Work size must be aligned bytes');
  if(this.remainingOps<=0||bytes>this.remainingBytes||this.now()>=this.deadline)return false;
  this.remainingOps--;this.remainingBytes-=bytes;this.bytes+=bytes;this.operations++;return true;
 }
 get availableBytes():number{return this.remainingBytes;}
 get expired():boolean{return this.now()>=this.deadline;}
 finish():void{if(this.operations&&this.expired)this.overruns++;}
}
export interface UploadDriver<T>{create(bytes:number,usage:'vertex'|'index'):T;write(buffer:T,offset:number,bytes:Uint8Array):void;destroy(buffer:T):void}
/** At most three GPU buffers; uploads are split into <=64 KiB slices. Not visible
 * until done. Cancel frees partially prepared resources. No work is done in draw(). */
export class BufferUpload<T>{
 readonly buffers:T[]=[];private part=0;private offset=0;private disposed=false;
 private readonly source:readonly Uint8Array[];
 uploadedBytes=0;
 constructor(arrays:readonly [ArrayBufferView,ArrayBufferView,ArrayBufferView],private readonly driver:UploadDriver<T>,readonly sliceBytes=64*1024){
  if(!Number.isSafeInteger(sliceBytes)||sliceBytes<4||sliceBytes%4||arrays.some(a=>!a.byteLength||a.byteLength%4||!(a.buffer instanceof ArrayBuffer)))throw new RangeError('Invalid upload buffers');
  this.source=arrays.map(a=>new Uint8Array(a.buffer,a.byteOffset,a.byteLength));
 }
 advance(budget:WorkBudget):boolean{
  if(this.disposed)throw new Error('Upload disposed');
  try{
   while(this.part<3){
    const source=this.source[this.part]!;
    if(this.buffers.length<=this.part){if(!budget.claim())return false;this.buffers.push(this.driver.create(source.byteLength,this.part===2?'index':'vertex'));}
    const length=Math.min(source.byteLength-this.offset,this.sliceBytes,budget.availableBytes);
    if(!length||!budget.claim(length))return false;
    this.driver.write(this.buffers[this.part]!,this.offset,source.subarray(this.offset,this.offset+length));
    this.offset+=length;this.uploadedBytes+=length;
    if(this.offset===source.byteLength){this.part++;this.offset=0;}
   }
   return true;
  }catch(error){this.dispose();throw error;}
 }
 get done():boolean{return this.part===3&&!this.disposed;}
 dispose():void{if(this.disposed)return;this.disposed=true;for(const buffer of this.buffers)this.driver.destroy(buffer);this.buffers.length=0;}
}
/** Submission credit. A slow GPU causes skipped submissions, not an ever-growing
 * queue of stale frames. Completion failures are observable and stop admission. */
export class FrameGate {
 pending=0;submitted=0;completed=0;skipped=0;maxPending=0;error='';
 constructor(readonly capacity=2){if(!Number.isSafeInteger(capacity)||capacity<1||capacity>4)throw new RangeError('Invalid GPU frame capacity');}
 get available():boolean{return !this.error&&this.pending<this.capacity;}
 admit():boolean{if(this.available)return true;this.skipped++;return false;}
 track(completion:Promise<unknown>):void{
  if(!this.available)throw new Error('GPU submission exceeds credit');
  this.pending++;this.submitted++;this.maxPending=Math.max(this.maxPending,this.pending);
  void completion.then(()=>{this.completed++;},error=>{this.error=String(error);}).finally(()=>{this.pending--;});
 }
 inspect(){return {pending:this.pending,capacity:this.capacity,maxPending:this.maxPending,submitted:this.submitted,completed:this.completed,skipped:this.skipped,error:this.error};}
}
