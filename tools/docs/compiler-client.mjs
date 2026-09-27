/** Latest-wins compilation with one in-flight and one replaceable pending request. */
export class CompilerClient {
 constructor(onReply,{createWorker=()=>new Worker(new URL('./compiler-worker.js',import.meta.url)),timeoutMs=2000}={}){this.onReply=onReply;this.createWorker=createWorker;this.timeoutMs=timeoutMs;this.serial=0;this.pending=null;this.active=null;this.worker=null;this.timer=0;this.disposed=false;}
 submit(source,revision){if(this.disposed)return;const job={source,revision,id:++this.serial};this.pending=job;this.pump();}
 pump(){if(this.active||!this.pending||this.disposed)return;this.active=this.pending;this.pending=null;const worker=this.worker??=this.createWorker(),job=this.active;
  worker.onmessage=({data})=>{if(this.disposed||worker!==this.worker||data.id!==this.active?.id)return;const active=this.active;clearTimeout(this.timer);this.active=null;if(data.id===this.serial)this.onReply({...data,revision:active.revision,source:active.source});this.pump();};
  worker.onerror=event=>{event.preventDefault?.();this.fail(worker,'Ошибка worker: '+(event.message??'компилятор недоступен'));};
  this.timer=setTimeout(()=>this.fail(worker,'Выполнение остановлено по лимиту времени. Предыдущая сцена сохранена.'),this.timeoutMs);
  worker.postMessage(job);
 }
 fail(worker,error){if(this.disposed||worker!==this.worker)return;const job=this.active;clearTimeout(this.timer);worker.terminate();this.worker=null;this.active=null;if(job?.id===this.serial)this.onReply({...job,error});this.pump();}
 dispose(){this.disposed=true;clearTimeout(this.timer);this.worker?.terminate();this.worker=this.active=this.pending=null;}
}
