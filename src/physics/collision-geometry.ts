import type {Vec3} from '../math.js';

export type Collider=
 |{readonly kind:'sphere';readonly radius:number}
 |{readonly kind:'box';readonly half:Vec3}
 |{readonly kind:'capsule';readonly radius:number;readonly halfHeight:number}
 |{readonly kind:'convex';readonly points:readonly Vec3[]}
 |{readonly kind:'triangle-mesh';readonly positions:readonly number[];readonly indices:readonly number[]}
 |{readonly kind:'heightfield';readonly width:number;readonly depth:number;readonly cellSize:number;readonly heights:readonly number[]};
export interface ColliderBounds{readonly min:Vec3;readonly max:Vec3}
export function validateCollider(collider:Collider):Collider{
  if(collider.kind==='sphere'){if(!Number.isFinite(collider.radius)||collider.radius<=0)throw new RangeError('Sphere radius must be positive');}
  else if(collider.kind==='box'){if(collider.half.length!==3||collider.half.some(v=>!Number.isFinite(v)||v<=0))throw new RangeError('Box half extents must be positive');}
  else if(collider.kind==='capsule'){if(!Number.isFinite(collider.radius)||collider.radius<=0||!Number.isFinite(collider.halfHeight)||collider.halfHeight<0)throw new RangeError('Invalid capsule');}
  else if(collider.kind==='convex'){if(collider.points.length<4||collider.points.some(point=>point.length!==3||point.some(v=>!Number.isFinite(v))))throw new RangeError('Convex collider requires finite points');}
  else if(collider.kind==='triangle-mesh'){const vertices=collider.positions.length/3;if(vertices<3||collider.positions.length%3||collider.indices.length<3||collider.indices.length%3||collider.positions.some(v=>!Number.isFinite(v))||collider.indices.some(i=>!Number.isSafeInteger(i)||i<0||i>=vertices))throw new RangeError('Invalid triangle mesh collider');}
  else{if(!Number.isSafeInteger(collider.width)||!Number.isSafeInteger(collider.depth)||collider.width<2||collider.depth<2||!Number.isFinite(collider.cellSize)||collider.cellSize<=0||collider.heights.length!==collider.width*collider.depth||collider.heights.some(v=>!Number.isFinite(v)))throw new RangeError('Invalid heightfield collider');}
  return collider;
}
export function colliderBounds(input:Collider):ColliderBounds{
  const c=validateCollider(input);
  if(c.kind==='sphere')return{min:[-c.radius,-c.radius,-c.radius],max:[c.radius,c.radius,c.radius]};
  if(c.kind==='box')return{min:[-c.half[0],-c.half[1],-c.half[2]],max:[c.half[0],c.half[1],c.half[2]]};
  if(c.kind==='capsule')return{min:[-c.radius,-c.halfHeight-c.radius,-c.radius],max:[c.radius,c.halfHeight+c.radius,c.radius]};
  if(c.kind==='heightfield'){const minY=Math.min(...c.heights),maxY=Math.max(...c.heights);return{min:[0,minY,0],max:[(c.width-1)*c.cellSize,maxY,(c.depth-1)*c.cellSize]};}
  const points:readonly Vec3[]=c.kind==='convex'?c.points:Array.from({length:c.positions.length/3},(_,i)=>[c.positions[i*3]!,c.positions[i*3+1]!,c.positions[i*3+2]!] as Vec3);
  const min:[number,number,number]=[Infinity,Infinity,Infinity],max:[number,number,number]=[-Infinity,-Infinity,-Infinity];
  for(const point of points)for(let axis=0;axis<3;axis++){const value=point[axis]!;min[axis]=Math.min(min[axis]!,value);max[axis]=Math.max(max[axis]!,value);}
  return{min,max};
}
