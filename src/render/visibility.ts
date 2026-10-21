import type {Mat4,Vec3} from '../math.js';
export interface MeshBounds {center:Vec3;half:Vec3}
/** Bounds of the actual generated mesh, including deformed snow and imported assets. */
export function meshBounds(vertices:Float32Array):MeshBounds{
 const lo=[Infinity,Infinity,Infinity],hi=[-Infinity,-Infinity,-Infinity];
 for(let i=0;i<vertices.length;i+=6)for(let axis=0;axis<3;axis++){lo[axis]=Math.min(lo[axis]!,vertices[i+axis]!);hi[axis]=Math.max(hi[axis]!,vertices[i+axis]!);}
 return {center:[(lo[0]!+hi[0]!)*.5,(lo[1]!+hi[1]!)*.5,(lo[2]!+hi[2]!)*.5],half:[(hi[0]!-lo[0]!)*.5,(hi[1]!-lo[1]!)*.5,(hi[2]!-lo[2]!)*.5]};
}
/** Conservative box/clip-plane test. WebGPU's near plane is z=0, not z=-w.
 * Test each pass independently: offscreen objects can still cast visible shadows
 * or appear in the mirrored camera. Straddling boxes must never disappear. */
export function intersectsClip(bounds:MeshBounds,m:Mat4,displacement?:{projection:Mat4;worldY:number}):boolean{
 for(let plane=0;plane<6;plane++){
  const row=plane>>1,sign=(plane&1)?-1:1,near=plane===4;
  const a=near?m[2]!:m[3]!+sign*m[row]!,b=near?m[6]!:m[7]!+sign*m[4+row]!,c=near?m[10]!:m[11]!+sign*m[8+row]!,d=near?m[14]!:m[15]!+sign*m[12+row]!;
  const distance=a*bounds.center[0]+b*bounds.center[1]+c*bounds.center[2]+d;
  let radius=Math.abs(a)*bounds.half[0]+Math.abs(b)*bounds.half[1]+Math.abs(c)*bounds.half[2];
  // displaceWorld moves vertices along world Y after applying the object model.
  // Its clip-plane support comes from the view projection, without model scale.
  if(displacement){const vp=displacement.projection;radius+=Math.abs(near?vp[6]!:vp[7]!+sign*vp[4+row]!)*displacement.worldY;}
  if(distance+radius < -1e-5)return false;
 }
 return true;
}

/** True ONLY when this whole world-space AABB is inside every WebGPU clip
 * plane. The generous positive margin avoids unsafe visibility shortcuts. */
export function containsClipBounds(bounds:MeshBounds,vp:Mat4):boolean{
 for(let plane=0;plane<6;plane++){
  const row=plane>>1,sign=(plane&1)?-1:1,near=plane===4;
  const a=near?vp[2]!:vp[3]!+sign*vp[row]!;
  const b=near?vp[6]!:vp[7]!+sign*vp[4+row]!;
  const c=near?vp[10]!:vp[11]!+sign*vp[8+row]!;
  const d=near?vp[14]!:vp[15]!+sign*vp[12+row]!;
  const distance=a*bounds.center[0]+b*bounds.center[1]+c*bounds.center[2]+d;
  const radius=Math.abs(a)*bounds.half[0]+Math.abs(b)*bounds.half[1]+Math.abs(c)*bounds.half[2];
  if(distance-radius<1e-4)return false;
 }
 return true;
}
