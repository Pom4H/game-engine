import {WebGPURenderer} from '../../src/render/webgpu.ts';
import {WebGPURenderer as FrozenRenderer} from './fixtures/webgpu-before-zero-work.ts';
import {WebGPURenderer as FrozenPlanarRenderer} from './fixtures/webgpu-before-planar-weight.ts';
import {Scene} from '../../src/scene/scene.ts';
import {gameLighting} from '../../../thegame/src/game/render/game-lighting.ts';
import {resolveVisualState} from '../../../thegame/src/game/render/visual-state.ts';

const width=1280,height=720,canvas=document.querySelector('canvas') as HTMLCanvasElement;
const baselines=new Map<string,Record<string,Float32Array>>();let renderer:any;
const heightUrl='/height.png'; // Owned four-column 0/80/160/255 RGBA relief image.

async function readTexture(engine:any,stage:string){
 const texture=stage==='depth'?engine.depth:stage==='taa'?(engine.taaHistoryIndex===0?engine.taaA:engine.taaB):stage==='effects'?engine.effectsHdr:engine.hdr;
 const device=engine.device,depth=stage==='depth',components=depth?1:4,bytes=width*height*components*4;
 const code=`@group(0) @binding(0) var image:${depth?'texture_depth_2d':'texture_2d<f32>'};@group(0) @binding(1) var<storage,read_write> out:array<${depth?'f32':'vec4f'}>;@compute @workgroup_size(8,8) fn main(@builtin(global_invocation_id)i:vec3u){if(i.x>=1280u||i.y>=720u){return;}out[i.y*1280u+i.x]=textureLoad(image,vec2i(i.xy),0);}`;
 const pipeline=await device.createComputePipelineAsync({layout:'auto',compute:{module:device.createShaderModule({code}),entryPoint:'main'}}),output=device.createBuffer({size:bytes,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_SRC}),read=device.createBuffer({size:bytes,usage:GPUBufferUsage.MAP_READ|GPUBufferUsage.COPY_DST}),encoder=device.createCommandEncoder(),pass=encoder.beginComputePass();
 pass.setPipeline(pipeline);pass.setBindGroup(0,device.createBindGroup({layout:pipeline.getBindGroupLayout(0),entries:[{binding:0,resource:texture.createView()},{binding:1,resource:{buffer:output}}]}));pass.dispatchWorkgroups(width/8,height/8);pass.end();encoder.copyBufferToBuffer(output,0,read,0,bytes);device.queue.submit([encoder.finish()]);await read.mapAsync(GPUMapMode.READ);const result=new Float32Array(read.getMappedRange()).slice();read.unmap();read.destroy();output.destroy();return result;
}
function comparison(before:Float32Array,after:Float32Array){let changed=0,maxAbs=0,maxUlps=0;const a=new Uint32Array(before.buffer,before.byteOffset,before.length),b=new Uint32Array(after.buffer,after.byteOffset,after.length);for(let i=0;i<after.length;i++){if(!Object.is(before[i],after[i]))changed++;maxAbs=Math.max(maxAbs,Math.abs(before[i]!-after[i]!));maxUlps=Math.max(maxUlps,Math.abs(a[i]!-b[i]!));}return{components:after.length,changed,maxAbs,maxUlps};}
function require(value:unknown,message:string):asserts value{if(!value)throw Error(message);}

(window as any).renderVisual=async({name,baseline}:{name:string;baseline:boolean})=>{
 renderer?.dispose();const roadCase=name.startsWith('road-'),spotCase=name.startsWith('spot-'),Type:any=baseline?(roadCase||spotCase?FrozenPlanarRenderer:FrozenRenderer):WebGPURenderer;
 renderer=await Type.create(canvas,{profiling:roadCase,visibility:name==='cpu-instances'?'cpu':'gpu',opaqueDepthPrepass:true,logarithmicDepthFar:2000,features:{screenSpace:true,bloom:true,temporalAA:true,planarReflections:true,motionBlur:true}});
 renderer.setResolution(width,height);renderer.setBackgroundEnvironmentMaps(true);renderer.configurePostProcessing({temporalAA:true,bloom:true,motionBlur:0});
 const zero=name.startsWith('zero-'),humidity=name==='zero-cloud'?.84:name==='cloud-threshold'?.48:name==='cloud-above'?.48001:.42;
 const scene=new Scene({version:1,seed:29,gravity:[0,0,0],camera:{position:[7,4,-8],target:[0,1,6],fov:60},environment:{sunlight:zero?0:.7,humidity,temperatureC:15,groundMoisture:.5,snowfall:'none'},rendering:{sunIntensity:zero?0:1.5,sunDirection:[-.5,.6,-.3],skyColor:[.18,.23,.32],fogDensity:.004,shadowExtent:65},entities:name==='sun-transition'?[{id:'physical-surface',mesh:{kind:'box',size:[4,.1,4]},position:[0,.03,.5],material:{kind:'snow'},environmental:{surfaceUse:'generic',fieldCellSizeM:.1}}]:[]});
 const grass=()=>{scene.add({id:'grass',renderOnly:true,mesh:{kind:'box',size:[.1,.2,.1]},position:[0,.1,1],material:{groundCover:'grass-blade',color:[.2,.5,.1,1]}});scene.setVisualTransform('grass',[0,.1,1]);};grass();
 scene.add({id:'ground',mesh:{kind:'plane',size:[35,35]},material:{kind:'concrete',color:[.25,.28,.26,1],roughness:.75},environmental:{surfaceUse:'generic',fieldCellSizeM:1}});
 for(let n=0;n<32;n++)scene.add({id:'wall-'+n,renderOnly:true,mesh:{kind:'box',size:[.8,1+(n%4)*.3,.8]},position:[(n%8-4)*1.5,.8,Math.floor(n/8)*2+3],material:{kind:'steel',color:[.2+(n%3)*.1,.25,.35,1],roughness:.4,clearcoat:.4,clearcoatRoughness:.12}});
 scene.add({id:'glass',mesh:{kind:'box',size:[2,2,.08]},position:[-2,1.5,1],material:{kind:'glass',color:[.5,.7,.9,.4],roughness:.08}});
 scene.add({id:'moving',mesh:{kind:'sphere',radius:.6},position:[2,.7,1],body:{mass:1},material:{kind:'steel',color:[.7,.2,.08,1],roughness:.2,clearcoat:1}});
 scene.add({id:'relief',mesh:{kind:'box',size:[2,2,.2]},position:[0,1,7],material:{kind:'concrete',texture:{url:heightUrl,heightUrl,heightScaleM:.04,sizeM:1},roughness:.6}});
 scene.add({id:'spot',position:[0,3,-2],light:{kind:'point',intensity:200,color:[1,.8,.6],range:22,castShadow:true,emission:{axis:[0,-.1,1],innerAngle:.1,outerAngle:.7}}});
 if(spotCase)scene.add({id:'spot-right',position:[.7,3,-2],light:{kind:'point',intensity:180,color:[.8,.9,1],range:28,castShadow:true,emission:{axis:[0,-.1,1],innerAngle:.1,outerAngle:.7}}});
 const snow={snowDepthM:0,waterDepthM:0,iceDepthM:0,slush:0,freshness:0,liquidFraction:0,crust:0,grainSizeMm:.5};
 const wetness=name==='road-dry'||name==='road-ice'||name==='road-rain'?0:1,roughness=name==='road-dry'?.9:name==='road-threshold-below'?.5499:name==='road-threshold-exact'?.55:name==='road-threshold-above'?.5501:.18;
 if(name==='road-ice')Object.assign(snow,{iceDepthM:.003,crust:1});
 if(name==='road-slurry')Object.assign(snow,{snowDepthM:.004,waterDepthM:.001,slush:.8,freshness:.2,liquidFraction:.6,crust:.1});
 if(name==='road-rain')scene.patchAppearance({rendering:{surfaceWeather:{rain:1}}});
 if(name==='road-bounds')scene.setCamera({position:[0,.18,-1],target:[0,.18,9],fov:60});
 const road=()=>scene.add({id:'road',mesh:{kind:'plane',size:name==='road-bounds'?[400,400]:[7,24]},position:[0,name==='road-elevated'?.35:.015,3],rotation:name==='road-sloped'?[.15,0,0]:[0,0,0],material:{kind:'asphalt',color:[.1,.1,.1,1],roughness,...(name==='road-rain'?{rainResponse:{kind:'ground'}}:{}),surfaceAppearance:{wetness,darkening:.07,...(name==='road-ice'||name==='road-slurry'?{snow}:{})}}});
 if(name!=='no-receiver'&&name!=='receiver-transition')road();
 if(name==='moon-override'){
  const visual=resolveVisualState('night');require(visual.sunIntensity===0,'moon fixture must begin with visual sun intensity zero');
  scene.patchAppearance({rendering:gameLighting(visual,.4,{elevation:.4,azimuth:.4,color:[.5,.6,.9],intensity:.125})});
 }
 await renderer.prepareMaterials(scene);
 let frame=0;const frameUniforms:Float32Array[]=[],passLabels:string[]=[];
 const queue=renderer.device.queue,write=queue.writeBuffer.bind(queue);queue.writeBuffer=(buffer:any,offset:number,data:any,...rest:any[])=>{if(buffer===renderer.gpu.frame&&offset===0&&data instanceof Float32Array&&data.length===184)frameUniforms.push(data.slice());return write(buffer,offset,data,...rest);};
 const encode=renderer.device.createCommandEncoder.bind(renderer.device);renderer.device.createCommandEncoder=(descriptor:any)=>{const encoder=encode(descriptor),begin=encoder.beginRenderPass.bind(encoder);encoder.beginRenderPass=(d:any)=>{if(d.label)passLabels.push(d.label);return begin(d);};return encoder;};
 const draw=()=>{
  if(spotCase){
   const phase=frame*.045,axis=name==='spot-turns'?[Math.sin(phase)*.15,-1,Math.cos(phase)*.15]:[Math.sin(phase)*.55,-.1,Math.cos(phase)];
   for(const [id,offset]of [['spot',-.35],['spot-right',.35]] as const){const e=scene.entities.get(id)!;scene.setVisualTransform(id,[Math.sin(phase)*1.2+offset,3,-2+frame*.025]);e.light!.emission!.axis=axis as any;}
   if(name==='spot-slots')scene.entities.get('spot')!.light!.intensity=frame%12<6?200:0;
   scene.entities.get('moving')!.position[0]=Math.sin(phase)*1.2+2;
   scene.entities.get('wall-0')!.rotation[1]=phase*.2;
  }
  renderer.setTimelineFrame(frame++);scene.time=7;renderer.render(scene);
 };
 for(let n=0;n<16;n++){draw();await new Promise(requestAnimationFrame);}await renderer.settleEnvironmentMaps();renderer.resetTemporalHistory();
 for(let n=0;n<16;n++){draw();await new Promise(requestAnimationFrame);}await renderer.flush();
 const preparationBefore=renderer.inspect(false).preparation,checks:any[]=[];
 async function capture(phase:string){
  const oracle:any={};for(const stage of ['hdr','depth','effects','taa']){const data=await readTexture(renderer,stage),key=name+':'+phase;if(baseline){const values=baselines.get(key)??{};values[stage]=data;baselines.set(key,values);}else{oracle[stage]=comparison(baselines.get(key)![stage]!,data);}}
  if(!baseline)baselines.delete(name+':'+phase);
  const actualSun=frameUniforms.at(-1)![19],sunPasses=passLabels.filter(p=>/^render\.shadow\.(static|dynamic)$/.test(p)),spots=passLabels.filter(p=>p.startsWith('render.shadow.spot.'));
  if(!baseline){if(actualSun===0)require(!sunPasses.length,'zero actual uniform must omit only SUN maps');else require(sunPasses.includes('render.shadow.dynamic'),'nonzero actual uniform must retain SUN visibility');require(spots.length>0,'spot shadows must survive every sun state');if(!scene.entities.has('road'))require(!passLabels.includes('render.reflection'),'no receiver must omit planar pass');else require(passLabels.includes('render.reflection'),'receiver must render a fresh map in its frame');}
  checks.push({phase,actualSun,sunPasses,spots,reflection:passLabels.includes('render.reflection'),oracle});return oracle;
 }
 passLabels.length=0;draw();await capture('initial');
 if(name==='identity'||name==='cpu-instances'){
  scene.remove('grass');passLabels.length=0;draw();await capture('noncaster-retired');
  if(!baseline)require(renderer.inspect(false).preparation.visibilityPlan.passes.staticShadow.staticBuilds===preparationBefore.visibilityPlan.passes.staticShadow.staticBuilds,'unchanged static shadow must remain resident');
 }
 if(name==='sun-transition'){
  for(const sun of [0,.125,0,1.5]){scene.spec.rendering!.sunIntensity=sun;if(sun===0){scene.entities.get('wall-0')!.position[0]+=.125;scene.surfaces.field('physical-surface')!.deformation.stamp({x:0,z:.5,radiusM:.2,depthM:.06});}passLabels.length=0;draw();await capture('sun-'+sun+'-frame-'+frame);await renderer.settleEnvironmentMaps();}
 }
 if(name==='receiver-transition'){
  road();passLabels.length=0;draw();await capture('first-receiver');await renderer.settleEnvironmentMaps();
  scene.remove('road');passLabels.length=0;draw();await capture('receiver-retired');await renderer.settleEnvironmentMaps();
  road();passLabels.length=0;draw();await capture('receiver-returned');await renderer.settleEnvironmentMaps();
 }
 if(name==='moon-override')require(frameUniforms.at(-1)![19]===.125,'actual frame must contain the celestial moon override, not zero visual sunlight');
 // Final paired history begins only after all asynchronous exact environment
 // output is settled. First-transition snapshots above retain their own proof.
 await renderer.settleEnvironmentMaps();renderer.resetTemporalHistory();if(roadCase)renderer.resetProfile();for(let n=0;n<(roadCase?64:16);n++){draw();await new Promise(requestAnimationFrame);}await renderer.flush();
 passLabels.length=0;draw();const oracle=await capture('final'),report=renderer.inspect(false);
 require(!report.errors.length,JSON.stringify(report.errors));
 require(scene.tick===0,'visual equivalence must not step the fixture simulation');
 for(const check of checks)if(!baseline)for(const [stage,value]of Object.entries(check.oracle) as any)require(value.changed===0,`${name}/${check.phase}/${stage} differs: ${JSON.stringify(value)}`);
 const profile=renderer.profile();return{name,baseline,errors:report.errors,oracle:baseline?null:oracle,checks,physicsSteps:scene.tick,preparationBefore,preparationAfter:report.preparation,resolution:[width,height],profiled:profile.enabled,...(roadCase?{gpuDiagnostic:{frames:profile.gpuFrames,timestampQueries:profile.timestampQueries,gpu:profile.gpu,work:profile.latestCpu?.work}}:{})};
};
(window as any).ready=true;
