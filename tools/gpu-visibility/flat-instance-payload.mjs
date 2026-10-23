/** Diagnostic candidate only. Matrices and material arithmetic stay in place;
 * color/seed are carried by flat vertex outputs instead of fragment storage. */
export function flatInstancePayload(code){
 if(code.includes('@location(7) @interpolate(flat) sourceIndex:u32,'))return code
  .replace('@location(7) @interpolate(flat) sourceIndex:u32,','@location(7) @interpolate(flat) instanceColor:vec4<f32>,\n @location(8) @interpolate(flat) instanceSeed:f32,')
  .replace('out.sourceIndex=instanceVisible[instanceIndex];','out.instanceColor=instance.color;out.instanceSeed=instance.weather.z;')
  .replace('instance=instanceSource[input.sourceIndex];','instance.color=input.instanceColor;instance.weather.z=input.instanceSeed;');
 if(code.includes('@location(3) @interpolate(flat) sourceIndex:u32,'))return code
  .replace('@location(3) @interpolate(flat) sourceIndex:u32,','@location(3) @interpolate(flat) instanceColor:vec4<f32>,')
  .replace('out.sourceIndex=sourceIndex;','out.instanceColor=instance.color;')
  .replace('instance=instanceSource[in.sourceIndex];','instance.color=in.instanceColor;');
 return code;
}
