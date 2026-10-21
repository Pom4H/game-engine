/** Reuse the production material shader and its material uniforms. Only the two
 * transforms, color and object seed vary within a 40-float instance stream. */
export function instancedMaterialShader(source:string,temporal=true):string{
 const vertex='@vertex fn vs(@location(0) position: vec3<f32>, @location(1) normal: vec3<f32>, @location(6) vertexColor:vec4<f32>, @location(13) authoredUV:vec2<f32>, @location(14) authoredSeed:f32) -> VOut {';
 const fragment='@fragment fn fs(input: VOut) -> GOut {';
 if(!source.includes(vertex)||!source.includes(fragment))throw new Error('Material instance entry points changed');
 return source.replace(/u\.model\b/g,'instance.model').replace(/u\.prevModel\b/g,temporal?'instance.previous':'instance.model').replace(/u\.color\b/g,'instance.color').replace(/u\.weather\.z\b/g,'instance.weather.z')
  .replace('struct VOut {','struct VOut {\n @location(9) @interpolate(flat) sourceIndex:u32,')
  .replace(vertex,vertex.replace(') -> VOut {',', @builtin(instance_index) instanceIndex:u32) -> VOut {')+'\n instance=instanceSource[instanceVisible[instanceIndex]];')
  .replace('var out: VOut;out.reflected=0u;','var out: VOut;out.sourceIndex=instanceVisible[instanceIndex];out.reflected=0u;')
  .replace(fragment,fragment+'\n instance=instanceSource[input.sourceIndex];')+`
struct PackedInstance {model:mat4x4<f32>,${temporal?'previous:mat4x4<f32>,':''}color:vec4<f32>,weather:vec4<f32>}
@group(2) @binding(0) var<storage,read> instanceSource:array<PackedInstance>;
@group(2) @binding(1) var<storage,read> instanceVisible:array<u32>;
var<private> instance:PackedInstance;
`;
}

/** The planar LOD shader keeps exactly its existing lighting and plane clip.
 * Its reflected camera owns a separate visible list; source records are shared
 * with the main pass, including per-instance albedo and authored vertex color. */
export function instancedReflectionShader(source:string,temporal=true):string{
 const plain='@vertex fn reflectionVS(@location(0) position:vec3<f32>,@location(1) normal:vec3<f32>,@location(6) vertexColor:vec4<f32>,@location(13) authoredUV:vec2f)->O{',seeded=plain.replace(')->O{',',@location(14) authoredSeed:f32)->O{');const vertex=source.includes(seeded)?seeded:plain;
 const fragment=source.includes('@fragment fn fs(in:O)->ReflectionOutput{')?'@fragment fn fs(in:O)->ReflectionOutput{':'@fragment fn fs(in:O)->@location(0) vec4<f32>{';
 if(!source.includes(vertex)||!source.includes(fragment)||!source.includes('struct O {')||!source.includes('var out:O;'))throw new Error('Reflection instance entry points changed');
 return source.replace(/u\.model\b/g,'instance.model').replace(/u\.color\b/g,'instance.color').replace(/u\.weather\.z\b/g,'instance.weather.z')
  .replace('struct O {','struct O {@location(3) @interpolate(flat) sourceIndex:u32,')
  .replace(vertex,vertex.replace(')->O{',',@builtin(instance_index) instanceIndex:u32)->O{')+'\n let sourceIndex=instanceVisible[instanceIndex];instance=instanceSource[sourceIndex];')
  .replace('var out:O;','var out:O;out.sourceIndex=sourceIndex;')
  .replace(fragment,fragment+'\n instance=instanceSource[in.sourceIndex];')+`
struct PackedInstance {model:mat4x4<f32>,${temporal?'previous:mat4x4<f32>,':''}color:vec4<f32>,weather:vec4<f32>}
@group(2) @binding(0) var<storage,read> instanceSource:array<PackedInstance>;
@group(2) @binding(1) var<storage,read> instanceVisible:array<u32>;
var<private> instance:PackedInstance;
`;
}

/** Depth-only shadows read the same source records, with a light-owned index list.
 * Keep the original displacement and light projection expression unchanged. */
export function instancedShadowShader(source:string,temporal=true):string{
 const entry='@vertex fn shadowVS(@location(0) position:vec3<f32>)->@builtin(position) vec4<f32>{return f.lightVP*displaceWorld(u.model*vec4<f32>(position,1));}';
 if(!source.includes(entry))throw new Error('Shadow instance entry point changed');
 return source.replace(entry,'@vertex fn shadowVSShared(@location(0) position:vec3<f32>,@builtin(instance_index) index:u32)->@builtin(position) vec4<f32>{let model=shadowSource[shadowVisible[index]].model;return f.lightVP*displaceWorld(model*vec4<f32>(position,1));}')+`
struct ShadowInstance {model:mat4x4<f32>,${temporal?'previous:mat4x4<f32>,':''}color:vec4<f32>,weather:vec4<f32>}
@group(2) @binding(0) var<storage,read> shadowSource:array<ShadowInstance>;
@group(2) @binding(1) var<storage,read> shadowVisible:array<u32>;
`;
}

/** Persistent per-light/pass indices; transforms remain in the shared source. */
export class ShadowInstanceIndices {
 readonly buffer:any;readonly bind:any;readonly indices:Uint32Array;
 count=0;private destroyed=false;
 constructor(device:any,layout:any,source:any,capacity:number){
  if(!Number.isSafeInteger(capacity)||capacity<1)throw new RangeError('Invalid shadow instance capacity');
  this.indices=new Uint32Array(capacity);
  this.buffer=device.createBuffer({label:'shadow instance indices',size:capacity*4,usage:0x80|0x08});
  this.bind=device.createBindGroup({layout,entries:[{binding:0,resource:{buffer:source}},{binding:1,resource:{buffer:this.buffer}}]});
 }
 update(queue:any,indices:readonly number[]):number{
  if(this.destroyed)throw new Error('Shadow instance indices destroyed');
  if(indices.length>this.indices.length)throw new RangeError('Shadow instance capacity exceeded');
  if(indices.some(index=>!Number.isSafeInteger(index)||index<0||index>=this.indices.length))throw new RangeError('Invalid shadow instance index');
  let changed=this.count!==indices.length;
  for(let i=0;i<indices.length;i++){if(this.indices[i]!==indices[i])changed=true;this.indices[i]=indices[i]!;}
  this.count=indices.length;
  if(!changed||!this.count)return 0;
  queue.writeBuffer(this.buffer,0,this.indices,0,this.count);return this.count*4;
 }
 destroy():void{if(this.destroyed)return;this.destroyed=true;this.buffer.destroy();}
}
