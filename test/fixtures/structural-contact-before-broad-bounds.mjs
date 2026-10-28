// Frozen production projection before bounded broad phase / scalar reuse, 2026-10-27.
export class StructuralSolidContactSolver {
  samples;
  local = new Float64Array(6);
  bounds = new Float64Array(0);
  radii;
  maxRadius;
  weights;
  constraints;
  constructor(bodyNodes, edges = [], spheres = [], sections = []) {
    const samples = [];
    for (let i = 0;i < bodyNodes; i++)
      samples.push([i, i]);
    for (const edge of edges)
      if (edge.a < bodyNodes && edge.b < bodyNodes)
        samples.push([edge.a, edge.b]);
    const radii = Array(samples.length).fill(0);
    for (const sphere of spheres) {
      if (!Number.isInteger(sphere.node) || sphere.node < 0 || !Number.isFinite(sphere.radius) || sphere.radius <= 0)
        throw new RangeError("Invalid structural contact sphere");
      samples.push([sphere.node, sphere.node]);
      radii.push(sphere.radius);
    }
    const weights = samples.map(([a, b]) => a === b ? 0 : 0.5), constraints = Array(samples.length).fill(-1);
    for (const section of sections) {
      if (![section.a, section.b, section.constraint].every((n) => Number.isInteger(n) && n >= 0) || !(section.radius > 0 && Number.isFinite(section.radius)))
        throw new RangeError("Invalid structural contact section");
      for (const t of [0.25, 0.5, 0.75]) {
        samples.push([section.a, section.b]);
        radii.push(section.radius);
        weights.push(t);
        constraints.push(section.constraint);
      }
    }
    this.weights = weights;
    this.constraints = constraints;
    this.samples = samples;
    this.radii = radii;
    this.maxRadius = Math.max(0, ...radii);
  }
  project(body, boxes, planes) {
    const { position: pos, previous: prev } = body, local = this.local;
    if (this.bounds.length < boxes.length * 6)
      this.bounds = new Float64Array(2 ** Math.ceil(Math.log2(boxes.length * 6)));
    const bounds = this.bounds;
    for (let i = 0;i < boxes.length; i++) {
      const box = boxes[i];
      for (let k = 0;k < 3; k++) {
        const padding = 0.006 + this.maxRadius, extent = Math.abs(box.axes[0][k]) * (box.half[0] + padding) + Math.abs(box.axes[1][k]) * (box.half[1] + padding) + Math.abs(box.axes[2][k]) * (box.half[2] + padding) + 0.000000001;
        bounds[i * 6 + k] = box.p[k] - extent;
        bounds[i * 6 + 3 + k] = box.p[k] + extent;
      }
    }
    for (let sample = 0;sample < this.samples.length; sample++) {
      const constraint = this.constraints[sample];
      if (constraint >= 0 && body.broken[constraint])
        continue;
      const [a, b] = this.samples[sample], padding = 0.006 + this.radii[sample];
      const A = a * 3, B = b * 3, wb = this.weights[sample], wa = 1 - wb, inv = body.inverseMass[a] * wa * wa + body.inverseMass[b] * wb * wb;
      if (inv <= 0)
        continue;
      for (let boxIndex = 0;boxIndex < boxes.length; boxIndex++) {
        const box = boxes[boxIndex], offset = boxIndex * 6;
        const x = pos[A] * wa + pos[B] * wb, y = pos[A + 1] * wa + pos[B + 1] * wb, z = pos[A + 2] * wa + pos[B + 2] * wb;
        const px = prev[A] * wa + prev[B] * wb, py = prev[A + 1] * wa + prev[B + 1] * wb, pz = prev[A + 2] * wa + prev[B + 2] * wb;
        if (Math.max(x, px) < bounds[offset] || Math.min(x, px) > bounds[offset + 3] || Math.max(y, py) < bounds[offset + 1] || Math.min(y, py) > bounds[offset + 4] || Math.max(z, pz) < bounds[offset + 2] || Math.min(z, pz) > bounds[offset + 5])
          continue;
        for (let k = 0;k < 3; k++) {
          const axis = box.axes[k], dx = x - box.p[0], dy = y - box.p[1], dz = z - box.p[2];
          const oldX = px - box.p[0], oldY = py - box.p[1], oldZ = pz - box.p[2];
          local[k] = dx * axis[0] + dy * axis[1] + dz * axis[2];
          local[k + 3] = oldX * axis[0] + oldY * axis[1] + oldZ * axis[2];
        }
        let enter = 0, exit = 1, face = -1, sign = 0, inside = true, nearest = 1 / 0, nearAxis = 0, nearSign = 1;
        for (let k = 0;k < 3; k++) {
          const half = box.half[k] + padding, now = local[k], old = local[k + 3], delta = now - old, gap = half - Math.abs(now);
          if (gap < 0)
            inside = false;
          if (gap < nearest) {
            nearest = gap;
            nearAxis = k;
            nearSign = now >= 0 ? 1 : -1;
          }
          if (Math.abs(delta) < 0.000000000001) {
            if (Math.abs(old) > half) {
              exit = -1;
              break;
            }
            continue;
          }
          let t0 = (-half - old) / delta, t1 = (half - old) / delta, s = -1;
          if (t0 > t1) {
            [t0, t1] = [t1, t0];
            s = 1;
          }
          if (t0 >= enter) {
            enter = t0;
            face = k;
            sign = s;
          }
          exit = Math.min(exit, t1);
          if (enter > exit)
            break;
        }
        if (!(enter <= exit && enter <= 1 && exit >= 0))
          continue;
        if (face < 0) {
          if (!inside)
            continue;
          face = nearAxis;
          sign = nearSign;
        }
        const depth = box.half[face] + padding - sign * local[face];
        if (depth <= 0)
          continue;
        const n = box.axes[face], scale = depth / inv;
        this.move(body, a, n[0], n[1], n[2], sign * scale * body.inverseMass[a] * wa);
        if (wb)
          this.move(body, b, n[0], n[1], n[2], sign * scale * body.inverseMass[b] * wb);
      }
      for (const plane of planes) {
        const x = pos[A] * wa + pos[B] * wb, y = pos[A + 1] * wa + pos[B + 1] * wb, z = pos[A + 2] * wa + pos[B + 2] * wb, n = plane.n;
        const dx = x - plane.p[0], dy = y - plane.p[1], dz = z - plane.p[2], depth = padding - (dx * n[0] + dy * n[1] + dz * n[2]);
        if (depth <= 0 || depth > 0.5 + this.radii[sample] * 2)
          continue;
        const u = dx * plane.u[0] + dy * plane.u[1] + dz * plane.u[2], v = dx * plane.v[0] + dy * plane.v[1] + dz * plane.v[2];
        if (Math.abs(u) > plane.hu || Math.abs(v) > plane.hv || plane.filter && !plane.filter([x, y, z]))
          continue;
        const scale = depth / inv;
        this.move(body, a, n[0], n[1], n[2], scale * body.inverseMass[a] * wa);
        if (wb)
          this.move(body, b, n[0], n[1], n[2], scale * body.inverseMass[b] * wb);
      }
    }
  }
  move(body, node, x, y, z, scale) {
    const j = node * 3;
    body.position[j] = body.position[j] + x * scale;
    body.position[j + 1] = body.position[j + 1] + y * scale;
    body.position[j + 2] = body.position[j + 2] + z * scale;
  }
}
