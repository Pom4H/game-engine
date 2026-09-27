import {bakeEnvironment,type EnvironmentInput} from './environment-bake.js';
const scope=globalThis as unknown as {onmessage:((event:MessageEvent<{id:number;epoch:number;key:string;input:EnvironmentInput}>)=>void)|null;postMessage(value:unknown,transfer?:Transferable[]):void};
scope.onmessage=({data})=>{
 try{const mips=bakeEnvironment(data.input);scope.postMessage({id:data.id,epoch:data.epoch,key:data.key,mips},mips.map(m=>m.pixels.buffer as ArrayBuffer));}
 catch(error){scope.postMessage({id:data.id,epoch:data.epoch,error:String(error)});}
};
