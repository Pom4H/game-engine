import {sampleQuaternion} from '../physics/rotation.js';
import {Projection,type Frame,type Row,safeInteger} from './projection.js';
/** Adapted from thegame PlaybackClock at 4e7a577. Wall-time arrival never becomes render time.
 * No extrapolation after the newest cause; starvation is observable, not fabricated motion. */
export class PlaybackClock{
 private latest=0;private received:number|null=null;private anchor:{time:number;at:number}|null=null;
 private value:number|null=null;private sampled:number|null=null;private calibrated=false;
 rate=1;heldFrames=0;
 constructor(readonly delaySeconds=.1){if(!Number.isFinite(delaySeconds)||delaySeconds<0||delaySeconds>2)throw new RangeError('Invalid presentation delay');}
 observe(time:number,now:number):void{
  if(!Number.isFinite(time)||time<0||!Number.isFinite(now))throw new TypeError('Invalid clock observation');
  if(!this.anchor||this.received!==null&&now-this.received>2)this.anchor={time,at:now};
  else{const elapsed=now-this.anchor.at;if(elapsed>=.25){const measured=Math.max(.02,Math.min(1.25,(time-this.anchor.time)/elapsed));this.rate+=(measured-this.rate)*(this.calibrated?1-Math.exp(-elapsed/.75):1);this.calibrated=true;this.anchor={time,at:now};}}
  this.latest=time;this.received=now;
 }
 sample(now:number):number{
  if(!Number.isFinite(now))throw new TypeError('Invalid presentation timestamp');if(this.received===null)return 0;
  const target=Math.max(0,Math.min(this.latest,this.latest-this.delaySeconds+Math.max(0,now-this.received)*this.rate)),previous=this.value;
  if(previous===null)this.value=target;
  else{const dt=Math.max(0,now-(this.sampled??now)),correction=Math.max(.25,Math.min(1.25,1+(target-previous)*6));this.value=dt>1?Math.max(previous,target):Math.max(previous,Math.min(this.latest,previous+dt*this.rate*correction));if(this.value<=previous+1e-10&&dt>0)this.heldFrames++;}
  this.sampled=now;return this.value!;
 }
 reset():void{this.latest=0;this.received=null;this.anchor=null;this.value=null;this.sampled=null;this.calibrated=false;this.rate=1;this.heldFrames=0;}
}
export interface SampleRow{readonly id:string;generation:number;readonly values:Float64Array}
export interface Sample{epoch:number;time:number;fromTick:number;toTick:number;alpha:number;readonly rows:SampleRow[]}
/** Bounded absolute-snapshot history shared by live rendering and replay. sampleAt never steps a world. */
export class Replica{
 private readonly frames:Frame[]=[];private readonly indexes=new WeakMap<Frame,ReadonlyMap<string,Row>>();
 private readonly slots=new Map<string,SampleRow & {seen:number}>();private sampleSerial=0;private latestSequence=-1;private bytes=0;
 readonly clock:PlaybackClock;readonly sample:Sample={epoch:0,time:0,fromTick:0,toTick:0,alpha:0,rows:[]};
 readonly stats={accepted:0,stale:0,samples:0,allocations:0};
 constructor(readonly projection:Projection,private epoch:number,readonly capacity=240,readonly byteBudget=16_000_000,delaySeconds=.1){
  if(!safeInteger(epoch)||!safeInteger(capacity,2,4096)||!safeInteger(byteBudget,128,128_000_000))throw new RangeError('Invalid replica budget');this.clock=new PlaybackClock(delaySeconds);
 }
 receive(input:unknown,now:number):boolean{
  if(!Number.isFinite(now))throw new TypeError('Invalid arrival time');
  const f=this.projection.read(input);const last=this.frames.at(-1);
  if(f.epoch!==this.epoch||f.sequence<=this.latestSequence||last&&(f.time<last.time||f.tick<last.tick)){this.stats.stale++;return false;}
  const size=this.cost(f);if(size>this.byteBudget)throw new RangeError('Single snapshot exceeds history budget');
  this.frames.push(f);this.indexes.set(f,new Map(f.rows.map(r=>[r.id,r])));this.bytes+=size;
  while(this.frames.length>this.capacity||this.bytes>this.byteBudget){this.bytes-=this.cost(this.frames.shift()!);}
  this.latestSequence=f.sequence;this.clock.observe(f.time,now);this.stats.accepted++;return true;
 }
 private cost(f:Frame):number{return 64+f.schema.length*2+f.rows.reduce((n,r)=>n+48+r.id.length*2+r.values.length*8,0);}
 /** Budget counts numeric payload/IDs, not V8 heap or total process RSS. */
 inspect(){return{epoch:this.epoch,frames:this.frames.length,payloadBytes:this.bytes,oldest:this.frames[0]?.time??0,newest:this.frames.at(-1)?.time??0,latestTick:this.frames.at(-1)?.tick??0,paused:this.frames.at(-1)?.paused??false,heldFrames:this.clock.heldFrames,...this.stats};}
 latest():Frame|undefined{return this.frames.at(-1);}
 reset(epoch:number):void{if(!safeInteger(epoch))throw new RangeError('Invalid epoch');this.epoch=epoch;this.frames.length=0;this.slots.clear();this.bytes=0;this.latestSequence=-1;this.sample.rows.length=0;this.clock.reset();}
 present(now:number):Sample{return this.at(this.clock.sample(now));}
 at(time:number):Sample{
  if(!Number.isFinite(time)||time<0)throw new RangeError('Invalid replay time');
  const out=this.sample;out.epoch=this.epoch;out.rows.length=0;if(!this.frames.length)return out;
  time=Math.max(this.frames[0]!.time,Math.min(time,this.frames.at(-1)!.time));
  let low=0,high=this.frames.length;
  while(low<high){const mid=(low+high)>>>1;if(this.frames[mid]!.time<=time)low=mid+1;else high=mid;}
  const a=this.frames[Math.max(0,low-1)]!,b=this.frames[Math.min(this.frames.length-1,low)]!,alpha=b.time>a.time?(time-a.time)/(b.time-a.time):0;
  out.time=time;out.fromTick=a.tick;out.toTick=b.tick;out.alpha=alpha;
  const next=this.indexes.get(b)!,serial=++this.sampleSerial;
  for(const row of a.rows){
   let view=this.slots.get(row.id);if(!view){view={id:row.id,generation:row.generation,values:new Float64Array(this.projection.stride),seen:serial};this.slots.set(row.id,view);this.stats.allocations++;}
   view.generation=row.generation;const other=next.get(row.id),blend=other?.generation===row.generation;
   for(const {offset,field} of this.projection.layout){
    if(field.sample==='quaternion'){sampleQuaternion(row.values,blend?other!.values:row.values,offset,alpha,view.values);continue;}
    for(let k=0;k<field.width;k++){
    const j=offset+k,x=row.values[j]!,y=blend?other!.values[j]!:x;
    view.values[j]=field.sample==='step'?x:field.sample==='angle'?x+Math.atan2(Math.sin(y-x),Math.cos(y-x))*alpha:x+(y-x)*alpha;
   }
   }
   out.rows.push(view);view.seen=serial;
  }
  // Whole rosters are sampled atomically. No timeout-based visual disappearance on packet gaps.
  for(const [id,view] of this.slots)if(view.seen!==serial)this.slots.delete(id);
  this.stats.samples++;return out;
 }
 exportRange(from:number,to:number):readonly Frame[]{if(!Number.isFinite(from)||!Number.isFinite(to)||from<0||to<from)throw new RangeError('Invalid replay range');return this.frames.filter(f=>f.time>=from&&f.time<=to);}
}
