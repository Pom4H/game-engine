/** Verification fixture, not a new production transport or a finished multiplayer game. */
import {createServer} from 'node:http';
import {pathToFileURL} from 'node:url';
import {StructuralBody} from '../dist/physics/structure.js';
import {StructuralStaticContactSolver} from '../dist/physics/structural-contact.js';
import {bindStructuralSkin,applyStructuralSkin} from '../dist/physics/structural-skin.js';
import {material} from '../dist/materials/catalog.js';
import {StructuralProjection,Publication,Replica} from '../dist/network/index.js';

export async function runStructuralNetworkHarness(){
 const points=[[-.4,1,0],[.4,1,0],[0,1.8,0],[0,1.2,.7]],edges=[];
 for(let a=0;a<4;a++)for(let b=a+1;b<4;b++)edges.push({kind:'distance',a,b,areaM2:1e-4,material:material('rubber').mechanical});
 const triangles=[[0,2,1],[0,1,3],[1,2,3],[2,0,3]];
 const body=new StructuralBody({nodes:points.map(position=>({position,mass:.25})),constraints:edges,iterations:8,sleepDelay:3,collisionTriangles:triangles});
 const contact=new StructuralStaticContactSolver([{center:[0,-.5,0],half:[4,.5,4]}],triangles),project=b=>contact.project(b);
 const net=new StructuralProjection('tetra-rubber/v1',body.originalPosition,edges.length),reference=[],packets=[];
 const surface=Float64Array.from(triangles.flatMap(t=>t.flatMap(i=>points[i]))),skin=bindStructuralSkin(surface,net.rest),skinOutput=new Float64Array(surface.length);
 let maxEdgeStrain=0;
 const edgeLength=(edge,p)=>Math.hypot(...[0,1,2].map(k=>p[edge.a*3+k]-p[edge.b*3+k]));
 body.applyImpulse(points[0],[.15,-.9,.2],.12);
 for(let tick=0;tick<=240;tick++){
  if(tick)body.step(1/240,[0,-9.81,0],project);
  for(const e of edges)maxEdgeStrain=Math.max(maxEdgeStrain,Math.abs(edgeLength(e,body.position)/edgeLength(e,net.rest)-1));
  if(tick%4)continue;
  const stamp={epoch:1,sequence:tick/4,tick,time:tick/240,paused:false};
  const frame=net.capture(stamp,[{id:'body',position:[0,0,0],rotation:[0,0,0],scale:[1,1,1],nodes:body.position,broken:body.broken}]);
  const publication=new Publication(net.schema,frame);packets.push(publication.text());
  applyStructuralSkin(skin,net.rest,body.position,skinOutput);reference.push({nodes:body.position.slice(),skin:skinOutput.slice(),broken:body.broken.slice()});
 }
 // Real loopback HTTP/SSE exercises serialization/stream chunking, not WAN quality.
 const server=createServer((req,res)=>{
  if(req.url!=='/state'){res.writeHead(404).end();return;}
  res.writeHead(200,{'content-type':'text/event-stream'});
  for(const packet of packets)res.write(`data: ${packet}\n\n`);res.end();
 });
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
 try{
  const url=`http://127.0.0.1:${server.address().port}/state`;
  const readers=await Promise.all([0,1].map(async()=>{
   const replica=new Replica(net.schema,1,64),view=net.bind('body',1),out=new Float64Array(surface.length),decoder=new TextDecoder();
   const response=await fetch(url,{signal:AbortSignal.timeout(5000)});let pending='',frames=0,maxNodeError=0,maxSkinError=0;
   for await(const chunk of response.body){
    pending+=decoder.decode(chunk,{stream:true});let end;
    while((end=pending.indexOf('\n\n'))>=0){
     const event=pending.slice(0,end);pending=pending.slice(end+2);const frame=net.schema.decode(event.slice(6));
     replica.receive(frame,frame.time);net.apply(replica.at(frame.time),view);applyStructuralSkin(skin,net.rest,view.nodes,out);
     const expected=reference[frames++];
     for(let i=0;i<out.length;i++)maxSkinError=Math.max(maxSkinError,Math.abs(out[i]-expected.skin[i]));
     for(let i=0;i<view.nodes.length;i++)maxNodeError=Math.max(maxNodeError,Math.abs(view.nodes[i]-expected.nodes[i]));
     for(let i=0;i<view.broken.length;i++)if(view.broken[i]!==expected.broken[i])throw new Error('Fracture state diverged');
    }
   }
   if(pending)throw new Error('Truncated SSE frame');return{frames,maxNodeError,maxSkinError};
  }));
  if(readers.some(r=>r.frames!==packets.length))throw new Error('Missing publication');
  return{clients:readers.length,framesPerClient:packets.length,authoritySteps:body.steps,encodes:net.schema.stats.encodes,
   maxNodeError:Math.max(...readers.map(r=>r.maxNodeError)),maxSkinError:Math.max(...readers.map(r=>r.maxSkinError)),maxEdgeStrain,
   maxPacketBytes:Math.max(...packets.map(p=>Buffer.byteLength(p))),contacts:contact.stats.contacts,transport:'loopback SSE'};
 }finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)console.log(JSON.stringify(await runStructuralNetworkHarness(),null,2));
