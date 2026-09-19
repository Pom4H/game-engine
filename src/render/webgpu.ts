import {compose,lookAt,multiply4,perspective,type Mat4,type Vec3} from '../math.js';
import {primitiveKey,primitiveMesh} from '../procedural/mesh.js';
import type {Primitive,CameraSpec} from '../scene/types.js';
import type {Scene,RuntimeEntity} from '../scene/scene.js';
import type {Renderer,RenderStats} from './types.js';

type GPUAny=any;
interface GPUMesh{vertex:GPUAny;index:GPUAny;count:number;format:'uint16'|'uint32';triangles:number}
interface GPUObject{uniform:GPUAny;bind:GPUAny}
const SHADER=`
struct U { mvp: mat4x4<f32>, model: mat4x4<f32>, color: vec4<f32> }
@group(0) @binding(0) var<uniform> u: U;
struct VOut { @builtin(position) position: vec4<f32>, @location(0) normal: vec3<f32> }
@vertex fn vs(@location(0) position: vec3<f32>, @location(1) normal: vec3<f32>) -> VOut {
 var out: VOut; out.position=u.mvp*vec4<f32>(position,1.0); out.normal=normalize((u.model*vec4<f32>(normal,0.0)).xyz); return out;
}
@fragment fn fs(in: VOut) -> @location(0) vec4<f32> {
 let light=normalize(vec3<f32>(0.45,0.9,0.3));
 let diffuse=0.22+max(dot(in.normal,light),0.0)*0.78;
 let rim=pow(1.0-max(abs(in.normal.z),0.0),2.0)*0.12;
 return vec4<f32>(u.color.rgb*(diffuse+rim),u.color.a);
}`;

export class WebGPURenderer implements Renderer{
  private constructor(
    private readonly canvas:HTMLCanvasElement,private readonly device:GPUAny,private readonly context:GPUAny,private readonly format:string,
    private readonly opaquePipeline:GPUAny,private readonly transparentPipeline:GPUAny,private readonly bindGroupLayout:GPUAny,
  ){device.addEventListener?.('uncapturederror',(event:any)=>{const message=event?.error?.message??String(event?.error??'WebGPU validation error');this.errors.push(message);console.error('Game Engine WebGPU:',message);});device.lost?.then((info:any)=>this.errors.push(`Device lost: ${info?.message??'unknown'}`));}
  private depth:GPUAny=null;private depthW=0;private depthH=0;
  private readonly meshes=new Map<string,GPUMesh>();private readonly objects=new Map<string,GPUObject>();private readonly errors:string[]=[];
  private drawCalls=0;private triangles=0;

  static async create(canvas:HTMLCanvasElement):Promise<WebGPURenderer>{
    const gpu=(navigator as any).gpu;if(!gpu)throw new Error('WebGPU is not available in this browser');
    const adapter=await gpu.requestAdapter({powerPreference:'high-performance'});if(!adapter)throw new Error('No WebGPU adapter available');
    const device=await adapter.requestDevice(),context=canvas.getContext('webgpu') as any;if(!context)throw new Error('Canvas WebGPU context is unavailable');
    const format=gpu.getPreferredCanvasFormat();context.configure({device,format,alphaMode:'opaque'});
    const shader=device.createShaderModule({code:SHADER}),vertex={module:shader,entryPoint:'vs',buffers:[{arrayStride:24,attributes:[{shaderLocation:0,offset:0,format:'float32x3'},{shaderLocation:1,offset:12,format:'float32x3'}]}]};
    const bindGroupLayout=device.createBindGroupLayout({entries:[{binding:0,visibility:3,buffer:{type:'uniform'}}]}),pipelineLayout=device.createPipelineLayout({bindGroupLayouts:[bindGroupLayout]});
    const opaquePipeline=device.createRenderPipeline({layout:pipelineLayout,vertex,fragment:{module:shader,entryPoint:'fs',targets:[{format}]},primitive:{topology:'triangle-list',cullMode:'none'},depthStencil:{format:'depth24plus',depthWriteEnabled:true,depthCompare:'less'}});
    const transparentPipeline=device.createRenderPipeline({layout:pipelineLayout,vertex,fragment:{module:shader,entryPoint:'fs',targets:[{format,blend:{color:{srcFactor:'src-alpha',dstFactor:'one-minus-src-alpha',operation:'add'},alpha:{srcFactor:'one',dstFactor:'one-minus-src-alpha',operation:'add'}}}]},primitive:{topology:'triangle-list',cullMode:'none'},depthStencil:{format:'depth24plus',depthWriteEnabled:false,depthCompare:'less'}});
    return new WebGPURenderer(canvas,device,context,format,opaquePipeline,transparentPipeline,bindGroupLayout);
  }

  resize():void{
    const ratio=Math.max(1,Math.min(2,devicePixelRatio||1)),width=Math.max(1,Math.floor(this.canvas.clientWidth*ratio)),height=Math.max(1,Math.floor(this.canvas.clientHeight*ratio));
    if(this.canvas.width!==width||this.canvas.height!==height){this.canvas.width=width;this.canvas.height=height;}
    if(!this.depth||this.depthW!==width||this.depthH!==height){this.depth?.destroy?.();this.depth=this.device.createTexture({size:[width,height],format:'depth24plus',usage:0x10});this.depthW=width;this.depthH=height;}
  }

  render(scene:Scene,camera:CameraSpec=scene.camera):void{
    this.resize();
    const view=lookAt(camera.position,camera.target),projection=perspective((camera.fov??55)*Math.PI/180,this.canvas.width/this.canvas.height),vp=multiply4(projection,view);
    const encoder=this.device.createCommandEncoder(),clear=scene.spec.clearColor??[.025,.035,.055,1];
    const pass=encoder.beginRenderPass({colorAttachments:[{view:this.context.getCurrentTexture().createView(),clearValue:{r:clear[0],g:clear[1],b:clear[2],a:clear[3]},loadOp:'clear',storeOp:'store'}],depthStencilAttachment:{view:this.depth.createView(),depthClearValue:1,depthLoadOp:'clear',depthStoreOp:'store'}});
    this.drawCalls=0;this.triangles=0;
    const visible=[...scene.entities.values()].filter(entity=>entity.mesh),opaque=visible.filter(entity=>entity.material.color[3]>=.98),transparent=visible.filter(entity=>entity.material.color[3]<.98).sort((a,b)=>distance2(b.position,camera.position)-distance2(a.position,camera.position));
    pass.setPipeline(this.opaquePipeline);for(const entity of opaque)this.draw(pass,entity,vp);
    pass.setPipeline(this.transparentPipeline);for(const entity of transparent)this.draw(pass,entity,vp);
    pass.end();this.device.queue.submit([encoder.finish()]);
  }

  async flush():Promise<void>{await this.device.queue.onSubmittedWorkDone();}
  inspect():RenderStats{return{backend:'webgpu',width:this.canvas.width,height:this.canvas.height,drawCalls:this.drawCalls,triangles:this.triangles,meshes:this.meshes.size,errors:[...this.errors]};}
  dispose():void{for(const m of this.meshes.values()){m.vertex.destroy?.();m.index.destroy?.();}for(const o of this.objects.values())o.uniform.destroy?.();this.depth?.destroy?.();this.meshes.clear();this.objects.clear();}

  private draw(pass:GPUAny,entity:RuntimeEntity,vp:Mat4):void{
    if(!entity.mesh)return;const mesh=this.mesh(entity.mesh),object=this.object(entity.id),model=this.model(entity),mvp=multiply4(vp,model),uniform=new Float32Array(36);
    uniform.set(mvp,0);uniform.set(model,16);uniform.set(entity.material.color,32);this.device.queue.writeBuffer(object.uniform,0,uniform);
    pass.setBindGroup(0,object.bind);pass.setVertexBuffer(0,mesh.vertex);pass.setIndexBuffer(mesh.index,mesh.format);pass.drawIndexed(mesh.count);this.drawCalls++;this.triangles+=mesh.triangles;
  }
  private mesh(primitive:Primitive):GPUMesh{const key=primitiveKey(primitive);const found=this.meshes.get(key);if(found)return found;const data=primitiveMesh(primitive),vertex=this.buffer(data.vertices,0x20|0x08),index=this.buffer(data.indices,0x10|0x08),mesh={vertex,index,count:data.indices.length,format:data.indexFormat,triangles:data.indices.length/3};this.meshes.set(key,mesh);return mesh;}
  private buffer(data:ArrayBufferView,usage:number):GPUAny{const buffer=this.device.createBuffer({size:Math.max(4,(data.byteLength+3)&~3),usage,mappedAtCreation:true});const target=new Uint8Array(buffer.getMappedRange());target.set(new Uint8Array(data.buffer,data.byteOffset,data.byteLength));buffer.unmap();return buffer;}
  private object(id:string):GPUObject{const existing=this.objects.get(id);if(existing)return existing;const uniform=this.device.createBuffer({size:144,usage:0x40|0x08}),bind=this.device.createBindGroup({layout:this.bindGroupLayout,entries:[{binding:0,resource:{buffer:uniform}}]}),object={uniform,bind};this.objects.set(id,object);return object;}
  private model(entity:RuntimeEntity):Mat4{
    const meshScale:Vec3=entity.mesh?.kind==='box'||entity.mesh?.kind==='shard'?entity.mesh.size??[1,1,1]:entity.mesh?.kind==='sphere'?[2*(entity.mesh.radius??1),2*(entity.mesh.radius??1),2*(entity.mesh.radius??1)]:entity.mesh?.kind==='plane'?[entity.mesh.size?.[0]??1,1,entity.mesh.size?.[1]??1]:[1,1,1];
    return compose(entity.position,entity.rotation,[entity.scale[0]*meshScale[0],entity.scale[1]*meshScale[1],entity.scale[2]*meshScale[2]]);
  }
}
function distance2(a:Vec3,b:Vec3):number{const x=a[0]-b[0],y=a[1]-b[1],z=a[2]-b[2];return x*x+y*y+z*z;}
