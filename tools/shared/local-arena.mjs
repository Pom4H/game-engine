/** Bounded control RPC beside the replaceable absolute-state stream. */
export class LocalArena {
 worker=new Worker(new URL('./local-arena-worker.mjs',import.meta.url),{type:'module'});
 #pending=new Map();#sequence=0;#disposed=false;
 constructor(){this.worker.addEventListener('message',({data})=>{if(data.kind!=='response')return;const request=this.#pending.get(data.id);if(!request)return;clearTimeout(request.timer);this.#pending.delete(data.id);if(data.error)request.reject(Error(data.error));else request.resolve(data.result);});this.worker.addEventListener('error',event=>this.dispose(Error(event.message)));}
 request(action,data={}){
  if(this.#disposed)return Promise.reject(Error('Local authority stopped'));
  if(this.#pending.size>=8)return Promise.reject(Error('Local control queue is full'));
  return new Promise((resolve,reject)=>{const id=++this.#sequence,timer=setTimeout(()=>{this.#pending.delete(id);reject(Error('Local authority timed out'));},10000);this.#pending.set(id,{resolve,reject,timer});this.worker.postMessage({kind:'request',id,action,data});});
 }
 dispose(error=Error('Local authority stopped')){if(this.#disposed)return;this.#disposed=true;this.worker.terminate();for(const p of this.#pending.values()){clearTimeout(p.timer);p.reject(error);}this.#pending.clear();}
}
