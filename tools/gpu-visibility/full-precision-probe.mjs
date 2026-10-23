export const PROBE_COLOR_ATTACHMENT_BYTES=36;

/** Promote only the diagnostic normal slot. WebGPU charges rgba8unorm eight
 * render-target bytes, so these four formats need 36 bytes, not their 32-byte
 * texel payload sum. No filter/blend feature or fifth target is requested. */
export function promoteProbeTarget(descriptor){
 const targets=descriptor.fragment?.targets;if(targets?.length!==4)return descriptor;
 if(targets.map(target=>target?.format).join(',')!=='rgba16float,rgba16float,rgba8unorm,rg16float'||targets[1].blend)throw new Error('Unexpected full-precision probe MRT contract');
 return{...descriptor,fragment:{...descriptor.fragment,targets:targets.map((target,index)=>index===1?{...target,format:'rgba32float'}:target)}};
}
export function installProbePipelines(devicePrototype){
 const original=devicePrototype.createRenderPipeline,state={promoted:0};
 devicePrototype.createRenderPipeline=function(descriptor){const next=promoteProbeTarget(descriptor);if(next!==descriptor)state.promoted++;return original.call(this,next);};
 return{state,restore(){devicePrototype.createRenderPipeline=original;}};
}
export function installProbeDeviceLimit(adapterPrototype){
 const original=adapterPrototype.requestDevice,state={adapterLimit:null,requestedLimit:null};
 adapterPrototype.requestDevice=function(descriptor={}){
  const requested=Math.max(PROBE_COLOR_ATTACHMENT_BYTES,descriptor.requiredLimits?.maxColorAttachmentBytesPerSample??0);
  if(this.limits.maxColorAttachmentBytesPerSample<requested)throw new Error('Adapter cannot support full-precision MRT budget');
  state.adapterLimit=this.limits.maxColorAttachmentBytesPerSample;state.requestedLimit=requested;
  return original.call(this,{...descriptor,requiredLimits:{...descriptor.requiredLimits,maxColorAttachmentBytesPerSample:requested}});
 };
 return{state,restore(){adapterPrototype.requestDevice=original;}};
}

/** Replace the actual normal attachment only in the two main MRT passes. The
 * original normal texture remains bound to postprocessing and is untouched.
 * These output changes are diagnostic; downstream images/timings are not QA. */
export class FullPrecisionProbe {
 constructor(renderer,width,height){
  this.device=renderer.device;this.width=width;this.height=height;this.armed=false;
  if(this.device.limits.maxColorAttachmentBytesPerSample<PROBE_COLOR_ATTACHMENT_BYTES)throw new Error('Full-precision probe requires 36-byte MRT budget');
  this.texture=this.device.createTexture({label:'full precision fragment probe',size:[width,height],format:'rgba32float',usage:0x10|0x04|0x01});
  this.originalCreate=this.device.createCommandEncoder;const probe=this;
  this.device.createCommandEncoder=function(descriptor){
   const encoder=probe.originalCreate.call(this,descriptor),begin=encoder.beginRenderPass;
   encoder.beginRenderPass=function(descriptor){
    if(['render.main.opaque','render.main.transparent'].includes(descriptor.label)){
     if(descriptor.colorAttachments?.length!==4||!descriptor.colorAttachments[1])throw new Error('Missing full-precision normal attachment');
     if(probe.armed&&descriptor.label==='render.main.opaque')probe.opaquePasses++;
     descriptor={...descriptor,colorAttachments:descriptor.colorAttachments.map((attachment,index)=>index===1?{...attachment,view:probe.texture.createView()}:attachment)};
    }else if(descriptor.colorAttachments?.length===4)throw new Error('Unknown full-precision MRT pass');
    return begin.call(this,descriptor);
   };return encoder;
  };
 }
 beginFrame(){if(this.armed)throw new Error('Full-precision probe already armed');this.armed=true;this.opaquePasses=0;}
 finishFrame(){if(!this.armed||this.opaquePasses!==1)throw new Error('Incomplete full-precision opaque probe');this.armed=false;return{opaquePasses:this.opaquePasses,format:this.texture.format,colorAttachmentBytesPerSample:PROBE_COLOR_ATTACHMENT_BYTES,originalNormalWritten:false};}
 destroy(){this.device.createCommandEncoder=this.originalCreate;this.texture.destroy();}
}
