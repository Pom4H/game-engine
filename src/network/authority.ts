import {Projection,Publication,type Frame,type Stamp} from './projection.js';
import {Replica} from './playback.js';
export type DebugAction='pause'|'resume'|'step'|'dump';
export interface DebugRequest{readonly action:DebugAction;readonly epoch:number;readonly expectedTick:number}
export interface AuthorityAdapter{
 readonly tick:number;readonly time:number;step(dt:number):void;
 capture(at:Stamp):Frame;
 /** Explicit bounded domain state. This is not an automatically restorable heap/checkpoint. */
 dump():unknown;
}
/** Called at a physical-tick boundary. Transport stays outside the authoritative worker.
 * An epoch fences resets; every mutation is permission-checked and compares the paused tick. */
export class AuthoritySession{
 paused=true;private sequence=0;readonly history:Replica;publications=0;
 constructor(readonly world:AuthorityAdapter,readonly projection:Projection,readonly epoch:number,
  private readonly authorize:(peer:string,action:DebugAction)=>boolean=()=>false,readonly stepSeconds=1/60){
  if(!Number.isFinite(stepSeconds)||stepSeconds<=0||stepSeconds>.1)throw new RangeError('Invalid authority step');this.history=new Replica(projection,epoch,600,32_000_000,0);
 }
 advance(count=1):number{if(!Number.isSafeInteger(count)||count<1||count>8)throw new RangeError('Advance 1..8 bounded ticks');let n=0;while(!this.paused&&n<count){this.world.step(this.stepSeconds);n++;}return n;}
 publish():Publication{
  const at={epoch:this.epoch,sequence:this.sequence+1,tick:this.world.tick,time:this.world.time,paused:this.paused};
  const frame=this.world.capture(at);if(frame.epoch!==at.epoch||frame.sequence!==at.sequence||frame.tick!==at.tick||frame.time!==at.time||frame.paused!==at.paused)throw new TypeError('Capture must preserve authoritative stamp');const pub=new Publication(this.projection,frame);pub.text();
  this.history.receive(frame,this.world.time);this.sequence++;this.publications++;return pub;
 }
 command(peer:string,request:DebugRequest):{tick:number;time:number;paused:boolean;dump?:unknown}{
  if(!request||!['pause','resume','step','dump'].includes(request.action)||!this.authorize(peer,request.action))throw new Error('Debug command denied');
  if(request.epoch!==this.epoch)throw new Error('Stale debug epoch');
  if(request.action!=='pause'&&(!this.paused||request.expectedTick!==this.world.tick))throw new Error('Pause at the expected authoritative tick first');
  if(request.action==='pause')this.paused=true;
  else if(request.action==='resume')this.paused=false;
  else if(request.action==='step')this.world.step(this.stepSeconds);
  return{tick:this.world.tick,time:this.world.time,paused:this.paused,...(request.action==='dump'?{dump:this.world.dump()}:{})};
 }
}
