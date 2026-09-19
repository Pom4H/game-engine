import {compose,lookAt,multiply4,perspective,type Mat4,type Vec3} from '../math.js';
import {primitiveKey,primitiveMesh} from '../procedural/mesh.js';
import type {Primitive,CameraSpec} from '../scene/types.js';
import type {Scene,RuntimeEntity} from '../scene/scene.js';
import type {Renderer,RenderStats} from './types.js';

type GPUAny=any;
interface GPUMesh{vertex:GPUAny;index:GPUAny;count:number;format:'uint16'|'uint32';triangles:number}
interface GPUObject{uniform:GPUAny;bind:GPUAny}
const SHADER=`
struct U {
  mvp: mat4x4<f32>,
  model: mat4x4<f32>,
  color: vec4<f32>,
  surface: vec4<f32>,     // moss, wetness, roughness, darkening
  weather: vec4<f32>,     // dirt, wear, seed, material kind
  winter: vec4<f32>,      // snow depth m, water depth m, slush, ice depth m
  winter2: vec4<f32>,     // puddle, track melt, body snow, rear snow
  environment: vec4<f32>, // air C, sunlight, hour/24, surface-use code
  motion: vec4<f32>,      // dir x, dir z, road dirt, body wetness
  camera: vec4<f32>,
  lightPos0: vec4<f32>,
  lightColor0: vec4<f32>,
  lightPos1: vec4<f32>,
  lightColor1: vec4<f32>,
  lightPos2: vec4<f32>,
  lightColor2: vec4<f32>,
  lightPos3: vec4<f32>,
  lightColor3: vec4<f32>,
}
@group(0) @binding(0) var<uniform> u: U;

struct VOut {
  @builtin(position) position: vec4<f32>,
  @location(0) normal: vec3<f32>,
  @location(1) worldPos: vec3<f32>,
}

fn hash3(p:vec3<f32>)->f32 {
  return fract(sin(dot(p,vec3<f32>(127.1,311.7,74.7)))*43758.5453123);
}
fn noise3(p:vec3<f32>)->f32 {
  let i=floor(p);let f=fract(p);let s=f*f*(3.0-2.0*f);
  let n000=hash3(i+vec3<f32>(0,0,0));let n100=hash3(i+vec3<f32>(1,0,0));
  let n010=hash3(i+vec3<f32>(0,1,0));let n110=hash3(i+vec3<f32>(1,1,0));
  let n001=hash3(i+vec3<f32>(0,0,1));let n101=hash3(i+vec3<f32>(1,0,1));
  let n011=hash3(i+vec3<f32>(0,1,1));let n111=hash3(i+vec3<f32>(1,1,1));
  let nx00=mix(n000,n100,s.x);let nx10=mix(n010,n110,s.x);
  let nx01=mix(n001,n101,s.x);let nx11=mix(n011,n111,s.x);
  return mix(mix(nx00,nx10,s.y),mix(nx01,nx11,s.y),s.z);
}
fn fbm(p:vec3<f32>)->f32 {
  return noise3(p)*0.58+noise3(p*2.07+17.3)*0.28+noise3(p*4.11+41.7)*0.14;
}
fn tileSeam(p:vec2<f32>)->f32{
  let cell=fract(p/0.62);
  let edge=min(min(cell.x,1.0-cell.x),min(cell.y,1.0-cell.y));
  return 1.0-smoothstep(0.018,0.045,edge);
}
fn tyreTracks(z:f32)->f32{
  let repeated=abs(fract((z+0.34)/1.55)-0.5);
  return 1.0-smoothstep(0.065,0.13,repeated);
}

@vertex fn vs(@location(0) position: vec3<f32>, @location(1) normal: vec3<f32>) -> VOut {
  var out: VOut;
  let world=u.model*vec4<f32>(position,1.0);
  out.position=u.mvp*vec4<f32>(position,1.0);
  out.worldPos=world.xyz;
  out.normal=normalize((u.model*vec4<f32>(normal,0.0)).xyz);
  return out;
}

fn pointLight(pos:vec4<f32>,color:vec4<f32>,world:vec3<f32>,n:vec3<f32>,viewDir:vec3<f32>,roughness:f32)->vec3<f32>{
  if(pos.w<=0.0||color.w<=0.0){return vec3<f32>(0.0);}
  let delta=pos.xyz-world;let distance=max(length(delta),0.001);let l=delta/distance;
  let attenuation=pow(max(0.0,1.0-distance/pos.w),2.0)*color.w;
  let diffuse=max(dot(n,l),0.0);
  let h=normalize(l+viewDir);let specPower=mix(110.0,10.0,roughness);let spec=pow(max(dot(n,h),0.0),specPower);
  return color.rgb*attenuation*(diffuse*.72+spec*.32);
}

@fragment fn fs(in: VOut) -> @location(0) vec4<f32> {
  let n=normalize(in.normal);
  let viewDir=normalize(u.camera.xyz-in.worldPos);
  let sunlight=u.environment.y;
  let hour=u.environment.z*24.0;
  let sunrise=exp(-pow((hour-7.4)/1.15,2.0))*sunlight;
  let light=normalize(vec3<f32>(mix(0.18,0.46,sunlight),mix(0.68,0.92,sunlight),mix(0.22,0.34,sunlight)));
  let halfDir=normalize(light+viewDir);
  let ndl=max(dot(n,light),0.0);

  var albedo=u.color.rgb;
  let materialKind=u.weather.w;
  let surfaceUse=u.environment.w;
  let seed=vec3<f32>(u.weather.z*13.7,u.weather.z*7.1,u.weather.z*3.9);
  let upward=smoothstep(0.05,0.82,n.y);

  // Concrete / paving. Square sidewalk tiles are a semantic surface consequence.
  if(materialKind>3.5 && materialKind<4.5) {
    let coarse=fbm(in.worldPos*2.4+seed);
    let pores=fbm(in.worldPos*14.0+seed*2.3);
    albedo*=0.78+coarse*0.24+pores*0.07;
    if(surfaceUse>1.5 && surfaceUse<2.5){
      let seam=tileSeam(in.worldPos.xz);
      albedo=mix(albedo,albedo*0.42,seam*.72);
      albedo*=0.93+fbm(vec3<f32>(floor(in.worldPos.x/0.62),0.0,floor(in.worldPos.z/0.62))+seed)*0.1;
    }

    let sheltered=1.0-smoothstep(0.42,0.96,abs(n.y));
    let growthField=fbm(in.worldPos*1.35+seed*4.2)*0.72+fbm(in.worldPos*5.7+seed)*0.28;
    let moistureBias=u.surface.y*0.28+upward*0.22+sheltered*0.07;
    let threshold=0.94-u.surface.x*0.62;
    let mossMask=smoothstep(threshold-0.16,threshold+0.04,growthField+moistureBias);
    let mossVariation=fbm(in.worldPos*8.5+seed*8.0);
    let mossColor=mix(vec3<f32>(0.035,0.075,0.02),vec3<f32>(0.16,0.27,0.065),mossVariation);
    albedo=mix(albedo,mossColor,mossMask*u.surface.x);
  }

  // Asphalt is synthesized from aggregate and binder. Traffic only reveals tracks
  // after the physics/environment system has accumulated trackMelt.
  if(materialKind>4.5 && materialKind<5.5){
    let aggregate=fbm(in.worldPos*19.0+seed)*0.14+fbm(in.worldPos*55.0+seed*2.0)*0.05;
    albedo*=0.72+aggregate;
    let track=tyreTracks(in.worldPos.z)*u.winter2.y;
    albedo=mix(albedo,albedo*0.48,track*(0.35+u.winter.z*.35));
  }

  // Snow accumulation is derived from mass balance. Road tracks expose wet/slushy
  // asphalt only if traffic actually supplied enough contact work.
  let snowBase=clamp(u.winter.x/0.055,0.0,1.0);
  var snowMask=upward*snowBase*smoothstep(0.12,0.82,fbm(in.worldPos*1.9+seed*3.1)+snowBase*.74);
  if(surfaceUse>.5 && surfaceUse<1.5){
    snowMask*=1.0-tyreTracks(in.worldPos.z)*u.winter2.y*.96;
  }
  if(surfaceUse>2.5 && surfaceUse<3.5){
    snowMask=clamp(snowMask+snowBase*.38,0.0,1.0);
  }
  let slushColor=mix(vec3<f32>(0.48,0.5,0.5),vec3<f32>(0.22,0.19,0.16),clamp(u.weather.x+u.motion.z,0.0,1.0));
  albedo=mix(albedo,slushColor,snowMask*u.winter.z*.52);
  albedo=mix(albedo,vec3<f32>(0.89,0.93,0.97),snowMask*(1.0-u.winter.z*.55));

  // Moving bodies accumulate fresh snow on upward and rear-facing surfaces.
  let motionDir=normalize(vec3<f32>(u.motion.x,0.0,u.motion.y)+vec3<f32>(0.0001,0.0,0.0));
  let rearFacing=smoothstep(0.05,0.9,dot(n,-motionDir));
  let bodySnow=clamp(u.winter2.z*upward+u.winter2.w*rearFacing,0.0,1.0);
  albedo=mix(albedo,vec3<f32>(0.91,0.945,0.98),bodySnow*smoothstep(.18,.78,fbm(in.worldPos*4.4+seed)+.25));

  // Water is also state, not a material override. Procedural depressions localize
  // the scalar water volume into shallow puddles.
  let depression=1.0-fbm(in.worldPos*0.58+seed*6.0);
  let puddleMask=u.winter2.x*smoothstep(0.7-u.winter2.x*.35,0.9-u.winter2.x*.12,depression)*upward;
  let wetness=clamp(u.surface.y+u.motion.w+u.winter.y/0.006+puddleMask*.5,0.0,1.0);
  albedo*=1.0-u.surface.w-wetness*.24;

  let effectiveRoughness=clamp(u.surface.z-wetness*.36,0.045,1.0);
  let ambient=.19+sunlight*.25;
  let diffuse=ambient+mix(.22,.7,sunlight)*ndl;
  let specPower=mix(120.0,7.0,effectiveRoughness);
  let spec=pow(max(dot(n,halfDir),0.0),specPower)*(0.018+wetness*.52+puddleMask*.42);
  let rim=pow(1.0-max(abs(dot(n,viewDir)),0.0),2.2)*0.035;
  let warm=vec3<f32>(1.0,.54,.22)*sunrise*(ndl*.18+spec*.28);
  let nightTint=mix(vec3<f32>(.62,.69,.82),vec3<f32>(1.0,1.0,1.0),sunlight);
  let points=
    pointLight(u.lightPos0,u.lightColor0,in.worldPos,n,viewDir,effectiveRoughness)+
    pointLight(u.lightPos1,u.lightColor1,in.worldPos,n,viewDir,effectiveRoughness)+
    pointLight(u.lightPos2,u.lightColor2,in.worldPos,n,viewDir,effectiveRoughness)+
    pointLight(u.lightPos3,u.lightColor3,in.worldPos,n,viewDir,effectiveRoughness);
  return vec4<f32>((albedo*diffuse+vec3<f32>(spec+rim))*nightTint+warm+points,u.color.a);
}`;

const SNOW_SHADER=`
struct S {
  vp: mat4x4<f32>,
  camera: vec4<f32>,
  params: vec4<f32>, // time, intensity, wind x, wind z
}
@group(0) @binding(0) var<uniform> s:S;

struct O {
  @builtin(position) position:vec4<f32>,
  @location(0) alpha:f32,
}

fn hash1(n:f32)->f32{return fract(sin(n)*43758.5453123);}

@vertex fn vs(@builtin(vertex_index) vertex:u32,@builtin(instance_index) instance:u32)->O{
  let i=f32(instance)+1.0;
  let rx=hash1(i*12.9898);let rz=hash1(i*78.233);let ry=hash1(i*31.731);
  let fall=fract(ry-s.params.x*(0.22+hash1(i*5.17)*0.16));
  let windAge=1.0-fall;
  let world=vec3<f32>(
    s.camera.x+(rx-.5)*30.0+s.params.z*windAge*.65,
    s.camera.y-3.0+fall*13.0,
    s.camera.z+(rz-.5)*26.0+s.params.w*windAge*.65
  );
  let center=s.vp*vec4<f32>(world,1.0);
  var corner=vec2<f32>(0.0,0.0);
  if(vertex==0u){corner=vec2<f32>(-1.0,-1.0);}
  if(vertex==1u){corner=vec2<f32>( 1.0,-1.0);}
  if(vertex==2u){corner=vec2<f32>( 1.0, 1.0);}
  if(vertex==3u){corner=vec2<f32>(-1.0,-1.0);}
  if(vertex==4u){corner=vec2<f32>( 1.0, 1.0);}
  if(vertex==5u){corner=vec2<f32>(-1.0, 1.0);}
  let size=(0.0017+hash1(i*9.13)*0.0022)*center.w;
  var out:O;
  out.position=center+vec4<f32>(corner.x*size,corner.y*size*1.7,0.0,0.0);
  out.alpha=s.params.y*(0.32+hash1(i*3.77)*0.48);
  return out;
}
@fragment fn fs(in:O)->@location(0) vec4<f32>{
  return vec4<f32>(0.91,0.95,1.0,in.alpha);
}
`;

export class WebGPURenderer implements Renderer{
  private constructor(
    private readonly canvas:HTMLCanvasElement,private readonly device:GPUAny,private readonly context:GPUAny,private readonly format:string,
    private readonly opaquePipeline:GPUAny,private readonly transparentPipeline:GPUAny,private readonly bindGroupLayout:GPUAny,
    private readonly snowPipeline:GPUAny,private readonly snowUniform:GPUAny,private readonly snowBind:GPUAny,
  ){device.addEventListener?.('uncapturederror',(event:any)=>{const message=event?.error?.message??String(event?.error??'WebGPU validation error');this.errors.push(message);console.error('Game Engine WebGPU:',message);});device.lost?.then((info:any)=>this.errors.push(`Device lost: ${info?.message??'unknown'}`));}
  private depth:GPUAny=null;private depthW=0;private depthH=0;
  private readonly meshes=new Map<string,GPUMesh>();private readonly objects=new Map<string,GPUObject>();private readonly errors:string[]=[];
  private drawCalls=0;private triangles=0;private lastCamera:Vec3=[0,0,0];private lastScene:Scene|null=null;private lastLights:RuntimeEntity[]=[];

  static async create(canvas:HTMLCanvasElement):Promise<WebGPURenderer>{
    const gpu=(navigator as any).gpu;if(!gpu)throw new Error('WebGPU is not available in this browser');
    const adapter=await gpu.requestAdapter({powerPreference:'high-performance'});if(!adapter)throw new Error('No WebGPU adapter available');
    const device=await adapter.requestDevice(),context=canvas.getContext('webgpu') as any;if(!context)throw new Error('Canvas WebGPU context is unavailable');
    const format=gpu.getPreferredCanvasFormat();context.configure({device,format,alphaMode:'opaque'});
    const shader=device.createShaderModule({code:SHADER}),vertex={module:shader,entryPoint:'vs',buffers:[{arrayStride:24,attributes:[{shaderLocation:0,offset:0,format:'float32x3'},{shaderLocation:1,offset:12,format:'float32x3'}]}]};
    const bindGroupLayout=device.createBindGroupLayout({entries:[{binding:0,visibility:3,buffer:{type:'uniform'}}]}),pipelineLayout=device.createPipelineLayout({bindGroupLayouts:[bindGroupLayout]});
    const opaquePipeline=device.createRenderPipeline({layout:pipelineLayout,vertex,fragment:{module:shader,entryPoint:'fs',targets:[{format}]},primitive:{topology:'triangle-list',cullMode:'none'},depthStencil:{format:'depth24plus',depthWriteEnabled:true,depthCompare:'less'}});
    const transparentPipeline=device.createRenderPipeline({layout:pipelineLayout,vertex,fragment:{module:shader,entryPoint:'fs',targets:[{format,blend:{color:{srcFactor:'src-alpha',dstFactor:'one-minus-src-alpha',operation:'add'},alpha:{srcFactor:'one',dstFactor:'one-minus-src-alpha',operation:'add'}}}]},primitive:{topology:'triangle-list',cullMode:'none'},depthStencil:{format:'depth24plus',depthWriteEnabled:false,depthCompare:'less'}});
    const snowShader=device.createShaderModule({code:SNOW_SHADER}),snowLayout=device.createBindGroupLayout({entries:[{binding:0,visibility:1,buffer:{type:'uniform'}}]}),snowPipelineLayout=device.createPipelineLayout({bindGroupLayouts:[snowLayout]});
    const snowPipeline=device.createRenderPipeline({layout:snowPipelineLayout,vertex:{module:snowShader,entryPoint:'vs'},fragment:{module:snowShader,entryPoint:'fs',targets:[{format,blend:{color:{srcFactor:'src-alpha',dstFactor:'one-minus-src-alpha',operation:'add'},alpha:{srcFactor:'one',dstFactor:'one-minus-src-alpha',operation:'add'}}}]},primitive:{topology:'triangle-list',cullMode:'none'},depthStencil:{format:'depth24plus',depthWriteEnabled:false,depthCompare:'less'}});
    const snowUniform=device.createBuffer({size:96,usage:0x40|0x08}),snowBind=device.createBindGroup({layout:snowLayout,entries:[{binding:0,resource:{buffer:snowUniform}}]});
    return new WebGPURenderer(canvas,device,context,format,opaquePipeline,transparentPipeline,bindGroupLayout,snowPipeline,snowUniform,snowBind);
  }

  resize():void{
    const ratio=Math.max(1,Math.min(2,devicePixelRatio||1)),width=Math.max(1,Math.floor(this.canvas.clientWidth*ratio)),height=Math.max(1,Math.floor(this.canvas.clientHeight*ratio));
    if(this.canvas.width!==width||this.canvas.height!==height){this.canvas.width=width;this.canvas.height=height;}
    if(!this.depth||this.depthW!==width||this.depthH!==height){this.depth?.destroy?.();this.depth=this.device.createTexture({size:[width,height],format:'depth24plus',usage:0x10});this.depthW=width;this.depthH=height;}
  }

  render(scene:Scene,camera:CameraSpec=scene.camera):void{
    this.resize();this.lastCamera=camera.position;this.lastScene=scene;this.lastLights=[...scene.entities.values()].filter(entity=>entity.light?.kind==='point');
    const view=lookAt(camera.position,camera.target),projection=perspective((camera.fov??55)*Math.PI/180,this.canvas.width/this.canvas.height),vp=multiply4(projection,view);
    const encoder=this.device.createCommandEncoder(),clear=scene.spec.clearColor??environmentClear(scene.environment);
    const pass=encoder.beginRenderPass({colorAttachments:[{view:this.context.getCurrentTexture().createView(),clearValue:{r:clear[0],g:clear[1],b:clear[2],a:clear[3]},loadOp:'clear',storeOp:'store'}],depthStencilAttachment:{view:this.depth.createView(),depthClearValue:1,depthLoadOp:'clear',depthStoreOp:'store'}});
    this.drawCalls=0;this.triangles=0;
    const visible=[...scene.entities.values()].filter(entity=>entity.mesh),opaque=visible.filter(entity=>entity.material.color[3]>=.98),transparent=visible.filter(entity=>entity.material.color[3]<.98).sort((a,b)=>distance2(b.position,camera.position)-distance2(a.position,camera.position));
    pass.setPipeline(this.opaquePipeline);for(const entity of opaque)this.draw(pass,entity,vp);
    pass.setPipeline(this.transparentPipeline);for(const entity of transparent)this.draw(pass,entity,vp);
    const snowIntensity=Math.max(0,Math.min(1,scene.environment.snowfallRate/2.2e-5));
    if(snowIntensity>.001){
      const snowData=new Float32Array(24);snowData.set(vp,0);snowData.set([camera.position[0],camera.position[1],camera.position[2],1],16);
      snowData.set([scene.time,snowIntensity,scene.environment.wind[0],scene.environment.wind[2]],20);
      this.device.queue.writeBuffer(this.snowUniform,0,snowData);pass.setPipeline(this.snowPipeline);pass.setBindGroup(0,this.snowBind);
      const flakes=Math.max(80,Math.round(900*snowIntensity));pass.draw(6,flakes);this.drawCalls++;this.triangles+=flakes*2;
    }
    pass.end();this.device.queue.submit([encoder.finish()]);
  }

  async flush():Promise<void>{await this.device.queue.onSubmittedWorkDone();}
  inspect():RenderStats{return{backend:'webgpu',width:this.canvas.width,height:this.canvas.height,drawCalls:this.drawCalls,triangles:this.triangles,meshes:this.meshes.size,errors:[...this.errors]};}
  dispose():void{for(const m of this.meshes.values()){m.vertex.destroy?.();m.index.destroy?.();}for(const o of this.objects.values())o.uniform.destroy?.();this.snowUniform.destroy?.();this.depth?.destroy?.();this.meshes.clear();this.objects.clear();}

  private draw(pass:GPUAny,entity:RuntimeEntity,vp:Mat4):void{
    if(!entity.mesh)return;const mesh=this.mesh(entity.mesh),object=this.object(entity.id),model=this.model(entity),mvp=multiply4(vp,model),uniform=new Float32Array(96),surface=entity.material.surface;
    const winter=this.lastScene?.winter.surface(entity.id),bodyWeather=this.lastScene?.winter.body(entity.id),environment=this.lastScene?.environment;
    uniform.set(mvp,0);uniform.set(model,16);uniform.set(entity.material.color,32);
    uniform.set([surface.moss,surface.wetness,surface.roughness,surface.darkening],36);
    uniform.set([surface.dirt,surface.wear,stableSeed(entity.id),materialCode(entity.material.kind)],40);
    uniform.set([winter?.snowDepthM??0,winter?.waterDepthM??0,winter?.slush??0,winter?.iceDepthM??0],44);
    uniform.set([winter?.puddle??0,winter?.trackMelt??0,bodyWeather?.snowCoverage??0,bodyWeather?.rearSnow??0],48);
    uniform.set([environment?.temperatureC??18,environment?.sunlight??.65,(environment?.hour??12)/24,surfaceUseCode(entity.environmental?.surfaceUse)],52);
    uniform.set([bodyWeather?.directionX??1,bodyWeather?.directionZ??0,bodyWeather?.roadDirt??0,bodyWeather?.wetness??0],56);
    uniform.set([this.lastCamera[0],this.lastCamera[1],this.lastCamera[2],1],60);
    const nearest=this.lastLights.slice().sort((a,b)=>distance2(a.position,entity.position)-distance2(b.position,entity.position)).slice(0,4);
    for(let i=0;i<4;i++){const light=nearest[i]?.light,source=nearest[i],offset=64+i*8;if(light&&source){const color=light.color??[1,.78,.5];uniform.set([source.position[0],source.position[1],source.position[2],light.range??12],offset);uniform.set([color[0],color[1],color[2],light.intensity??1],offset+4);}}
    this.device.queue.writeBuffer(object.uniform,0,uniform);
    pass.setBindGroup(0,object.bind);pass.setVertexBuffer(0,mesh.vertex);pass.setIndexBuffer(mesh.index,mesh.format);pass.drawIndexed(mesh.count);this.drawCalls++;this.triangles+=mesh.triangles;
  }
  private mesh(primitive:Primitive):GPUMesh{const key=primitiveKey(primitive);const found=this.meshes.get(key);if(found)return found;const data=primitiveMesh(primitive),vertex=this.buffer(data.vertices,0x20|0x08),index=this.buffer(data.indices,0x10|0x08),mesh={vertex,index,count:data.indices.length,format:data.indexFormat,triangles:data.indices.length/3};this.meshes.set(key,mesh);return mesh;}
  private buffer(data:ArrayBufferView,usage:number):GPUAny{const buffer=this.device.createBuffer({size:Math.max(4,(data.byteLength+3)&~3),usage,mappedAtCreation:true});const target=new Uint8Array(buffer.getMappedRange());target.set(new Uint8Array(data.buffer,data.byteOffset,data.byteLength));buffer.unmap();return buffer;}
  private object(id:string):GPUObject{const existing=this.objects.get(id);if(existing)return existing;const uniform=this.device.createBuffer({size:384,usage:0x40|0x08}),bind=this.device.createBindGroup({layout:this.bindGroupLayout,entries:[{binding:0,resource:{buffer:uniform}}]}),object={uniform,bind};this.objects.set(id,object);return object;}
  private model(entity:RuntimeEntity):Mat4{
    const meshScale:Vec3=entity.mesh?.kind==='box'||entity.mesh?.kind==='shard'?entity.mesh.size??[1,1,1]:entity.mesh?.kind==='sphere'?[2*(entity.mesh.radius??1),2*(entity.mesh.radius??1),2*(entity.mesh.radius??1)]:entity.mesh?.kind==='plane'?[entity.mesh.size?.[0]??1,1,entity.mesh.size?.[1]??1]:[1,1,1];
    return compose(entity.position,entity.rotation,[entity.scale[0]*meshScale[0],entity.scale[1]*meshScale[1],entity.scale[2]*meshScale[2]]);
  }
}
function distance2(a:Vec3,b:Vec3):number{const x=a[0]-b[0],y=a[1]-b[1],z=a[2]-b[2];return x*x+y*y+z*z;}

function materialCode(kind:string):number{return kind==='glass'?1:kind==='steel'?2:kind==='wood'?3:kind==='concrete'?4:kind==='asphalt'?5:0;}
function stableSeed(value:string):number{let h=2166136261>>>0;for(let i=0;i<value.length;i++){h^=value.charCodeAt(i);h=Math.imul(h,16777619);}return(h>>>0)/4294967295;}

function surfaceUseCode(use:string|undefined):number{return use==='road'?1:use==='sidewalk'?2:use==='curb'?3:0;}
function environmentClear(environment:{sunlight:number;hour:number}):readonly[number,number,number,number]{
  const sun=Math.max(0,Math.min(1,environment.sunlight)),hour=environment.hour,sunrise=Math.exp(-Math.pow((hour-7.3)/1.4,2))*sun;
  const night:[number,number,number]=[.006,.012,.026],day:[number,number,number]=[.34,.57,.79],warm:[number,number,number]=[.82,.38,.16];
  return[
    night[0]+(day[0]-night[0])*sun+warm[0]*sunrise*.18,
    night[1]+(day[1]-night[1])*sun+warm[1]*sunrise*.12,
    night[2]+(day[2]-night[2])*sun+warm[2]*sunrise*.05,
    1,
  ];
}
