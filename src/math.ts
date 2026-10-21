export type Vec3 = readonly [number, number, number];
export type MutableVec3 = [number, number, number];
export type Mat4 = Float32Array;

export const V3 = {
  add: (a: Vec3, b: Vec3): MutableVec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]],
  sub: (a: Vec3, b: Vec3): MutableVec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]],
  scale: (a: Vec3, s: number): MutableVec3 => [a[0] * s, a[1] * s, a[2] * s],
  dot: (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2],
  length: (a: Vec3): number => Math.hypot(a[0], a[1], a[2]),
  normalize(a: Vec3): MutableVec3 {
    const length = Math.hypot(a[0], a[1], a[2]);
    return length > 1e-12 ? [a[0] / length, a[1] / length, a[2] / length] : [0, 0, 0];
  },
  cross(a: Vec3, b: Vec3): MutableVec3 {
    return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  },
};

export function multiply4(a: ArrayLike<number>, b: ArrayLike<number>): Mat4 {
  const out = new Float32Array(16);
  for (let column = 0; column < 4; column++) for (let row = 0; row < 4; row++) {
    out[column * 4 + row] = a[row]! * b[column * 4]! + a[4 + row]! * b[column * 4 + 1]! + a[8 + row]! * b[column * 4 + 2]! + a[12 + row]! * b[column * 4 + 3]!;
  }
  return out;
}

/** Writes into renderer-owned scratch memory; out must not alias either input. */
export function multiply4Into(a:ArrayLike<number>,b:ArrayLike<number>,out:Float32Array):void{
  for(let column=0;column<4;column++)for(let row=0;row<4;row++)out[column*4+row]=a[row]!*b[column*4]!+a[4+row]!*b[column*4+1]!+a[8+row]!*b[column*4+2]!+a[12+row]!*b[column*4+3]!;
}

export function perspective(fovRadians: number, aspect: number, near = 0.05, far = 10_000): Mat4 {
  const f = 1 / Math.tan(fovRadians / 2), range = 1 / (near - far);
  return new Float32Array([f / aspect,0,0,0, 0,f,0,0, 0,0,far*range,-1, 0,0,near*far*range,0]);
}

export function lookAt(eye: Vec3, target: Vec3, up: Vec3 = [0, 1, 0]): Mat4 {
  const z = V3.normalize(V3.sub(eye, target));
  let x = V3.normalize(V3.cross(up, z));
  if (V3.length(x) < 1e-6) x = [1, 0, 0];
  const y = V3.cross(z, x);
  return new Float32Array([x[0],y[0],z[0],0, x[1],y[1],z[1],0, x[2],y[2],z[2],0, -V3.dot(x,eye),-V3.dot(y,eye),-V3.dot(z,eye),1]);
}

export function compose(position: Vec3, rotation: Vec3, scale: Vec3): Mat4 {
  const [rx, ry, rz] = rotation;
  const sx=Math.sin(rx),cx=Math.cos(rx),sy=Math.sin(ry),cy=Math.cos(ry),sz=Math.sin(rz),cz=Math.cos(rz);
  const m00=cy*cz,m01=sx*sy*cz+cx*sz,m02=-cx*sy*cz+sx*sz;
  const m10=-cy*sz,m11=-sx*sy*sz+cx*cz,m12=cx*sy*sz+sx*cz;
  const m20=sy,m21=-sx*cy,m22=cx*cy;
  return new Float32Array([m00*scale[0],m01*scale[0],m02*scale[0],0, m10*scale[1],m11*scale[1],m12*scale[1],0, m20*scale[2],m21*scale[2],m22*scale[2],0, position[0],position[1],position[2],1]);
}

export function finiteVec3(value: readonly number[], label: string): asserts value is Vec3 {
  if (value.length !== 3 || value.some(component => !Number.isFinite(component))) throw new TypeError(`${label} must contain three finite numbers`);
}
