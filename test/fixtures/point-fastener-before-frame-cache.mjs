import { Vsub, Vdot, Vscale, Vcross, Vlen } from "../../dist/physics/compound.js";

export class PointFastener {
  a;
  b;
  anchorA;
  localB;
  spec;
  broken = false;
  enabled = true;
  force = 0;
  extension = 0;
  impulse = [0, 0, 0];
  constructor(a, b, anchorA, localB, spec) {
    this.a = a;
    this.b = b;
    this.anchorA = anchorA;
    this.localB = localB;
    this.spec = spec;
    if (![spec.stiffness, spec.damping, spec.failureForce, spec.engagement].every((n) => Number.isFinite(n) && n > 0))
      throw new RangeError("Invalid point fastener");
  }
  beginStep() {
    this.impulse.fill(0);
    this.force = 0;
  }
  endStep() {
    if (this.enabled && !this.broken && this.force > this.spec.failureForce)
      this.broken = true;
  }
  solve(dt) {
    if (this.broken || !this.enabled)
      return;
    const pa = this.anchorA(), pb = this.b.point(this.localB), error = Vsub(pb, pa);
    this.extension = Vlen(error);
    if (this.extension > this.spec.engagement) {
      this.broken = true;
      return;
    }
    const gamma = 1 / (dt * (this.spec.damping + dt * this.spec.stiffness)), beta = dt * this.spec.stiffness * gamma;
    for (let axis = 0;axis < 3; axis++) {
      const n = [0, 0, 0];
      n[axis] = 1;
      const ra = Vsub(pa, this.a.p), rb = Vsub(pb, this.b.p);
      const inverse = (body, p, r) => body.deformable?.active ? body.deformable.inverseEffectiveMass(p, n) : body.invMass + Vdot(n, Vcross(body.inertia(Vcross(r, n)), r));
      const k = inverse(this.a, pa, ra) + inverse(this.b, pb, rb);
      if (k <= 0)
        continue;
      const speed = Vdot(Vsub(this.b.pointVelocity(pb), this.a.pointVelocity(pa)), n), delta = -(speed + beta * error[axis] + gamma * this.impulse[axis]) / (k + gamma);
      this.impulse[axis] += delta;
      const j = Vscale(n, delta);
      this.b.impulse(j, pb);
      this.a.impulse(Vscale(j, -1), pa);
    }
    this.force = Vlen(this.impulse) / dt;
  }
}
