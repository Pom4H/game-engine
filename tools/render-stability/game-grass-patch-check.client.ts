import {TheEngineRenderer} from '../../../thegame/src/game/render/the-engine-renderer.ts';
import {MeshBuilder,dynamicScene} from '../../../thegame/src/game/presentation.ts';
import {Vehicle} from '../../../thegame/src/game/runtime/physics.js';
import {registerFleet,initializeDetail} from '../../../thegame/src/game/fleet.ts';
import {createCharacter} from '../../../thegame/src/game/character.ts';
import {GrassView} from './fixtures/grass-view-patch-candidate.ts';
import {WebGPURenderer} from '../../src/render/webgpu.ts';
import {GrassView as ReferenceGrassView} from './fixtures/grass-view-distance-reference.ts';

registerFleet();const width=1280,height=720,canvas=document.querySelector('canvas')!,map=document.createElement('canvas');map.width=map.height=2;
map.getContext('2d')!.fillStyle='#555555';map.getContext('2d')!.fillRect(0,0,2,2);
const ground=new MeshBuilder();ground.quad([-25,0,-25],[-25,0,35],[25,0,35],[25,0,-25],[.17,.18,.19],11);
const v=new Vehicle('compact',0,0,0,9000) as any;initializeDetail(v);v.y=v.spec.rideHeight;
const vehicle:any={id:'vehicle:qa',kind:'vehicle',type:'compact',x:0,y:v.y,z:0,yaw:0,vx:0,vy:0,vz:0,phase:0,animation:'idle',q:[0,0,0,1],extra:{integrity:1,panels:v.panels,glass:0,doorAngles:v.doorAngles,doors:0,cutaway:false,steeringSide:'left',occupant:'qa-driver',wheels:v.wheels.map(()=>[0,0,0]),steer:0,fallen:false,engineRunning:true}};
const actor=createCharacter('qa-driver',0,0,0);actor.seat=vehicle.id;actor.seatId='driver';actor.seatRole='driver';actor.animation='drive';
let renderer:TheEngineRenderer|undefined,useBaseline=false,visibility='gpu';
const create=WebGPURenderer.create;Object.assign(WebGPURenderer,{async create(canvas:any,options:any){const result=await create.call(WebGPURenderer,canvas,{...options,visibility,opaqueDepthPrepass:true});return result;}});
const baselines=new Map<string,{hdr:Float32Array;depth:Float32Array}>();
async function readTexture(engine:any,depth:boolean){
 const device=engine.device,components=depth?1:4,bytes=width*height*components*4;
 const code=`@group(0) @binding(0) var image:${depth?'texture_depth_2d':'texture_2d<f32>'};@group(0) @binding(1) var<storage,read_write> out:array<${depth?'f32':'vec4f'}>;@compute @workgroup_size(8,8) fn main(@builtin(global_invocation_id)i:vec3u){if(i.x>=1280u||i.y>=720u){return;}out[i.y*1280u+i.x]=textureLoad(image,vec2i(i.xy),0);}`;
 const pipeline=await device.createComputePipelineAsync({layout:'auto',compute:{module:device.createShaderModule({code}),entryPoint:'main'}});
 const output=device.createBuffer({size:bytes,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_SRC}),read=device.createBuffer({size:bytes,usage:GPUBufferUsage.MAP_READ|GPUBufferUsage.COPY_DST}),encoder=device.createCommandEncoder(),pass=encoder.beginComputePass();
 pass.setPipeline(pipeline);pass.setBindGroup(0,device.createBindGroup({layout:pipeline.getBindGroupLayout(0),entries:[{binding:0,resource:(depth?engine.depth:engine.hdr).createView()},{binding:1,resource:{buffer:output}}]}));pass.dispatchWorkgroups(width/8,height/8);pass.end();encoder.copyBufferToBuffer(output,0,read,0,bytes);device.queue.submit([encoder.finish()]);await read.mapAsync(GPUMapMode.READ);const result=new Float32Array(read.getMappedRange()).slice();read.unmap();read.destroy();output.destroy();return result;
}
function comparison(before:Float32Array,after:Float32Array){let changed=0,maxAbs=0,maxUlps=0;const a=new Uint32Array(before.buffer,before.byteOffset,before.length),b=new Uint32Array(after.buffer,after.byteOffset,after.length);for(let i=0;i<after.length;i++){if(!Object.is(before[i],after[i]))changed++;maxAbs=Math.max(maxAbs,Math.abs(before[i]!-after[i]!));maxUlps=Math.max(maxUlps,Math.abs(a[i]!-b[i]!));}return{components:after.length,changed,maxAbs,maxUlps};}
(window as any).renderVisual=async({name,baseline}:{name:string;baseline:boolean})=>{
 (renderer?.engine as any)?.dispose();useBaseline=baseline;visibility=name==='cpu-instances'?'cpu':'gpu';renderer=await TheEngineRenderer.create(canvas as HTMLCanvasElement,29);renderer.setWorld([],{data:ground.data},map,50);
 renderer.configure({environmentMode:'manual',preset:name==='coplanar-order'?'clear':'night',adaptive:false,renderScale:1,taa:true,bloom:true,motionBlur:0,dof:0,drawDistance:420,visual:{wetness:0,fogDensity:.004,artificialLightIntensity:1}});
 renderer.origin=name==='grass-rebase'?[128,0,-128]:[0,0,0];renderer.setWorld([],{data:ground.data},map,50);const origin=renderer.origin,scene=renderer.projection.scene;
 const local=(p:number[])=>p.map((v,i)=>v-origin[i]!) as any;
 const add=(i:number)=>scene.add({id:'qa-extra:'+i,renderOnly:true,mesh:{kind:'box',size:i<2?[2,2,.04]:[.4,1,.4]},position:local(i<2?[0,1.5,5]:[(i%12-6)*1.1,.5,Math.floor(i/12)*1.3+8]),material:{kind:i===0?'steel':'wood',color:i===0?[.6,.2,.1,1]:[.2,.45,.3,i===3?.4:1],roughness:.7}});
 for(let i=0;i<120;i++)add(i);const grass=baseline?new ReferenceGrassView():new GrassView(),eye=name==="nearplane"?[1.1,.06,1.2]:[7,5,-8],target=name==="nearplane"?[1.1,.06,2.2]:[0,0,12];
 const draw=(frame:number)=>{(renderer!.engine as any).setTimelineFrame(frame);const camera=name==='motion'?[eye[0]!+Math.sin(frame*.04)*.6,eye[1]!,eye[2]!+frame*.003]:eye,dynamic=dynamicScene([vehicle],actor,origin,0);grass.draw(dynamic.instances,camera,origin,(x,z)=>Math.abs(x)<7&&z<10?.005:null);renderer!.render({eye:local(camera),target:local(target),time:7,fov:.9,motionKey:'qa-static',dynamic,vehicleLights:[{key:'qa-cone',position:local([0,2,0]),direction:[0,-.05,1],color:[1,.88,.64],radius:24,intensity:80,outer:Math.cos(.55),inner:Math.cos(.08),diffuseOnly:1}]} as any);};
 for(let i=0;i<32;i++){draw(i);await new Promise(requestAnimationFrame);}await renderer.flush();
 const preparationBefore=(renderer.engine as any).inspect().preparation;
 if(name==='coplanar-order'){scene.remove('qa-extra:0');add(0);}
 else if(name==='visibility'){scene.setRenderVisible('qa-extra:0',false);scene.setRenderVisible('qa-extra:7',false);}
 else{scene.remove('qa-extra:0');for(let i=10;i<90;i+=3)scene.remove('qa-extra:'+i);}
 if(name==='motion'){scene.entities.get('qa-extra:1')!.position[0]+=.125;scene.entities.get('qa-extra:2')!.rotation[1]+=.2;}
 if(name==='cpu-instances'){scene.remove('qa-extra:6');add(6);}
 // Publish any exact environment rebake caused by the topology transition
 // before starting the paired TAA history. Worker completion timing is not an
 // input to this cache oracle; the production bake and its output stay enabled.
 draw(32);await renderer.flush();renderer.resetHistory();for(let i=0;i<64;i++){draw(i+33);await new Promise(requestAnimationFrame);}await renderer.flush();await (renderer.engine as any).device.queue.onSubmittedWorkDone();
 const hdr=await readTexture(renderer.engine,false),depth=await readTexture(renderer.engine,true);let oracle:any=null;
 if(baseline)baselines.set(name,{hdr,depth});else{const before=baselines.get(name)!;oracle={hdr:comparison(before.hdr,hdr),depth:comparison(before.depth,depth)};baselines.delete(name);}
 const report=renderer.inspect() as any;return{name,baseline,errors:report.errors,engine:report.engine,resolution:report.stats.renderResolution,physics:report.projection.physicalBodies,oracle,preparationBefore,preparationAfter:(renderer.engine as any).inspect().preparation,stats:report.stats,profile:(renderer.engine as any).inspect().profile,sourceOrder:[...scene.entities.keys()].filter(id=>id.startsWith('qa-extra:'))};
};
(window as any).ready=true;
