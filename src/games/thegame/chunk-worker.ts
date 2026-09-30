import {OpenWorld} from './world.js';
import {chunkGeometry} from './geometry.js';
import type {ChunkTicket} from '../../runtime/chunk-window.js';
let world:OpenWorld|undefined;
self.onmessage=({data}:{data:{seed:number;ticket:ChunkTicket}})=>{
 try{if(!world||world.seed!==data.seed){world?.dispose();world=new OpenWorld(data.seed,16);}const start=performance.now(),entities=chunkGeometry(world,data.ticket.x,data.ticket.z);self.postMessage({ticket:data.ticket,entities,ms:performance.now()-start});}
 catch(error){self.postMessage({ticket:data.ticket,error:error instanceof Error?error.message:String(error)});}
};
