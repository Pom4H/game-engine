import {lookAt,multiply4,V3,type Mat4,type Vec3} from '../math.js';

/** Both shadow maps share this projection, so use the coarser map's texel grid.
 * Build the light basis independently of the moving target: subtracting a large
 * target from its translated eye otherwise introduces tiny rotation changes.
 * Snap depth too, so sub-texel movement cannot invalidate a resident static map. */
export function sunShadowProjection(target:Vec3,direction:Vec3,extent:number,mapSize:number):Mat4{
  const sun=V3.normalize(direction),view=lookAt(V3.scale(sun,180),[0,0,0]);
  const near=1,far=400,texel=2*extent/mapSize;
  const projection=multiply4(new Float32Array([1/extent,0,0,0,0,1/extent,0,0,0,0,1/(near-far),0,0,0,near/(near-far),1]),view);
  for(let row=0;row<3;row++){
    const coordinate=view[row]!*target[0]+view[4+row]!*target[1]+view[8+row]!*target[2];
    const snapped=Math.round(coordinate/texel);
    // Set XY directly in clip space so arbitrary extents cannot round a whole
    // texel offset while storing a large world translation in a float32 matrix.
    projection[12+row]=row===2?(near-180-snapped*texel)/(near-far):snapped===0?0:-snapped*2/mapSize;
  }
  return projection;
}
