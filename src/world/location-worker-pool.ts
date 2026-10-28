/** A worker proposes values for one fenced location tick. The host still validates
 * its current ownership/revision and commits effects at an authority boundary. */
export interface LocationWorkerToken{readonly locationId:string;readonly ownerId:string;readonly epoch:number;readonly tick:number;readonly revision:number}
export interface LocationWorkerJob<Input>{readonly token:LocationWorkerToken;readonly input:Input}
export interface LocationWorkerResult<Output>{readonly token:LocationWorkerToken;readonly output:Output}
export interface LocationWorkerRequest<PackedInput>{readonly id:number;readonly job:LocationWorkerJob<PackedInput>}
export type LocationWorkerResponse<PackedOutput>={readonly id:number;readonly result:LocationWorkerResult<PackedOutput>}|{readonly id:number;readonly error:string};
export type PoolErrorCode='closed'|'busy'|'duplicate'|'cancelled'|'timeout'|'worker';
export class SimulationPoolError extends Error{
 constructor(readonly code:PoolErrorCode,message:string){super(message);this.name='SimulationPoolError';}
}
/** Browser/Bun workers or a host adapter for another worker runtime. */
export interface LocationPoolWorker<PackedInput,PackedOutput>{
 onmessage:((event:MessageEvent<LocationWorkerResponse<PackedOutput>>)=>void)|null;
 onerror:((event:ErrorEvent)=>void)|null;
 onmessageerror:((event:MessageEvent)=>void)|null;
 addEventListener(type:'close',listener:()=>void):void;
 postMessage(message:LocationWorkerRequest<PackedInput>,transfer:Transferable[]):void;
 terminate():unknown;
}
export interface LocationWorkerCodec<Input,Output,PackedInput,PackedOutput>{
 readonly validate:(input:Input)=>void;
 /** Own a snapshot, including queued jobs; never retain live host state. */
 readonly pack:(input:Input)=>PackedInput;
 readonly unpack:(output:PackedOutput)=>Output;
 readonly transferables:(input:PackedInput)=>Transferable[];
}
export interface LocationWorkerPoolOptions<Input,Output,PackedInput,PackedOutput>{
 readonly workers?:number;readonly maxQueued?:number;readonly timeoutMs?:number;
 readonly workerUrl:URL;
 readonly workerFactory:(url:URL)=>LocationPoolWorker<PackedInput,PackedOutput>;
 readonly codec:LocationWorkerCodec<Input,Output,PackedInput,PackedOutput>;
}
type Task<PackedInput,Output>={id:number;job:LocationWorkerJob<PackedInput>;resolve:(result:LocationWorkerResult<Output>)=>void;reject:(error:Error)=>void};
type Slot<PackedInput,Output,PackedOutput>={worker:LocationPoolWorker<PackedInput,PackedOutput>|null;task:Task<PackedInput,Output>|null;timer:ReturnType<typeof setTimeout>|null};
const counter=(value:number,label:string)=>{if(!Number.isSafeInteger(value)||value<0)throw new RangeError(`${label} must be a non-negative safe integer`);};
function validateToken(token:LocationWorkerToken){
 if(!token.locationId||!token.ownerId||token.locationId.length>180||token.ownerId.length>180)throw new TypeError('Invalid owner identity');
 counter(token.epoch,'epoch');if(token.epoch===0)throw new RangeError('An acquired ownership epoch starts at one');counter(token.tick,'tick');counter(token.revision,'revision');
}
const tokenMatches=(a:LocationWorkerToken,b:LocationWorkerToken)=>a.locationId===b.locationId&&a.ownerId===b.ownerId&&a.epoch===b.epoch&&a.tick===b.tick&&a.revision===b.revision;

/** Bounded copied jobs; no automatic retry or application/game rules in the pool. */
export class LocationWorkerPool<Input,Output,PackedInput,PackedOutput>{
 private readonly slots:Slot<PackedInput,Output,PackedOutput>[];
 private readonly queue:Task<PackedInput,Output>[]=[];
 private readonly locations=new Map<string,Task<PackedInput,Output>>();
 private readonly drainWaiters:(()=>void)[]=[];
 private readonly maxQueued:number;private readonly timeoutMs:number;
 private readonly workerUrl:URL;private readonly workerFactory:LocationWorkerPoolOptions<Input,Output,PackedInput,PackedOutput>['workerFactory'];
 private readonly codec:LocationWorkerCodec<Input,Output,PackedInput,PackedOutput>;
 private serial=0;private closed=false;private aborting=false;
 private counters={submitted:0,completed:0,cancelled:0,failed:0,rejected:0,maxInFlight:0,maxQueue:0};
 constructor(options:LocationWorkerPoolOptions<Input,Output,PackedInput,PackedOutput>){
  const count=options.workers??2;this.maxQueued=options.maxQueued??16;this.timeoutMs=options.timeoutMs??5000;
  if(!Number.isInteger(count)||count<1||count>8)throw new RangeError('Worker count must be between 1 and 8');
  if(!Number.isInteger(this.maxQueued)||this.maxQueued<0||this.maxQueued>128)throw new RangeError('Queue limit must be between 0 and 128');
  if(!Number.isFinite(this.timeoutMs)||this.timeoutMs<1||this.timeoutMs>60000)throw new RangeError('Worker timeout must be between 1 and 60000 ms');
  this.slots=Array.from({length:count},()=>({worker:null,task:null,timer:null}));this.workerUrl=options.workerUrl;this.workerFactory=options.workerFactory;this.codec=Object.freeze({...options.codec});
 }
 get stats(){return {...this.counters,workers:this.slots.length,inFlight:this.slots.filter(s=>s.task).length,queued:this.queue.length,pending:this.locations.size,closed:this.closed};}
 async submit(job:LocationWorkerJob<Input>):Promise<LocationWorkerResult<Output>>{
  if(this.closed){this.counters.rejected++;throw new SimulationPoolError('closed','Simulation pool is closed');}
  validateToken(job.token);this.codec.validate(job.input);
  if(this.locations.has(job.token.locationId)){this.counters.rejected++;throw new SimulationPoolError('duplicate',`Location ${job.token.locationId} already has a pending tick`);}
  if(this.queue.length>=this.maxQueued&&this.slots.every(s=>s.task!==null)){this.counters.rejected++;throw new SimulationPoolError('busy','Simulation queue is full');}
  const snapshot={token:{...job.token},input:this.codec.pack(job.input)};
  return new Promise<LocationWorkerResult<Output>>((resolve,reject)=>{
   const task:Task<PackedInput,Output>={id:++this.serial,job:snapshot,resolve,reject};this.locations.set(snapshot.token.locationId,task);this.queue.push(task);this.counters.submitted++;
   this.pump();this.counters.maxQueue=Math.max(this.counters.maxQueue,this.queue.length);
  });
 }
 cancelLocation(locationId:string,reason='Location changed owner, revision or simulation tier'):boolean{
  const task=this.locations.get(locationId);if(!task)return false;const slot=this.slots.find(s=>s.task===task);
  if(slot)this.clearSlot(slot,true);else{const index=this.queue.indexOf(task);if(index>=0)this.queue.splice(index,1);}
  this.locations.delete(locationId);this.counters.cancelled++;task.reject(new SimulationPoolError('cancelled',reason));this.pump();this.notifyDrained();return true;
 }
 drain():Promise<void>{return this.locations.size===0?Promise.resolve():new Promise(resolve=>this.drainWaiters.push(resolve));}
 async close(options:{drain?:boolean}={}):Promise<void>{
  this.closed=true;if(options.drain)await this.drain();else{this.aborting=true;for(const id of [...this.locations.keys()])this.cancelLocation(id,'Simulation pool shut down');}
  for(const slot of this.slots)this.clearSlot(slot,true);this.notifyDrained();
 }
 private pump():void{
  if(this.aborting)return;
  for(const slot of this.slots){
   if(slot.task||!this.queue.length)continue;const task=this.queue.shift()!;slot.task=task;
   try{
    if(!slot.worker)this.startWorker(slot);
    slot.timer=setTimeout(()=>this.fail(slot,new SimulationPoolError('timeout','Location worker exceeded its time budget')),this.timeoutMs);
    slot.worker!.postMessage({id:task.id,job:task.job},this.codec.transferables(task.job.input));
    this.counters.maxInFlight=Math.max(this.counters.maxInFlight,this.slots.filter(s=>s.task).length);
   }catch(error){this.fail(slot,new SimulationPoolError('worker',error instanceof Error?error.message:'Cannot start location worker'));}
  }
 }
 private startWorker(slot:Slot<PackedInput,Output,PackedOutput>):void{
  const worker=this.workerFactory(this.workerUrl);slot.worker=worker;
  worker.onmessage=event=>{
   if(slot.worker!==worker)return;const task=slot.task,data=event.data;
   if(!task||!data||data.id!==task.id){this.fail(slot,new SimulationPoolError('worker','Unexpected location worker response'));return;}
   if('error' in data){this.fail(slot,new SimulationPoolError('worker',data.error));return;}
   if(!data.result?.token||!tokenMatches(task.job.token,data.result.token)){this.fail(slot,new SimulationPoolError('worker','Worker returned a stale or mismatched tick token'));return;}
   let result:LocationWorkerResult<Output>;
   try{result={token:data.result.token,output:this.codec.unpack(data.result.output)};}
   catch(error){this.fail(slot,new SimulationPoolError('worker',error instanceof Error?error.message:'Malformed packed worker result'));return;}
   this.clearSlot(slot,false);this.locations.delete(task.job.token.locationId);this.counters.completed++;task.resolve(result);this.pump();this.notifyDrained();
  };
  worker.onerror=event=>{event.preventDefault();if(slot.worker===worker)this.fail(slot,new SimulationPoolError('worker',event.message||'Location worker crashed'));};
  worker.onmessageerror=()=>{if(slot.worker===worker)this.fail(slot,new SimulationPoolError('worker','Location worker message could not be decoded'));};
  worker.addEventListener('close',()=>{if(slot.worker===worker)this.fail(slot,new SimulationPoolError('worker','Location worker exited before shutdown'));});
 }
 private clearSlot(slot:Slot<PackedInput,Output,PackedOutput>,terminate:boolean):void{
  if(slot.timer)clearTimeout(slot.timer);slot.timer=null;slot.task=null;if(terminate&&slot.worker){const worker=slot.worker;slot.worker=null;worker.terminate();}
 }
 private fail(slot:Slot<PackedInput,Output,PackedOutput>,error:SimulationPoolError):void{
  const task=slot.task;this.clearSlot(slot,true);if(task){this.locations.delete(task.job.token.locationId);this.counters.failed++;task.reject(error);}this.pump();this.notifyDrained();
 }
 private notifyDrained():void{if(this.locations.size===0)for(const resolve of this.drainWaiters.splice(0))resolve();}
}
