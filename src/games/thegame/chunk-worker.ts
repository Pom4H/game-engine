import {OpenWorld} from './world.js';
import {prepareChunkGeometry} from './geometry.js';
import type {ChunkTicket} from '../../runtime/chunk-window.js';
const scope=globalThis as unknown as {onmessage:((event:MessageEvent<{seed:number;ticket:ChunkTicket}>)=>void)|null;postMessage(value:unknown,transfer:Transferable[]):void};
let world:OpenWorld|undefined;
scope.onmessage=({data})=>{
 const start=performance.now();
 try{
  if(!world||world.seed!==data.seed){world?.dispose();world=new OpenWorld(data.seed,16);}
  const parts=prepareChunkGeometry(world,data.ticket.x,data.ticket.z);
  scope.postMessage({ticket:data.ticket,parts,ms:performance.now()-start},parts.flatMap(p=>[p.mesh.vertices.buffer,p.mesh.colors.buffer,p.mesh.indices.buffer] as ArrayBuffer[]));
 }catch(error){scope.postMessage({ticket:data.ticket,error:String(error)},[]);}
};
