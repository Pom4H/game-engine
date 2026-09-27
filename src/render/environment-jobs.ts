import type {EnvironmentInput,EnvironmentMip} from './environment-bake.js';
export interface BakeWorker{onmessage:((event:MessageEvent)=>void)|null;onerror:((event:ErrorEvent)=>void)|null;postMessage(value:unknown):void;terminate():void}
interface Job{key:string;input:EnvironmentInput;epoch:number;id:number}
/** One active + one replaceable pending job. Results are admitted as complete cubemaps
 * on the NEXT render boundary, never half a face/mip, and never from a disposed scene. */
export class EnvironmentBaker{
 private worker:BakeWorker|undefined;private pending:Job|undefined;private active:Job|undefined;
 private ready:{key:string;mips:EnvironmentMip[]}|undefined;private epoch=0;private serial=0;
 private closed=false;private failed=false;private jobs=0;private replacements=0;private completed=0;
 constructor(private readonly error:(error:unknown)=>void,private readonly create:()=>BakeWorker=()=>new Worker(new URL('./environment-worker.js',import.meta.url),{type:'module'})){}
 request(key:string,input:EnvironmentInput):void{
  if(this.closed||this.failed||key===this.pending?.key)return;
  if(key===this.active?.key){this.pending=undefined;return;}
  if(this.pending)this.replacements++;this.pending={key,input,epoch:this.epoch,id:++this.serial};this.start();
 }
 private start():void{
  if(this.closed||this.failed||this.active||!this.pending)return;
  try{
   if(!this.worker){this.worker=this.create();this.worker.onmessage=e=>this.receive(e.data);this.worker.onerror=e=>this.fail(e.message);}
   this.active=this.pending;this.pending=undefined;this.jobs++;this.worker.postMessage(this.active);
  }catch(error){this.fail(error);}
 }
 private receive(message:{id:number;epoch:number;key:string;mips:EnvironmentMip[];error?:string}):void{
  if(this.closed||message.id!==this.active?.id||message.epoch!==this.epoch)return;
  if(message.error){this.fail(message.error);return;}
  this.ready={key:message.key,mips:message.mips};this.completed++;this.active=undefined;this.start();
 }
 private fail(error:unknown):void{this.failed=true;this.worker?.terminate();this.worker=undefined;this.active=this.pending=undefined;this.error(error);}
 take(){const result=this.ready;this.ready=undefined;return result;}
 reset():void{this.epoch++;this.worker?.terminate();this.worker=undefined;this.active=this.pending=undefined;this.ready=undefined;this.failed=false;}
 inspect(){return{active:this.active?1:0,pending:this.pending?1:0,ready:this.ready?1:0,jobs:this.jobs,replacements:this.replacements,completed:this.completed,failed:this.failed};}
 dispose():void{this.reset();this.closed=true;}
}
