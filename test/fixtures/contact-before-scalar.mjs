import {Vsub,Vscale,Vdot,Vlen} from '../../dist/physics/compound.js';
export function solveContact(c) {
    const { a, b, p, n } = c, rv = Vsub(a.pointVelocity(p), b ? b.pointVelocity(p) : [0, 0, 0]), k = c.kn;
    if (k < 0.000000000001)
      return;
    const old = c.jn;
    c.jn = c.projected ? old + Math.max(0, (c.target - Vdot(rv, n)) / k) : Math.max(0, old + (c.target - Vdot(rv, n)) / k);
    const j = Vscale(n, c.jn - old);
    a.impulse(j, p);
    if (b)
      b.impulse(Vscale(j, -1), p);
    const vel = Vsub(a.pointVelocity(p), b ? b.pointVelocity(p) : [0, 0, 0]), t = Vsub(vel, Vscale(n, Vdot(vel, n))), speed = Vlen(t);
    if (speed > 0.0001) {
      const direction = Vscale(t, 1 / speed), kt = this.effective(a, b, p, direction), wanted = Vsub(c.jt, Vscale(direction, speed / kt)), length = Vlen(wanted), limit = c.mu * c.jn, next = length > limit ? Vscale(wanted, limit / length) : wanted, jt = Vsub(next, c.jt);
      c.jt = next;
      a.impulse(jt, p);
      if (b)
        b.impulse(Vscale(jt, -1), p);
    }
  }
