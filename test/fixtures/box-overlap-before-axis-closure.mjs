// Frozen Engine source before closure hoist; source SHA256 e8ac0b4f840d46b3feaae2a93e615014ab1b037c6843616e60c4ee233c75d550.
export function boxBounds(box) {
  let x = 0, y = 0, z = 0;
  for (let i = 0;i < 3; i++) {
    const axis = box.axes[i], half = box.half[i];
    x += Math.abs(axis[0]) * half;
    y += Math.abs(axis[1]) * half;
    z += Math.abs(axis[2]) * half;
  }
  return [box.p[0] - x, box.p[1] - y, box.p[2] - z, box.p[0] + x, box.p[1] + y, box.p[2] + z];
}
export function withBoxBounds(box) {
  return Object.assign(box, { bounds: boxBounds(box) });
}
export function boxBoundsOverlap(a, b, margin = 0.006) {
  const A = a.bounds ?? boxBounds(a), B = b.bounds ?? boxBounds(b), padding = Math.max(0, margin) * 2;
  return A[0] <= B[3] + padding && B[0] <= A[3] + padding && A[1] <= B[4] + padding && B[1] <= A[4] + padding && A[2] <= B[5] + padding && B[2] <= A[5] + padding;
}
export function boxesPenetrate(a, b, depth = 0.012) {
  const dx = a.p[0] - b.p[0], dy = a.p[1] - b.p[1], dz = a.p[2] - b.p[2];
  const passes = (x, y, z) => {
    let radius = 0;
    for (let i = 0;i < 3; i++) {
      const u = a.axes[i], v = b.axes[i];
      radius += Math.abs(u[0] * x + u[1] * y + u[2] * z) * a.half[i] + Math.abs(v[0] * x + v[1] * y + v[2] * z) * b.half[i];
    }
    return radius - Math.abs(dx * x + dy * y + dz * z) > depth;
  };
  for (const axes of [a.axes, b.axes])
    for (const axis of axes)
      if (!passes(axis[0], axis[1], axis[2]))
        return false;
  for (const u of a.axes)
    for (const v of b.axes) {
      const x = u[1] * v[2] - u[2] * v[1], y = u[2] * v[0] - u[0] * v[2], z = u[0] * v[1] - u[1] * v[0], squared = x * x + y * y + z * z;
      if (squared <= 0.000000001)
        continue;
      const length = Math.sqrt(squared);
      if (!passes(x / length, y / length, z / length))
        return false;
    }
  return true;
}
export const STATIC_COLLISION_CELL_SIZE = 8;
export function staticQueryRadius(origin, boxes) {
  let radius = 0;
  for (const box of boxes) {
    let x = Math.abs(box.p[0] - origin[0]), z = Math.abs(box.p[2] - origin[2]);
    for (let i = 0;i < 3; i++) {
      x += Math.abs(box.axes[i][0]) * box.half[i];
      z += Math.abs(box.axes[i][2]) * box.half[i];
    }
    radius = Math.max(radius, Math.hypot(x, z));
  }
  return radius;
}
