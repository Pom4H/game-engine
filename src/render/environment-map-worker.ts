import {type EnvironmentMapInput,type EnvironmentMapData} from './environment-map.js';
import {ModuleWorker as Worker} from './module-worker.js';

type Job={key:string;generation:number;input:EnvironmentMapInput};
export interface EnvironmentWorker {
  onmessage:((event:MessageEvent<EnvironmentMapData>)=>void)|null;
  onerror:((event:ErrorEvent)=>void)|null;
  postMessage(input:EnvironmentMapInput):void;
  terminate():void;
}
/** One active bake and one latest replacement. Superseded inputs never form a backlog. */
export class EnvironmentMapWorker {
  private active:Job|null=null;
  private queued:Job|null=null;
  private generation=0;
  private idleDone:Promise<void>|null=null;
  private finishIdle:(()=>void)|null=null;
  private rejectIdle:((error:Error)=>void)|null=null;
  private failure:Error|null=null;
  private disposed=false;
  private worker:EnvironmentWorker|null;
  private failed=false;
  constructor(private readonly publish:(key:string,data:EnvironmentMapData)=>void,
    create:()=>EnvironmentWorker=()=>new Worker(new URL('./environment-map.worker.js',import.meta.url),{type:'module'})){
    try{this.worker=create();}catch(error){this.worker=null;this.fail(error);return;}
    this.worker.onmessage=event=>{try{this.complete(event.data);}catch(error){this.fail(error);}};
    this.worker.onerror=event=>{
      event.preventDefault();this.fail(new Error(event.message||'Environment worker failed'));
    };
  }
  request(key:string,input:EnvironmentMapInput):void{
    if(this.disposed||this.failed)return;
    if(this.active?.generation===this.generation&&this.active.key===key){this.queued=null;return;}
    const job={key,input,generation:this.generation};
    if(this.active)this.queued=job;else this.start(job);
  }
  reset():void{this.generation++;this.queued=null;}
  inspect(){return{active:this.active!==null,queued:this.queued!==null,failed:this.failed};}
  idle():Promise<void>{if(this.failure)return Promise.reject(this.failure);return this.active?(this.idleDone??=new Promise((resolve,reject)=>{this.finishIdle=resolve;this.rejectIdle=reject;})):Promise.resolve();}
  dispose():void{this.disposed=true;this.worker?.terminate();this.worker=null;this.active=this.queued=null;this.release();}
  private start(job:Job):void{
    this.active=job;
    try{this.worker?.postMessage(job.input);}catch(error){this.fail(error);}
  }
  private complete(data:EnvironmentMapData):void{
    const job=this.active;this.active=null;
    if(!this.disposed&&job?.generation===this.generation)this.publish(job.key,data);
    const next=this.queued;this.queued=null;
    if(next&&!this.disposed)this.start(next);else this.release();
  }
  private fail(cause:unknown){this.failure=cause instanceof Error?cause:new Error(String(cause));this.failed=true;try{this.worker?.terminate();}finally{this.worker=null;this.active=this.queued=null;this.rejectIdle?.(this.failure);this.finishIdle=this.rejectIdle=null;this.idleDone=null;}}
  private release(){this.finishIdle?.();this.finishIdle=this.rejectIdle=null;this.idleDone=null;}
}
