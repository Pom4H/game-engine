import type {CameraSpec} from '../scene/types.js';
import type {Mat4} from '../math.js';
import {perspective} from '../math.js';

export interface CameraProjection {
  /** Column-major WebGPU clip projection. */
  readonly matrix:Mat4;
  /** sx, sy, ox, oy where ndc=(sx*x/z+ox, sy*y/z+oy). */
  readonly ray:readonly [number,number,number,number];
}

/**
 * Build the render projection from either authored FOV or exact calibrated
 * pinhole intrinsics. Intrinsics stay authoritative when a capture is resized;
 * only a matching aspect ratio is accepted so principal point/focal geometry
 * cannot silently drift.
 */
export function cameraProjection(camera:CameraSpec,renderWidth:number,renderHeight:number,near=.05,far=10_000):CameraProjection{
  if(!camera.intrinsics){
    const tan=Math.tan((camera.fov??55)*Math.PI/360),aspect=renderWidth/renderHeight;
    return{matrix:perspective((camera.fov??55)*Math.PI/180,aspect,near,far),ray:[1/(aspect*tan),1/tan,0,0]};
  }
  const {fx,fy,cx,cy,width,height}=camera.intrinsics;
  const sourceAspect=width/height,renderAspect=renderWidth/renderHeight;
  if(Math.abs(sourceAspect-renderAspect)>1e-4)throw new RangeError(`Calibrated camera aspect ${sourceAspect.toFixed(6)} != render aspect ${renderAspect.toFixed(6)}`);
  const sx=2*fx/width,sy=2*fy/height,ox=2*cx/width-1,oy=1-2*cy/height,range=1/(near-far);
  const matrix=new Float32Array([
    sx,0,0,0,
    0,sy,0,0,
    -ox,-oy,far*range,-1,
    0,0,near*far*range,0,
  ]);
  return{matrix,ray:[sx,sy,ox,oy]};
}
