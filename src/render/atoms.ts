import {compileRenderPipeline,type RenderPipelinePlan} from './pipeline-plan.js';
export interface ShaderOperationAtoms {
  arithmetic:number;
  transcendental:number;
  textureSamples:number;
  textureCompareSamples:number;
  textureLoads:number;
  textureStores:number;
  storageAccesses:number;
  derivatives:number;
  branches:number;
  selects:number;
  loops:number;
  atomics:number;
  discards:number;
}
export interface ShaderEntryAtoms extends ShaderOperationAtoms {
  entry:string;
  reachableFunctions:readonly string[];
}
export interface ShaderProgramAtoms {
  readonly name:string;
  readonly entries:Readonly<Record<string,ShaderEntryAtoms>>;
}
export interface RenderCommandAtoms {
  drawIndexedIndirect?:number;
  renderPasses:number;
  drawIndexed:number;
  draw:number;
  pipelineBinds:number;
  bindGroupBinds:number;
  vertexBufferBinds:number;
  indexBufferBinds:number;
  submittedIndices:number;
  submittedTriangles:number;
  submittedVerticesNonIndexed:number;
  instances:number;
  shadowBatchedInstances:number;
  shadowBatchedDraws:number;
  byPass:Readonly<Record<string,{drawIndexed:number;drawIndexedIndirect?:number;draw:number;triangles:number}>>;
}
export interface RenderGeometryAtoms {
  materialDraws:Readonly<Record<string,number>>;
  materialTriangles:Readonly<Record<string,number>>;
  shadowTriangles:number;
  reflectionTriangles:number;
  mainOpaqueTriangles:number;
  mainTransparentTriangles:number;
  snowTriangles:number;
}
export interface AttachmentAtom {
  width:number;height:number;samples:number;bytesPerSample:number;
  logicalWriteBytes:number;
  logicalResolveBytes:number;
}
export interface RenderMemoryAtoms {
  uploads:Readonly<{total:number;uniform:number;surface:number;light:number;frame:number;snow:number;environment:number;instance:number;visibility?:number}>;
  attachments:Readonly<Record<string,AttachmentAtom>>;
  logicalAttachmentWriteBytes:number;
  logicalResolveBytes:number;
  /** API-level texture-read model. Cache hits/compression can make physical DRAM traffic much smaller. */
  fullscreenTextureReadBytes:Readonly<{
    bloomDownsample:number;
    bloomHorizontal:number;
    bloomVertical:number;
    effectsMinimum:number;
    effectsOpaqueAoExtra:number;
    effectsDofExtra:number;
    effectsSsrWorstExtra:number;
    taa:number;
    motionBlur?:number;
    present:number;
  }>;
}
export interface RenderAtomReport {
  readonly geometryCountBasis?:'exact'|'candidate-upper-bound';
  readonly commands:RenderCommandAtoms;
  readonly geometry:RenderGeometryAtoms;
  readonly memory:RenderMemoryAtoms;
  readonly shaders:Readonly<Record<string,ShaderProgramAtoms>>;
}

const ZERO:ShaderOperationAtoms={arithmetic:0,transcendental:0,textureSamples:0,textureCompareSamples:0,textureLoads:0,textureStores:0,storageAccesses:0,derivatives:0,branches:0,selects:0,loops:0,atomics:0,discards:0};
const add=(a:ShaderOperationAtoms,b:ShaderOperationAtoms,n=1):ShaderOperationAtoms=>({
  arithmetic:a.arithmetic+b.arithmetic*n,
  transcendental:a.transcendental+b.transcendental*n,
  textureSamples:a.textureSamples+b.textureSamples*n,
  textureCompareSamples:a.textureCompareSamples+b.textureCompareSamples*n,
  textureLoads:a.textureLoads+b.textureLoads*n,
  textureStores:a.textureStores+b.textureStores*n,
  storageAccesses:a.storageAccesses+b.storageAccesses*n,
  derivatives:a.derivatives+b.derivatives*n,
  branches:a.branches+b.branches*n,
  selects:a.selects+b.selects*n,
  loops:a.loops+b.loops*n,
  atomics:a.atomics+b.atomics*n,
  discards:a.discards+b.discards*n,
});
const count=(text:string,re:RegExp)=>[...text.matchAll(re)].length;
const escapeRegExp=(value:string)=>[...value].map(ch=>'\\^$.*+?()[]{}|/-'.includes(ch)?String.fromCharCode(92)+ch:ch).join('');
function cleanWGSL(source:string):string{return source.replace(/\/\*[\s\S]*?\*\//g,'').replace(/\/\/[^\n]*/g,'');}
function functions(source:string):Map<string,string>{
  const result=new Map<string,string>(),text=cleanWGSL(source),re=/\bfn\s+([A-Za-z_]\w*)\s*\(/g;let match:RegExpExecArray|null;
  while((match=re.exec(text))){
    const name=match[1]!,open=text.indexOf('{',re.lastIndex);if(open<0)continue;
    let depth=1,i=open+1;for(;i<text.length&&depth;i++){if(text[i]==='{')depth++;else if(text[i]==='}')depth--;}
    if(depth===0){result.set(name,text.slice(open+1,i-1));re.lastIndex=i;}
  }
  return result;
}
function directCost(body:string,storageNames:readonly string[]):ShaderOperationAtoms{
  const noArrows=body.replace(/->/g,' ');
  let storageAccesses=0;
  for(const name of storageNames)storageAccesses+=count(body,new RegExp('\\b'+escapeRegExp(name)+'\\b','g'));
  return{
    arithmetic:count(noArrows,/[+\-*\/%]/g),
    transcendental:count(body,/\b(?:sin|cos|tan|atan2|asin|acos|exp|log|pow|sqrt|inverseSqrt|length|distance|normalize)\s*\(/g),
    textureSamples:count(body,/\btextureSample(?:Level|Bias|Grad)?\s*\(/g),
    textureCompareSamples:count(body,/\btextureSampleCompare(?:Level)?\s*\(/g),
    textureLoads:count(body,/\btextureLoad\s*\(/g),
    textureStores:count(body,/\btextureStore\s*\(/g),
    storageAccesses,
    derivatives:count(body,/\b(?:dpdx|dpdy|fwidth)\s*\(/g),
    branches:count(body,/\bif\s*\(/g),
    selects:count(body,/\bselect\s*\(/g),
    loops:count(body,/\b(?:for|while)\s*\(/g),
    atomics:count(body,/\batomic\w*\s*\(/g),
    discards:count(body,/\bdiscard\s*;/g),
  };
}
/** Static WGSL source census.
 * Counts source-level operations reachable from an entry point. Function calls
 * are expanded, but dynamic branch probabilities and loop iteration counts are
 * deliberately not guessed. This is a structural cost model, not GPU ISA.
 */
export function analyzeWGSL(name:string,source:string,entries:readonly string[]):ShaderProgramAtoms{
  const text=cleanWGSL(source),map=functions(text),storageNames=[...text.matchAll(/var<storage[^>]*>\s+([A-Za-z_]\w*)/g)].map(m=>m[1]!);
  const direct=new Map([...map].map(([fn,body])=>[fn,directCost(body,storageNames)]));
  const expand=(entry:string)=>{
    const reachable=new Set<string>();
    const walk=(fn:string,stack:Set<string>):ShaderOperationAtoms=>{
      const body=map.get(fn);if(!body||stack.has(fn))return ZERO;reachable.add(fn);
      let total=direct.get(fn)??ZERO;const next=new Set(stack);next.add(fn);
      for(const child of map.keys()){
        if(child===fn)continue;const calls=count(body,new RegExp('\\b'+escapeRegExp(child)+'\\s*\\(','g'));
        if(calls)total=add(total,walk(child,next),calls);
      }
      return total;
    };
    const total=walk(entry,new Set());
    return Object.freeze({entry,...total,reachableFunctions:Object.freeze([...reachable])});
  };
  return Object.freeze({name,entries:Object.freeze(Object.fromEntries(entries.map(entry=>[entry,expand(entry)])))});
}
const attachment=(width:number,height:number,samples:number,bytesPerSample:number,resolveBytesPerPixel=0):AttachmentAtom=>Object.freeze({
  width,height,samples,bytesPerSample,
  logicalWriteBytes:width*height*samples*bytesPerSample,
  logicalResolveBytes:width*height*resolveBytesPerPixel,
});
export interface BuildRenderAtomsInput {
  pipeline?:RenderPipelinePlan;
  postProcessing?:Readonly<import('./camera-post.js').PostProcessingSettings>;
  geometryCountBasis?:'exact'|'candidate-upper-bound';mainIndirectDraws?:number;
  width:number;height:number;shadowMapSize:number;swapchainBytesPerPixel?:number;
  spotShadowSize?:number;spotShadowLayers?:number;spotShadowPasses?:number;
  shadowDraws:number;reflectionDraws:number;mainOpaqueDraws:number;mainTransparentDraws:number;snowInstances:number;
  shadowTriangles:number;reflectionTriangles:number;mainOpaqueTriangles:number;mainTransparentTriangles:number;
  materialDraws:Readonly<Record<string,number>>;materialTriangles:Readonly<Record<string,number>>;
  shadowBatchedInstances:number;shadowBatchedDraws:number;
  uploads:{total:number;uniform:number;surface:number;light:number;frame:number;snow:number;environment:number;instance:number;visibility?:number};
  shaders:Readonly<Record<string,ShaderProgramAtoms>>;
}
export function buildRenderAtomReport(input:BuildRenderAtomsInput):RenderAtomReport{
  const plan=input.pipeline??compileRenderPipeline();
  const bloom=plan.features.bloom&&(input.postProcessing?.bloom??true),taa=plan.features.temporalAA&&(input.postProcessing?.temporalAA??true),motionBlur=plan.features.motionBlur&&(input.postProcessing?.motionBlur??1)>0;
  const full=input.width*input.height,halfW=Math.max(1,Math.floor(input.width/2)),halfH=Math.max(1,Math.floor(input.height/2));
  const snowTriangles=input.snowInstances*2;
  const indexedTriangles=input.shadowTriangles+input.reflectionTriangles+input.mainOpaqueTriangles+input.mainTransparentTriangles;
  const byPass={
    shadow:{drawIndexed:input.shadowDraws,draw:0,triangles:input.shadowTriangles},
    reflection:{drawIndexed:input.reflectionDraws,draw:0,triangles:input.reflectionTriangles},
    main:{drawIndexed:input.mainOpaqueDraws+input.mainTransparentDraws-(input.mainIndirectDraws??0),drawIndexedIndirect:input.mainIndirectDraws??0,draw:1+(input.snowInstances?1:0),triangles:input.mainOpaqueTriangles+input.mainTransparentTriangles+1+snowTriangles},
    ...(bloom?{'bloom.downsample':{drawIndexed:0,draw:1,triangles:1},'bloom.horizontal':{drawIndexed:0,draw:1,triangles:1},'bloom.vertical':{drawIndexed:0,draw:1,triangles:1}}:{}),
    ...(plan.effects?{effects:{drawIndexed:0,draw:1,triangles:1}}:{}),
    ...(taa?{taa:{drawIndexed:0,draw:1,triangles:1}}:{}),
    ...(motionBlur?{motionBlur:{drawIndexed:0,draw:1,triangles:1}}:{}),
    present:{drawIndexed:0,draw:1,triangles:1},
  };
  if(!plan.features.planarReflections)delete (byPass as Partial<typeof byPass>).reflection;
  const fullscreenDraws=2+(motionBlur?1:0)+(bloom?3:0)+(plan.effects?1:0)+(taa?1:0);
  const indexedDraws=input.shadowDraws+input.reflectionDraws+input.mainOpaqueDraws+input.mainTransparentDraws,nonIndexedDraws=fullscreenDraws+(input.snowInstances?1:0);
  const commands:RenderCommandAtoms=Object.freeze({
    renderPasses:9+(motionBlur?1:0)-(plan.features.planarReflections?0:1)-(bloom?0:3)-(plan.effects?0:1)-(taa?0:1)+(input.spotShadowPasses??0),drawIndexed:indexedDraws-(input.mainIndirectDraws??0),drawIndexedIndirect:input.mainIndirectDraws??0,draw:nonIndexedDraws,
    pipelineBinds:9+(input.snowInstances?1:0),
    bindGroupBinds:input.shadowDraws+1+input.reflectionDraws+1+(input.mainOpaqueDraws+input.mainTransparentDraws)+2+(input.snowInstances?2:0)+3+1,
    vertexBufferBinds:indexedDraws+input.shadowBatchedDraws,indexBufferBinds:indexedDraws,
    submittedIndices:indexedTriangles*3,
    submittedTriangles:indexedTriangles+snowTriangles+fullscreenDraws,
    submittedVerticesNonIndexed:fullscreenDraws*3+input.snowInstances*6,
    instances:input.snowInstances+input.shadowBatchedInstances,
    shadowBatchedInstances:input.shadowBatchedInstances,
    shadowBatchedDraws:input.shadowBatchedDraws,
    byPass:Object.freeze(byPass),
  });
  const attachments={
    shadow:attachment(input.shadowMapSize,input.shadowMapSize,1,4),
    ...Object.fromEntries(Array.from({length:input.spotShadowLayers??0},(_,i)=>['spotShadow'+i,attachment(input.spotShadowSize??512,input.spotShadowSize??512,1,4)])),
    ...(plan.features.planarReflections?{reflectionColor:attachment(halfW,halfH,1,8),reflectionDepth:attachment(halfW,halfH,1,4)}:{}),
    mainHdr:attachment(input.width,input.height,1,8),
    ...(plan.features.screenSpace?{mainNormal:attachment(input.width,input.height,1,8),mainSpecular:attachment(input.width,input.height,1,4)}:{}),
    ...(plan.motionVectors?{mainVelocity:attachment(input.width,input.height,1,4)}:{}),
    mainDepth:attachment(input.width,input.height,1,4),
    ...(plan.effects?{effectsHdr:attachment(input.width,input.height,1,8)}:{}),
    ...(taa?{taaHistory:attachment(input.width,input.height,1,8)}:{}),
    ...(motionBlur?{motionBlur:attachment(input.width,input.height,1,8)}:{}),
    ...(bloom?{bloomDownsample:attachment(halfW,halfH,1,8),bloomHorizontal:attachment(halfW,halfH,1,8),bloomVertical:attachment(halfW,halfH,1,8)}:{}),
    present:attachment(input.width,input.height,1,input.swapchainBytesPerPixel??4),
  };
  const all=Object.values(attachments),logicalAttachmentWriteBytes=all.reduce((sum,a)=>sum+a.logicalWriteBytes,0),logicalResolveBytes=all.reduce((sum,a)=>sum+a.logicalResolveBytes,0);
  const bloomPixels=halfW*halfH;
  const memory:RenderMemoryAtoms=Object.freeze({
    uploads:Object.freeze({...input.uploads}),
    attachments:Object.freeze(attachments),
    logicalAttachmentWriteBytes,logicalResolveBytes,
    fullscreenTextureReadBytes:Object.freeze({
      bloomDownsample:bloom?bloomPixels*16*8:0,
      bloomHorizontal:bloom?bloomPixels*17*8:0,
      bloomVertical:bloom?bloomPixels*17*8:0,
      effectsMinimum:plan.effects?full*(plan.features.screenSpace?8+8+4+4+8:16):0,
      effectsOpaqueAoExtra:plan.features.screenSpace?full*(4*4+24*4):0,
      effectsDofExtra:plan.features.screenSpace?full*12*8:0,
      effectsSsrWorstExtra:plan.features.screenSpace?full*(28*4+5*4+4+16+8+13*8):0,
      taa:taa?full*(10*8+8+4+4):0,
      ...(motionBlur?{motionBlur:full*(5*8+5*4+4)}:{}),present:full*8,
    }),
  });
  return Object.freeze({
    geometryCountBasis:input.geometryCountBasis??'exact',
    commands,
    geometry:Object.freeze({
      materialDraws:Object.freeze({...input.materialDraws}),materialTriangles:Object.freeze({...input.materialTriangles}),
      shadowTriangles:input.shadowTriangles,reflectionTriangles:input.reflectionTriangles,
      mainOpaqueTriangles:input.mainOpaqueTriangles,mainTransparentTriangles:input.mainTransparentTriangles,snowTriangles,
    }),
    memory,
    shaders:input.shaders,
  });
}
