import type {CameraDepthConfiguration} from './camera-depth.js';

/** The predicate compares one depth texel with one sample. Perspective and
 * multisampled targets need their own proof before this opt-in can accept them. */
export function opaqueDepthPrepassEnabled(requested:unknown,depth:CameraDepthConfiguration,sampleCount=1):boolean{
 if(requested!==undefined&&typeof requested!=='boolean')throw new TypeError('opaqueDepthPrepass must be boolean');
 if(!requested)return false;
 if(depth.encoding!=='logarithmic')throw new RangeError('opaqueDepthPrepass requires logarithmic camera depth');
 if(sampleCount!==1)throw new RangeError('opaqueDepthPrepass requires a single-sample camera target');
 return true;
}

/** Keep the canonical default shader byte-for-byte intact. The opt-in shader
 * uses the same vertex entry points, clipping and fragment logarithmic depth.
 * Its discard follows every derivative: implicit texture LOD, normal AA and
 * receiver-plane filtering retain their original quad participation. */
export function opaqueDepthPrepassShader(source:string,enabled=false):string{
 if(!enabled)return source;
 if(!source.includes('@location(11) cameraDepth:f32'))throw new Error('Opaque depth prepass requires the logarithmic material varying');
 let result=source;
 const replace=(before:string,after:string)=>{
  if(result.indexOf(before)<0||result.indexOf(before)!==result.lastIndexOf(before))throw new Error('Opaque depth prepass shader contract changed: '+before.slice(0,90));
  result=result.replace(before,after);
 };
 replace('override MATERIAL_CLASS:i32=-1;','override MATERIAL_CLASS:i32=-1;\noverride OPAQUE_DEPTH_PREPASS:bool=false;\n@group(1) @binding(15) var opaqueDepth:texture_depth_2d;');
 replace('fn shadowAt(p:vec3<f32>,n:vec3<f32>)->f32{','fn shadowAt(p:vec3<f32>,n:vec3<f32>,gradient:vec2<f32>)->f32{');
 const before=' // Offset taps need the receiver depth',start=result.indexOf(before),end=result.indexOf(' if(any(uv<',start);
 if(start<0||end<start||!result.slice(start,end).includes('dpdx(plane),dpdy(plane)'))throw new Error('Opaque depth prepass shadow receiver derivative contract changed');
 result=result.slice(0,start)+result.slice(end);
 replace('@fragment fn fs(input: VOut) -> GOut {',`@fragment fn opaqueDepthFS(input:VOut)->@builtin(frag_depth)f32{
 return logarithmicCameraDepth(input.cameraDepth,f.cameraDepth.x);
}
@fragment fn fs(input: VOut) -> GOut {`);
 const footprint='  let litterFootprint=max(length(dpdx(litterUV)),length(dpdy(litterUV)));';
 replace(footprint,footprint+`
  let coatingFootprint=fwidth(in.uv);
  let receiver=f.lightVP*vec4<f32>(in.worldPos,1);
  let receiverPlane=vec3<f32>(receiver.xy*.5*vec2<f32>(1,-1)+.5,receiver.z);
  let receiverGradient=shadowReceiverGradient(dpdx(receiverPlane),dpdy(receiverPlane));
  if(OPAQUE_DEPTH_PREPASS&&u.relief.y<.5&&u.relief.z<0.0){
   let currentDepth=logarithmicCameraDepth(input.cameraDepth,f.cameraDepth.x);
   let nearestDepth=textureLoad(opaqueDepth,vec2<i32>(input.position.xy),0);
   // Strict comparison preserves coplanar ties and the original draw order.
   if(currentDepth>nearestDepth){discard;}
  }`);
 // The ordinary material has no coating kernel. Keep this substitution ready
 // for a source refactor while relief/coating pipelines remain excluded.
 result=result.replace('coatingLoss(in.uv,fwidth(in.uv),u.relief.w,u.relief.z)','coatingLoss(in.uv,coatingFootprint,u.relief.w,u.relief.z)');
 replace('let shadow=shadowAt(in.worldPos,geometricNormal)','let shadow=shadowAt(in.worldPos,geometricNormal,receiverGradient)');
 const tail=result.slice(result.indexOf('if(currentDepth>nearestDepth)'));
 if(/\b(?:dpdx|dpdy|fwidth|textureSample)\s*\(/.test(tail))throw new Error('Opaque depth prepass cannot precede a derivative or implicit texture sample');
 return result;
}
