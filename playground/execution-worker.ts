import * as dsl from '../src/dsl/index.js';
// This disposable worker runs inside the opaque-origin compiler frame. It has no
// renderer/DOM/storage authority and its inherited CSP denies all network access.
const worker=globalThis as unknown as {onmessage:((e:MessageEvent)=>void)|null;postMessage:(value:unknown)=>void};
worker.onmessage=e=>{
 const {id,javascript}=e.data??{};
 try{
  const output:Record<string,unknown>={},traces:unknown[]=[];
  const require=(name:string)=>{if(name!=='@rom4/game-engine/dsl')throw new TypeError('Допустим только @rom4/game-engine/dsl');return dsl;};
  const trace=(index:number,value:any)=>{if(traces.length>=2048)throw new RangeError('Слишком много вызовов DSL');const owner=value?.id??value?.source?.id??value?.blueprint?.source?.id;traces.push([index,typeof owner==='string'?{id:owner}:{}]);return value;};
  new Function('exports','require','__dslTrace',javascript)(output,require,trace);
  if(!output.default)throw new TypeError('Нужен export default scene(...)');if(JSON.stringify(output.default).length>2500000)throw new RangeError('Слишком большая сцена');
  worker.postMessage({id,program:output.default,traces});
 }catch(cause){worker.postMessage({id,error:(cause as Error)?.message??String(cause)});}
};
