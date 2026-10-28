import {TheEngineRenderer} from '../../../thegame/src/game/render/the-engine-renderer.ts';
import {MeshBuilder,dynamicScene} from '../../../thegame/src/game/presentation.ts';
import {Vehicle} from '../../../thegame/src/game/runtime/physics.js';
import {registerFleet,initializeDetail} from '../../../thegame/src/game/fleet.ts';
import {createCharacter} from '../../../thegame/src/game/character.ts';
import {VehicleLightView} from '../../../thegame/src/game/render/vehicle-lights.ts';
import {WebGPURenderer as CanonicalRenderer} from '../../src/render/webgpu.ts';
import {GrassView} from '../../../thegame/src/game/grass-view.ts';
registerFleet();const canvas=document.querySelector('canvas')!,map=document.createElement('canvas');map.width=map.height=2;map.getContext('2d')!.fillStyle='#555555';map.getContext('2d')!.fillRect(0,0,2,2);
const ground=new MeshBuilder();ground.quad([-20,0,-20],[-20,0,30],[20,0,30],[20,0,-20],[.17,.18,.19],11);
const v=new Vehicle('compact',0,0,0,9000) as any;initializeDetail(v);v.y=v.spec.rideHeight;
const vehicle:any={id:'vehicle:qa',kind:'vehicle',type:'compact',x:0,y:v.y,z:0,yaw:0,vx:0,vy:0,vz:0,phase:0,animation:'idle',q:[0,0,0,1],extra:{integrity:1,panels:v.panels,glass:0,doorAngles:v.doorAngles,doors:0,cutaway:false,steeringSide:'left',occupant:'qa-driver',wheels:v.wheels.map(()=>[0,0,0]),steer:0,fallen:false,engineRunning:true}};
const actor=createCharacter('qa-driver',0,0,0);actor.seat=vehicle.id;actor.seatId='driver';actor.seatRole='driver';actor.animation='drive';
const dynamic=dynamicScene([vehicle],actor,[0,0,0],0);dynamic.instances.writer().box(1,1.5,10,1,3,1,[.5,.45,.4],21);dynamic.instances.writer().box(-3,1,5,1,2,1,[.25,.28,.3],10);
let renderer:TheEngineRenderer|undefined,shaderMode='';let replaced=0;const baseline=new Map<string,Float32Array>();
const createCanonical=CanonicalRenderer.create;let usePrototype=false;let selectedVisibility='gpu';Object.assign(CanonicalRenderer,{create(canvas:any,options:any){return createCanonical.call(CanonicalRenderer,canvas,{...options,visibility:selectedVisibility,opaqueDepthPrepass:usePrototype});}});
const depthBaselines=new Map<string,Float32Array>();
async function readDepth(engine:any){const device=engine.device,w=1280,h=720,bytes=w*h*4,module=device.createShaderModule({code:`@group(0) @binding(0) var depth:texture_depth_2d;@group(0) @binding(1) var<storage,read_write> out:array<f32>;@compute @workgroup_size(8,8) fn main(@builtin(global_invocation_id)i:vec3u){if(i.x>=1280u||i.y>=720u){return;}out[i.y*1280u+i.x]=textureLoad(depth,vec2i(i.xy),0);}`}),pipeline=await device.createComputePipelineAsync({layout:'auto',compute:{module,entryPoint:'main'}}),output=device.createBuffer({size:bytes,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_SRC}),read=device.createBuffer({size:bytes,usage:GPUBufferUsage.MAP_READ|GPUBufferUsage.COPY_DST}),encoder=device.createCommandEncoder(),pass=encoder.beginComputePass();pass.setPipeline(pipeline);pass.setBindGroup(0,device.createBindGroup({layout:pipeline.getBindGroupLayout(0),entries:[{binding:0,resource:engine.depth.createView()},{binding:1,resource:{buffer:output}}]}));pass.dispatchWorkgroups(w/8,h/8);pass.end();encoder.copyBufferToBuffer(output,0,read,0,bytes);device.queue.submit([encoder.finish()]);await read.mapAsync(GPUMapMode.READ);const values=new Float32Array(read.getMappedRange()).slice();read.unmap();read.destroy();output.destroy();return values;}
async function render({name,oldShadow=false,oldGlass=false,night=true}:{name:string;oldShadow?:boolean;oldGlass?:boolean;night?:boolean}){
 selectedVisibility=name.startsWith('cpu-instances')?'cpu':'gpu';const signature=String(oldShadow)+selectedVisibility;
 if(!renderer||shaderMode!==signature){(renderer?.engine as any)?.dispose();usePrototype=!oldShadow;renderer=await TheEngineRenderer.create(canvas as HTMLCanvasElement,29);shaderMode=signature;renderer.setWorld([],{data:ground.data},map,50);}
 renderer.configure({environmentMode:'manual',preset:night?'night':'fog',adaptive:false,renderScale:1,taa:true,bloom:true,motionBlur:0,dof:0,drawDistance:420,visual:{wetness:0,fogDensity:.013,artificialLightIntensity:1}});
 const eye=name.startsWith('nearplane')?[.2,1.05,2.12]:[7,5,-8],target=name.startsWith('nearplane')?[.2,1.05,3.12]:[0,0,12],lights=new VehicleLightView().update([vehicle],[0,0,0],eye,0);for(let k=0;k<12;k++)lights.push({key:'qa-cone:'+k,position:[(k%4-2)*4,1.8,Math.floor(k/4)*6+3],direction:[0,-.045,k%2?1:-1],color:[1,.88,.64],radius:24,intensity:80,outer:Math.cos(.55),inner:Math.cos(.08),diffuseOnly:1});const frame={eye,target,time:7,fov:.9,motionKey:'qa-static',dynamic,vehicleLights:lights};
 renderer.origin=name.startsWith('grass-rebase')?[128,0,-128]:[0,0,0];renderer.setWorld([],{data:ground.data},map,50);
 for(const e of [...renderer.projection.scene.entities.values()])if(e.id.startsWith('qa-extra:'))renderer.projection.scene.remove(e.id);
 const rebase=(p:number[])=>p.map((v,i)=>v-renderer!.origin[i]!);
 for(let j=0;j<24;j++)renderer.projection.scene.add({id:'qa-extra:layer:'+j,renderOnly:true,mesh:{kind:'box',size:[12,6,.1]},position:rebase([0,3,14+j*.2]) as any,material:{color:[.22+j*.006,.28,.33,1],roughness:.8}});
 renderer.projection.scene.add({id:'qa-extra:front',renderOnly:true,mesh:{kind:'box',size:[12,6,.2]},position:rebase([0,3,12]) as any,material:{color:[.24,.26,.28,1],roughness:.8}});
 if(name.startsWith('coplanar'))for(let i=0;i<3;i++)renderer.projection.scene.add({id:'qa-extra:overlay:'+i,renderOnly:true,mesh:{kind:'box',size:[1,2,.02]},position:rebase([0,1.5,5]) as any,material:i===2?{kind:'default',decal:{kind:'coating-loss',severity:.6,seed:41},color:[.6,.3,.2,1]}:{kind:i?'steel':'wood',color:[.2,.6,.3,1]}});
 const grass=new GrassView();const draw=(i:number)=>{const origin=renderer!.origin as number[],camera=name.startsWith('motion')?[eye[0]!+Math.sin(i*.03)*.6,eye[1]!,eye[2]!+i*.003]:eye;const geometry=dynamicScene([vehicle],actor,origin,0);grass.draw(geometry.instances,camera,origin,(x,z)=>Math.abs(x)<7&&z<10?.005:null);renderer!.render({...frame,eye:camera.map((v,j)=>v-origin[j]!),target:target.map((v,j)=>v-origin[j]!),dynamic:geometry,vehicleLights:lights.map(light=>({...light,position:rebase([...light.position])}))} as any);};
 draw(0);
 await renderer.flush();renderer.resetHistory();
 for(let i=0;i<64;i++){draw(i);await new Promise(requestAnimationFrame);}
 renderer.resetProfile();
 for(let i=0;i<64;i++){draw(i+64);await new Promise(requestAnimationFrame);}
 await renderer.flush();await (renderer.engine as any).device.queue.onSubmittedWorkDone();
 const pixels=Array.from({length:512},(_,i)=>[Math.floor((i%32+.5)*1280/32),Math.floor((Math.floor(i/32)+.5)*720/16)] as const),samples=await renderer.sampleLinearPixels(pixels,'hdr'),values=new Float32Array(samples.flatMap(s=>[...s.rgba]));let hdr:any=null;const key=name.replace(/-(before|after)$/,'');
 if(oldShadow)baseline.set(key,values);else{const before=baseline.get(key)!;let maxAbs=0,changed=0;for(let i=0;i<values.length;i++){const delta=Math.abs(values[i]!-before[i]!);maxAbs=Math.max(maxAbs,delta);if(!Object.is(values[i],before[i]))changed++;}hdr={samples:512,components:values.length,changed,maxAbs};}
 const depth=await readDepth(renderer.engine);let depthComparison:any=null;if(oldShadow)depthBaselines.set(key,depth);else{const before=depthBaselines.get(key)!;let maxAbs=0,changed=0;for(let i=0;i<depth.length;i++){maxAbs=Math.max(maxAbs,Math.abs(depth[i]!-before[i]!));if(!Object.is(depth[i],before[i]))changed++;}depthComparison={pixels:depth.length,changed,maxAbs};}
 const r=renderer.inspect() as any;return{name,oldShadow,night,errors:r.errors,engine:r.engine,resolution:r.stats.renderResolution,physics:r.projection.physicalBodies,replaced,hdr,depth:depthComparison,profile:(renderer.engine as any).inspect().profile};
}
(window as any).renderVisual=render;
(async()=>{try{(window as any).ready=true;}catch(e){(window as any).qaError=String(e);console.error(e);}})();
