import {prepareCompilation} from './source-compiler.js';
const worker=globalThis as unknown as {onmessage:((e:MessageEvent)=>void)|null;postMessage:(value:unknown)=>void};
let active:{id:number;prepared:ReturnType<typeof prepareCompilation>}|undefined;
worker.onmessage=e=>{
 const {id,code,traces,program}=e.data??{};
 try{
  if(e.data.type==='compile'){
   const prepared=prepareCompilation(code);active={id,prepared};worker.postMessage({id,execute:prepared.javascript});
  }else if(e.data.type==='result'&&active&&id===active.id){
   if(!Array.isArray(traces)||traces.length>2048)throw new RangeError('Слишком много вызовов DSL');
   for(const [index,value]of traces)active.prepared.index.trace(index,value);
   const bindings=active.prepared.index.bindings();active=undefined;worker.postMessage({id,program,bindings});
  }
 }catch(cause){active=undefined;const e=cause as {message?:string;line?:number;column?:number};worker.postMessage({id,error:e?.message??String(cause),line:e?.line??null,column:e?.column??null});}
};
worker.postMessage({ready:true});
