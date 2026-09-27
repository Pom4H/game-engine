import type {MutableVec3, Vec3} from '../math.js';

/** The same Euler basis as PhysicsWorld/compose, in f64. One evaluation per body/substep. */
export class ForceFrame {
  readonly basis = new Float64Array(9);
  readonly force: MutableVec3 = [0, 0, 0];
  readonly torque: MutableVec3 = [0, 0, 0];
  builds = 0;
  update(rotation: Vec3): void {
    const [rx, ry, rz] = rotation;
    const sx = Math.sin(rx), cx = Math.cos(rx), sy = Math.sin(ry), cy = Math.cos(ry), sz = Math.sin(rz), cz = Math.cos(rz);
    const b = this.basis;
    b[0]=cy*cz; b[1]=sx*sy*cz+cx*sz; b[2]=-cx*sy*cz+sx*sz;
    b[3]=-cy*sz; b[4]=-sx*sy*sz+cx*cz; b[5]=cx*sy*sz+sx*cz;
    b[6]=sy; b[7]=-sx*cy; b[8]=cx*cy;
    this.builds++;
  }
  clear(): void { this.force.fill(0); this.torque.fill(0); }
  rotate(v: Vec3, out: MutableVec3): void {
    const b = this.basis, x = v[0], y = v[1], z = v[2];
    out[0] = b[0]!*x+b[3]!*y+b[6]!*z;
    out[1] = b[1]!*x+b[4]!*y+b[7]!*z;
    out[2] = b[2]!*x+b[5]!*y+b[8]!*z;
  }
  /** Force and COM-relative lever arm, both world-space. Does not integrate a second body. */
  add(force: Vec3, arm: Vec3): void {
    const f = this.force, t = this.torque;
    f[0] += force[0]; f[1] += force[1]; f[2] += force[2];
    t[0] += arm[1]*force[2]-arm[2]*force[1];
    t[1] += arm[2]*force[0]-arm[0]*force[2];
    t[2] += arm[0]*force[1]-arm[1]*force[0];
  }
}
