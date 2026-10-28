import assert from 'node:assert/strict';

/** Minimal renderer initialization device shared by post-processing and readiness tests. */
export function initializationDevice(t,failLabel,options={}){
 const scopes=[],pipelines=[],textures=[],requests=[],layouts=[],actions=[];let destroyed=0,syncCalls=0,maxDepth=0,currentLabel='';
 const nativeError=Object.assign(new Error('Fragment library could not be created'),{name:'GPUPipelineError',reason:'validation'});
 const scopeError=new Error('Device disappeared during error collection');
 const handle=descriptor=>({getBindGroupLayout(index){layouts.push({label:descriptor.label,index});return{};}});
 const fails=label=>label===failLabel||options.failLabels?.includes(label);
 const device={
  queue:{writeTexture(){}},
  pushErrorScope(){scopes.push(null);maxDepth=Math.max(maxDepth,scopes.length);actions.push(['push',scopes.length]);},
  async popErrorScope(){assert.ok(scopes.length);const depth=scopes.length,label=currentLabel,error=scopes.pop();actions.push(['pop',depth,label]);if(options.rejectPop||(options.rejectPopLabel===label&&depth>1))throw scopeError;return error;},
  createShaderModule(descriptor){return{...descriptor,async getCompilationInfo(){await options.compilationReady?.();return{messages:[]};}};},
  createBuffer({size}){return{size,getMappedRange(){return new ArrayBuffer(size);},unmap(){},destroy(){}};},
  createTexture(descriptor){const texture={descriptor,width:descriptor.size[0],height:descriptor.size[1],format:descriptor.format,destroys:0,createView(){return{texture:this};},destroy(){this.destroys++;}};textures.push(texture);return texture;},
  createSampler(){return{};},createBindGroupLayout(descriptor){return{kind:'bind group layout',...descriptor};},createBindGroup(descriptor){return descriptor;},createPipelineLayout(descriptor){return{kind:'pipeline layout',...descriptor};},createComputePipeline(){return{};},
  createRenderPipeline(descriptor){
   syncCalls++;pipelines.push(descriptor);currentLabel=descriptor.label;
   // Reflection entry points must not receive unused specialization constants.
   if((descriptor.label.startsWith('reflection')&&descriptor.fragment.constants)||fails(descriptor.label))scopes[scopes.length-1]={message:nativeError.message};
   return handle(descriptor);
  },destroy(){destroyed++;},addEventListener(){},
 };
 if(options.async)device.createRenderPipelineAsync=descriptor=>{
  pipelines.push(descriptor);currentLabel=descriptor.label;if(options.throwAsync&&fails(descriptor.label))throw nativeError;
  return new Promise((resolve,reject)=>{const request={descriptor,settled:false,resolve(){if(this.settled)return;this.settled=true;if(fails(descriptor.label))reject(nativeError);else resolve(handle(descriptor));}};requests.push(request);if(!options.deferred)queueMicrotask(()=>request.resolve());});
 };
 const previous=Object.getOwnPropertyDescriptor(globalThis,'navigator');
 Object.defineProperty(globalThis,'navigator',{configurable:true,value:{gpu:{async requestAdapter(){return{features:new Set(),async requestDevice(){return device;}};},getPreferredCanvasFormat(){return'bgra8unorm';}}}});
 let restored=false;const restore=()=>{if(restored)return;restored=true;if(previous)Object.defineProperty(globalThis,'navigator',previous);else delete globalThis.navigator;};t.after(restore);
 return{device,canvas:{getContext(){return{configure(){},getCurrentTexture(){return{createView(){return{};}};}};}},pipelines,scopes,textures,requests,layouts,actions,nativeError,scopeError,restore,get destroyed(){return destroyed;},get syncCalls(){return syncCalls;},get maxDepth(){return maxDepth;},resolveExcept(label=''){for(const request of requests)if(request.descriptor.label!==label)request.resolve();},resolve(label){for(const request of requests)if(request.descriptor.label===label)request.resolve();}};
}
