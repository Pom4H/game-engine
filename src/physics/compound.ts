import { boxBoundsOverlap, withBoxBounds, boxesPenetrate, staticQueryRadius, STATIC_COLLISION_CELL_SIZE } from './box-overlap.js';
// Full compound 6-DOF kernel promoted from TheGame's rigid solver.
// Original source SHA-256 E82B4281A744C7A0DF2405C79EEF829592F9A20A5E1509E833BBF85956D4836B.
// SI units, Y up. Convex boxes and finite planes; application policies are callbacks.
// Sequential impulses, angular inertia, Coulomb friction, speculative contacts and motion substeps.
import { SpatialHash } from '../core/spatial-hash.js';
import {StaticGroupStorage,type StaticCollisionGroup} from './static-groups.js';
const clamp = (x: number, a: number, b: number) => Math.max(a, Math.min(b, x));
export const COMPOUND_PHYSICS_BACKEND = 'the-engine-compound' as const;
type Vector = readonly number[];
type Vec = [
    number,
    number,
    number
];
type Quaternion = [
    number,
    number,
    number,
    number
];
type Axes = readonly [
    Vec,
    Vec,
    Vec
];
export interface SolidShape {
    half: Vector;
    offset?: Vector;
    q?: Vector;
    tag?: string;
    structureNode?: number | undefined;
    structureBeam?: number | undefined;
}
export interface SolidBodyOptions {
    p?: Vector;
    q?: Vector;
    half?: Vector;
    mass?: number;
    shapes?: SolidShape[] | null;
    friction?: number;
    restitution?: number;
    tag?: string;
}
export interface SolidBox {
    body: SolidBody;
    p: Vec;
    axes: Axes;
    half: Vector;
    tag: string;
    bounds?: import('./box-overlap.js').BoxBounds;
    structureNode?: number | undefined;
    structureBeam?: number | undefined;
}
type Geometry = import('./box-overlap.js').OrientedBox;
export interface SolidPlane {
    id: number;
    plane: true;
    p: Vector;
    n: Vec;
    u: Vec;
    v: Vec;
    hu: number;
    hv: number;
    tag: string;
    filter: ((p: Vec) => boolean) | null;
    x: number;
    z: number;
    radius: number;
    body: null;
    enabled?: boolean;
}
export interface SolidPlaneOptions {
    p: Vector;
    n?: Vector;
    u?: Vector;
    v?: Vector;
    hu?: number;
    hv?: number;
    tag?: string;
    filter?: ((p: Vec) => boolean) | null;
}
export interface SolidRayHit {
    t: number;
    n: Vector;
    p: Vec;
    body: SolidBody | null | undefined;
    tag: string | undefined;
    plane?: SolidPlane;
}
export interface SolidContact {
    a: SolidBody;
    b: SolidBody | null;
    p: Vec;
    n: Vec;
    depth: number;
    tag: string;
    kn: number;
    jn: number;
    jt: Vec;
    target: number;
    mu: number;
    approach: number;
    escapeManifold?: boolean;
}
export interface SolidImpact {
    a: SolidBody;
    b: SolidBody | null;
    p: Vec;
    n: Vec;
    impulse: number;
    approach: number;
    tag: string;
}
export type SolidJoint = {
    type: 'distance';
    a: SolidBody;
    b: SolidBody;
    length: number;
} | {
    type: 'range';
    a: SolidBody;
    b: SolidBody;
    min: number;
    max: number;
} | {
    type?: undefined;
    a: SolidBody;
    b: SolidBody;
    anchorA: Vector;
    anchorB: Vector;
};
export interface SolidPolicies {
    /** Application contact roles, without tags or vehicle ownership in the solver. */
    frictionLimit?(a: SolidBody, b: SolidBody): number;
    escapeAmbiguous?(a: SolidBody, b: SolidBody): boolean;
    rayBody?(body: SolidBody, ignore: SolidBody | null): boolean;
    active?(body: SolidBody): boolean;
    supported?(body: SolidBody): boolean;
    supports?(body: SolidBody): readonly SolidBody[];
}
export interface SolidWorldOptions {
    gravity?: Vector;
    iterations?: number;
    policies?: SolidPolicies;
}
export const Vadd = (a: Vector, b: Vector): Vec => [a[0]! + b[0]!, a[1]! + b[1]!, a[2]! + b[2]!];
export const Vsub = (a: Vector, b: Vector): Vec => [a[0]! - b[0]!, a[1]! - b[1]!, a[2]! - b[2]!];
export const Vscale = (a: Vector, k: number): Vec => [a[0]! * k, a[1]! * k, a[2]! * k];
export const Vdot = (a: Vector, b: Vector) => a[0]! * b[0]! + a[1]! * b[1]! + a[2]! * b[2]!;
export const Vcross = (a: Vector, b: Vector): Vec => [a[1]! * b[2]! - a[2]! * b[1]!, a[2]! * b[0]! - a[0]! * b[2]!, a[0]! * b[1]! - a[1]! * b[0]!];
export const Vlen = (a: Vector) => Math.hypot(a[0]!, a[1]!, a[2]!);
export const Vunit = (a: Vector): Vec => Vscale(a, 1 / (Vlen(a) || 1));
export const Qmul = (a: Vector, b: Vector): Quaternion => [a[3]! * b[0]! + a[0]! * b[3]! + a[1]! * b[2]! - a[2]! * b[1]!, a[3]! * b[1]! - a[0]! * b[2]! + a[1]! * b[3]! + a[2]! * b[0]!, a[3]! * b[2]! + a[0]! * b[1]! - a[1]! * b[0]! + a[2]! * b[3]!, a[3]! * b[3]! - a[0]! * b[0]! - a[1]! * b[1]! - a[2]! * b[2]!];
export const Qunit = (q: Vector): Quaternion => { let k = 1 / (Math.hypot(...q) || 1); return q.map(v => v * k) as Quaternion; };
export const Qaxis = (axis: Vector, angle: number): Quaternion => [...Vscale(Vunit(axis), Math.sin(angle / 2)), Math.cos(angle / 2)];
export const Qeuler = (yaw = 0, roll = 0, pitch = 0) => Qmul(Qmul(Qaxis([0, 1, 0], yaw), Qaxis([1, 0, 0], pitch)), Qaxis([0, 0, 1], roll));
export function Qrotate(q: Vector, v: Vector): Vec { const u = [q[0]!, q[1]!, q[2]!], t = Vscale(Vcross(u, v), 2); return Vadd(v, Vadd(Vscale(t, q[3]!), Vcross(u, t))); }
export const QinverseRotate = (q: Vector, v: Vector) => Qrotate([-q[0]!, -q[1]!, -q[2]!, q[3]!], v);
// Keep Qrotate's evaluation stages for each basis without temporary vectors.
// Zero products, repeated coercions and fresh output arrays remain observable.
function rotateBasis(q: Vector, x: number, y: number, z: number): Vec {
    const ux = q[0]!, uy = q[1]!, uz = q[2]!;
    const firstX = uy * z - uz * y, firstY = uz * x - ux * z, firstZ = ux * y - uy * x;
    const tx = firstX * 2, ty = firstY * 2, tz = firstZ * 2;
    const scalar = q[3]!, scaledX = tx * scalar, scaledY = ty * scalar, scaledZ = tz * scalar;
    const crossX = uy * tz - uz * ty, crossY = uz * tx - ux * tz, crossZ = ux * ty - uy * tx;
    const innerX = scaledX + crossX, innerY = scaledY + crossY, innerZ = scaledZ + crossZ;
    return [x + innerX, y + innerY, z + innerZ];
}
function rotationAxes(q:Vector):Axes{return [rotateBasis(q,1,0,0),rotateBasis(q,0,1,0),rotateBasis(q,0,0,1)];}
export function Qangles(q: Vector) { const x = Qrotate(q, [1, 0, 0]), y = Qrotate(q, [0, 1, 0]), z = Qrotate(q, [0, 0, 1]); return { yaw: Math.atan2(z[0]!, z[2]!), pitch: Math.asin(clamp(-z[1]!, -1, 1)), roll: Math.atan2(x[1]!, y[1]!) }; }
let solidId = 1;
export class SolidBody {
    id: number;
    p: Vec;
    q: Quaternion;
    v: Vec;
    w: Vec;
    force: Vec;
    torque: Vec;
    half: Vec;
    mass: number;
    invMass: number;
    invI: Vec;
    shapes: SolidShape[];
    friction: number;
    restitution: number;
    tag: string;
    enabled: boolean;
    sleepTime: number;
    sleeping: boolean;
    sleepBoxes: SolidBox[] | null;
    sleepSupports: {
        body: SolidBody;
        p: Vec;
        q: Quaternion;
    }[];
    radius: number;
    contacts: number;
    ignore: Set<number>;
    declare readonly plane?: false;
    declare x: number;
    declare z: number;
    declare removed?: boolean;
    declare cachedBoxes?: SolidBox[];
    declare indexRadius?: number;
    private inertiaCache?: {
        q: Quaternion;
        i: Vec;
        m: number[];
    };
    constructor({ p = [0, 1, 0], q = [0, 0, 0, 1], half = [.5, .5, .5], mass = 0, shapes = null, friction = .65, restitution = .03, tag = 'solid' }: SolidBodyOptions = {}) {
        this.id = solidId++;
        this.p = [...p] as Vec;
        this.q = Qunit(q);
        this.v = [0, 0, 0];
        this.w = [0, 0, 0];
        this.force = [0, 0, 0];
        this.torque = [0, 0, 0];
        this.half = [...half] as Vec;
        this.mass = mass;
        this.invMass = mass > 0 ? 1 / mass : 0;
        this.invI = mass > 0 ? [3 / (mass * (half[1]! ** 2 + half[2]! ** 2)), 3 / (mass * (half[0]! ** 2 + half[2]! ** 2)), 3 / (mass * (half[0]! ** 2 + half[1]! ** 2))] : [0, 0, 0];
        this.shapes = shapes || [{ half: [...half], offset: [0, 0, 0] }];
        this.friction = friction;
        this.restitution = restitution;
        this.tag = tag;
        this.enabled = true;
        this.sleepTime = 0;
        this.sleeping = false;
        this.sleepBoxes = null;
        this.sleepSupports = [];
        this.radius = Vlen(half) + Math.max(0, ...this.shapes.map(s => Vlen(s.offset || [0, 0, 0])));
        this.contacts = 0;
        this.ignore = new Set();
    }
    wake() { if (this.sleeping) {
        this.sleeping = false;
        this.sleepTime = 0;
        this.sleepBoxes = null;
        this.sleepSupports = [];
    } }
    axes(): Axes { return rotationAxes(this.q); }
    point(p: Vector) { return Vadd(this.p, Qrotate(this.q, p)); }
    local(p: Vector) { return QinverseRotate(this.q, Vsub(p, this.p)); }
    pointVelocity(p: Vector) { return Vadd(this.v, Vcross(this.w, Vsub(p, this.p))); }
    inertia(v: Vector): Vec {
        // R * I^-1 * R^T is fixed throughout the contact iterations for this pose.
        const q = this.q, i = this.invI, c = this.inertiaCache;
        if (!c || q.some((v, k) => v !== c.q[k]!) || i.some((v, k) => v !== c.i[k]!)) {
            const a = this.axes(), m = [];
            for (let r = 0; r < 3; r++)
                for (let s = 0; s < 3; s++)
                    m.push(a[0]![r]! * i[0]! * a[0]![s]! + a[1]![r]! * i[1]! * a[1]![s]! + a[2]![r]! * i[2]! * a[2]![s]!);
            this.inertiaCache = { q: [...q], i: [...i], m };
        }
        const m = this.inertiaCache!.m;
        return [m[0]! * v[0]! + m[1]! * v[1]! + m[2]! * v[2]!, m[3]! * v[0]! + m[4]! * v[1]! + m[5]! * v[2]!, m[6]! * v[0]! + m[7]! * v[1]! + m[8]! * v[2]!];
    }
    impulse(j: Vector, p: Vector = this.p) { if (!this.invMass)
        return; if (this.sleeping && Vlen(j) > .0001)
        this.wake(); this.v = Vadd(this.v, Vscale(j, this.invMass)); this.w = Vadd(this.w, this.inertia(Vcross(Vsub(p, this.p), j))); }
    applyForce(f: Vector, p: Vector = this.p) { if (this.sleeping && Vlen(f) > .0001)
        this.wake(); this.force = Vadd(this.force, f); this.torque = Vadd(this.torque, Vcross(Vsub(p, this.p), f)); }
    applyTorque(t: Vector) { if (this.sleeping && Vlen(t) > .0001)
        this.wake(); this.torque = Vadd(this.torque, t); }
    boxes(): SolidBox[] { const axes = this.axes(); return this.shapes.map(s => { const shapeAxes = s.q ? rotationAxes(Qmul(this.q, s.q)) : axes; return withBoxBounds({ body: this, p: this.point(s.offset || [0, 0, 0]), axes: shapeAxes, half: s.half, tag: s.tag || this.tag, structureNode: s.structureNode, structureBeam: s.structureBeam }); }); }
}
const solidBoxes = SolidBody.prototype.boxes;
const solidAxes = SolidBody.prototype.axes,solidPoint = SolidBody.prototype.point;
interface QueryShapeCause {
    source: SolidShape;half: Vector;offset: Vector | undefined;q: Vector | undefined;
    halfValues: Vector;offsetValues: Vector | undefined;qValues: Vector | undefined;
    tag: string | undefined;structureNode: number | undefined;structureBeam: number | undefined;
}
interface QueryBoxEntry {
    p: Vec;q: Quaternion;half: Vec;tag: string;sources: SolidShape[];shapes: QueryShapeCause[];boxes: SolidBox[];
}
const same3 = (a: Vector, b: Vector) => a[0] === b[0] && a[1] === b[1] && a[2] === b[2];
const same4 = (a: Vector, b: Vector) => same3(a,b) && a[3] === b[3];
function solidSupport(box: Geometry, n: Vector): Vec { let p = [...box.p] as Vec; for (let i = 0; i < 3; i++) {
    const d = Vdot(box.axes[i]!, n);
    if (Math.abs(d) > 1e-8)
        p = Vadd(p, Vscale(box.axes[i]!, box.half[i]! * Math.sign(d)));
} return p; }
function solidVertices(box: Geometry): Vec[] { const out: Vec[] = []; for (let x of [-1, 1])
    for (let y of [-1, 1])
        for (let z of [-1, 1])
            out.push(Vadd(box.p, Vadd(Vscale(box.axes[0]!, x * box.half[0]!), Vadd(Vscale(box.axes[1]!, y * box.half[1]!), Vscale(box.axes[2]!, z * box.half[2]!))))); return out; }
export function solidInside(p: Vector, box: Geometry, margin = .015) { const d = Vsub(p, box.p); return box.axes.every((a, i) => Math.abs(Vdot(d, a)) <= box.half[i]! + margin); }
export function intersectBoxes3(a: Geometry, b: Geometry, margin = .006): {
    n: Vec;
    depth: number;
    points: Vec[];
} | null {
    if (!boxBoundsOverlap(a, b, margin))
        return null;
    const d = Vsub(a.p, b.p);
    let depth = Infinity, n = null;
    const axes = [...a.axes, ...b.axes];
    for (const x of a.axes)
        for (const y of b.axes) {
            const c = Vcross(x, y);
            if (Vdot(c, c) > 1e-9)
                axes.push(Vunit(c));
        }
    for (const axis of axes) {
        const ra = a.axes.reduce((s, v, i) => s + Math.abs(Vdot(v, axis)) * a.half[i]!, 0), rb = b.axes.reduce((s, v, i) => s + Math.abs(Vdot(v, axis)) * b.half[i]!, 0), distance = Vdot(d, axis), overlap = ra + rb - Math.abs(distance);
        if (overlap < -margin)
            return null;
        if (overlap < depth) {
            depth = overlap;
            n = Vscale(axis, distance < 0 ? -1 : 1);
        }
    }
    if (!n)
        return null;
    const faceA = Vdot(solidSupport(a, Vscale(n, -1)), n), faceB = Vdot(solidSupport(b, n), n), mid = (faceA + faceB) / 2;
    const vertices = [...solidVertices(a).filter(p => solidInside(p, b, margin + .005)), ...solidVertices(b).filter(p => solidInside(p, a, margin + .005))];
    let pts = vertices.map(p => Vadd(p, Vscale(n, mid - Vdot(p, n))));
    pts = pts.filter((p, i) => !pts.slice(0, i).some(q => Vlen(Vsub(p, q)) < .08));
    if (!pts.length)
        pts = [Vscale(Vadd(solidSupport(a, Vscale(n, -1)), solidSupport(b, n)), .5)];
    if (pts.length > 4) {
        let chosen = [pts[0]!];
        while (chosen.length < 4) {
            let best = pts.filter(p => !chosen.includes(p)).sort((p, q) => Math.min(...chosen.map(c => Vlen(Vsub(q, c)))) - Math.min(...chosen.map(c => Vlen(Vsub(p, c)))))[0]!;
            chosen.push(best);
        }
        pts = chosen;
    }
    return { n, depth, points: pts };
}
function pruneDynamicContactManifolds(contacts: SolidContact[], policies: SolidPolicies): SolidContact[] {
    const out: SolidContact[] = [], groups = new Map<string, SolidContact[]>();
    for (const c of contacts) {
        if (!c.b) {
            out.push(c);
            continue;
        }
        const lo = Math.min(c.a.id, c.b.id), hi = Math.max(c.a.id, c.b.id), key = lo + ':' + hi;
        let list = groups.get(key);
        if (!list) {
            list = [];
            groups.set(key, list);
        }
        list.push(c);
    }
    for (const list of groups.values()) {
        list.sort((a, b) => b.depth - a.depth || b.approach - a.approach);
        // Compound wrecks can generate many proxy overlaps with contradictory SAT normals.
        // Solve one coherent normal cluster; if two strong clusters oppose each other, the
        // compound shapes are geometrically interlocked and need one depenetration manifold.
        const clusters: {
            n: Vec;
            items: SolidContact[];
            score: number;
        }[] = [];
        for (const c of list) {
            let cluster = clusters.find(x => Vdot(x.n, c.n) > .72);
            if (!cluster) {
                cluster = { n: c.n, items: [], score: 0 };
                clusters.push(cluster);
            }
            cluster.items.push(c);
            cluster.score += Math.max(.001, c.depth) + Math.max(0, c.approach) * .002;
        }
        clusters.sort((a, b) => b.score - a.score);
        const first = list[0]!, pair = !!first.b && policies.escapeAmbiguous?.(first.a, first.b), ambiguous = pair && clusters.length > 1 && clusters[1]!.score > clusters[0]!.score * .18;
        if (ambiguous) {
            const c = clusters[0]!.items[0]!;
            c.escapeManifold = true;
            out.push(c);
            continue;
        }
        const candidates = clusters[0]!?.items || list, chosen: SolidContact[] = [];
        for (const c of candidates) {
            if (chosen.length >= 4)
                break;
            if (chosen.some(q => Vlen(Vsub(q.p, c.p)) < .14))
                continue;
            chosen.push(c);
        }
        out.push(...chosen);
    }
    return out;
}
export function rayBox3(origin: Vector, dir: Vector, box: Geometry & {
    body?: SolidBody;
    tag?: string;
}, maxDistance: number): SolidRayHit | null {
    const px = box.p[0]!, py = box.p[1]!, pz = box.p[2]!, ox = origin[0]! - px, oy = origin[1]! - py, oz = origin[2]! - pz;
    let lo = 0, hi = maxDistance, nx = 0, ny = 0, nz = 0, hasN = false;
    for (let i = 0; i < 3; i++) {
        const axis = box.axes[i]!, ax = axis[0]!, ay = axis[1]!, az = axis[2]!, o = ox * ax + oy * ay + oz * az, d = dir[0]! * ax + dir[1]! * ay + dir[2]! * az, h = box.half[i]!;
        if (Math.abs(d) < 1e-9) {
            if (Math.abs(o) > h)
                return null;
            continue;
        }
        let a = (-h - o) / d, b = (h - o) / d, sx = -ax, sy = -ay, sz = -az;
        if (a > b) {
            const t = a;
            a = b;
            b = t;
            sx = ax;
            sy = ay;
            sz = az;
        }
        if (a > lo) {
            lo = a;
            nx = sx;
            ny = sy;
            nz = sz;
            hasN = true;
        }
        hi = Math.min(hi, b);
        if (lo > hi)
            return null;
    }
    if (!hasN || lo < 0 || lo > maxDistance)
        return null;
    return { t: lo, n: [nx, ny, nz], p: [origin[0]! + dir[0]! * lo, origin[1]! + dir[1]! * lo, origin[2]! + dir[2]! * lo], body: box.body, tag: box.tag };
}
type CandidateState = {depth: number; slots: {near: (SolidBody | SolidPlane)[]; out: (SolidBody | SolidPlane)[]}[]};
// Static-only Object.create(world) views need scratch owned by the exact receiver.
const candidateStates = new WeakMap<object, CandidateState>();
export class SolidWorld {
    readonly backend = COMPOUND_PHYSICS_BACKEND;
    gravity: Vector;
    iterations: number;
    bodies: SolidBody[];
    statics:SolidBody[];planes:SolidPlane[];globalPlanes:SolidPlane[];
    private staticGroups:StaticGroupStorage<SolidBody|SolidPlane>|undefined;private currentStaticGroup:StaticCollisionGroup|undefined;
    staticIndex: SpatialHash<SolidBody | SolidPlane>;
    contacts: SolidContact[];
    joints: SolidJoint[];
    events: SolidImpact[];
    metrics: {
        steps: number;
        contacts: number;
        maxPenetration: number;
        ceilingContacts: number;
        substeps: number;
        bodySubsteps?: number;
        islands?: number;
    };
    beforeSubstep: ((dt: number, members: Set<SolidBody>) => void) | null;
    groundFilter: ((p: Vector) => boolean) | null;
    declare terrainContacts?: ((body: SolidBody, boxes: SolidBox[], dt: number) => void);
    private candidateState(): CandidateState {
        let state = candidateStates.get(this);
        if (!state) { state = {depth: 0, slots: []}; candidateStates.set(this, state); }
        return state;
    }

    private readonly rayBoxCache = new WeakMap<SolidBody,QueryBoxEntry>();
    readonly policies: SolidPolicies;
    /** Legacy worlds keep own mutable arrays. Only explicit grouped worlds use
     * lazy ordinary ordered snapshots; internal physics never reads those. */
    enableStaticGroups():void{if(this.staticGroups)return;const storage=new StaticGroupStorage<SolidBody|SolidPlane>(this.statics,this.planes,this.globalPlanes);this.staticIndex.enableGroups();this.staticGroups=storage;Object.defineProperties(this,{statics:{configurable:true,enumerable:true,get:()=>storage.snapshot('bodies')},planes:{configurable:true,enumerable:true,get:()=>storage.snapshot('planes')},globalPlanes:{configurable:true,enumerable:true,get:()=>storage.snapshot('globals')}});}
    createStaticGroup():StaticCollisionGroup{this.enableStaticGroups();return this.staticGroups!.create();}
    get staticGroup():StaticCollisionGroup|undefined{return this.currentStaticGroup;}
    inspectStaticGroups(){return this.staticGroups?.inspect()??null;}
    staticGroupOf(body:SolidBody|SolidPlane){return this.staticGroups?.groupOf(body);}
    withStaticGroup<T>(group:StaticCollisionGroup|undefined,run:()=>T):T{if(group&&(!this.staticGroups?.owns(group)||!group.active))throw Error('Static group is inactive or belongs to another world');const previous=this.currentStaticGroup;this.currentStaticGroup=group;try{return run();}finally{this.currentStaticGroup=previous;}}
    retireStaticGroup(group:StaticCollisionGroup):void{if(!this.staticGroups)throw Error('Static grouping is not enabled');if(this.staticGroups.deactivate(group))this.staticIndex.invalidateGroup();}
    cleanupStaticGroup(group:StaticCollisionGroup,maxOperations=32):{done:boolean;operations:number}{if(!Number.isSafeInteger(maxOperations)||maxOperations<1||maxOperations>4096)throw RangeError('Invalid static cleanup budget');if(!this.staticGroups)throw Error('Static grouping is not enabled');this.staticIndex.beginBatch();try{return this.staticGroups.cleanup(group,maxOperations,item=>this.staticIndex.removeReference(item));}finally{this.staticIndex.endBatch();}}
    /** Remove known static ownership without materializing public snapshots. */
    removeStatics(items:Iterable<SolidBody|SolidPlane>):void{if(this.staticGroups){for(const item of items){this.staticGroups.remove(item);this.staticIndex.remove(item);}return;}const removed=new Set(items);this.statics=this.statics.filter(item=>!removed.has(item));let hasPlane=false;for(const item of removed)if(item.plane){hasPlane=true;break;}if(hasPlane){this.planes=this.planes.filter(item=>!removed.has(item));this.globalPlanes=this.globalPlanes.filter(item=>!removed.has(item));}for(const item of removed)this.staticIndex.remove(item);}
    constructor({ gravity = [0, -9.81, 0], iterations = 10, policies = {} }: SolidWorldOptions = {}) { this.gravity = gravity; this.iterations = iterations; this.policies = policies; this.bodies = []; this.statics = []; this.planes = []; this.globalPlanes = []; this.staticIndex = new SpatialHash(STATIC_COLLISION_CELL_SIZE, { cellOrder: true }); this.contacts = []; this.joints = []; this.events = []; this.metrics = { steps: 0, contacts: 0, maxPenetration: 0, ceilingContacts: 0, substeps: 0 }; this.beforeSubstep = null; this.groundFilter = null; }
    add<T extends SolidBody>(body: T): T { body.removed = false; if (body.invMass)
        this.bodies.push(body);
    else {
        if(this.staticGroups)this.staticGroups.add(body,false,false,this.currentStaticGroup);else this.statics.push(body);
        body.cachedBoxes = body.boxes();
        body.indexRadius = staticQueryRadius(body.p, body.cachedBoxes);
        body.x = body.p[0]!;
        body.z = body.p[2]!;
        this.staticIndex.add(body, body.indexRadius,this.currentStaticGroup);
    } return body; }
    remove(body: SolidBody) { body.removed = true; this.bodies = this.bodies.filter(b => b !== body); this.joints = this.joints.filter(j => j.a !== body && j.b !== body); }
    addPlane({ p, n = [0, 1, 0], u = [1, 0, 0], v = [0, 0, 1], hu = 1, hv = 1, tag = 'road', filter = null }: SolidPlaneOptions): SolidPlane { const plane: SolidPlane = { id: solidId++, plane: true, p, n: Vunit(n), u: Vunit(u), v: Vunit(v), hu, hv, tag, filter, x: p[0]!, z: p[2]!, radius: Math.hypot(hu, hv), body: null };if(this.staticGroups)this.staticGroups.add(plane,true,plane.radius>256,this.currentStaticGroup);else this.planes.push(plane); if (plane.radius > 256){
        if(!this.staticGroups)this.globalPlanes.push(plane);}
    else
        this.staticIndex.add(plane, plane.radius,this.currentStaticGroup); return plane; }
    joint(a: SolidBody, b: SolidBody, anchorA: Vector, anchorB: Vector) { const j: SolidJoint = { a, b, anchorA, anchorB }; a.ignore.add(b.id); b.ignore.add(a.id); this.joints.push(j); return j; }
    distanceJoint(a: SolidBody, b: SolidBody, length = Vlen(Vsub(a.p, b.p))) { const j: SolidJoint = { type: 'distance', a, b, length }; a.ignore.add(b.id); b.ignore.add(a.id); this.joints.push(j); return j; }
    rangeJoint(a: SolidBody, b: SolidBody, min: number, max: number) { if (!Number.isFinite(min) || !Number.isFinite(max) || min < 0 || max < min) throw new RangeError('Invalid joint range'); const j: SolidJoint = {type: 'range', a, b, min, max}; this.joints.push(j); return j; }
    candidates(p: Vector, r: number, orderRadius = r): (SolidBody | SolidPlane)[] {
        const candidateState = this.candidateState(), depth = candidateState.depth;
        let slot = candidateState.slots[depth];
        if (!slot) {
            slot = {near: [], out: []};
            if (depth < 8) candidateState.slots[depth] = slot;
        }
        candidateState.depth = depth + 1;
        try {
        const scratch = slot.near;
        const near = typeof this.staticIndex.nearOwned === 'function'
            ? this.staticIndex.nearOwned(p[0]!, p[2]!, r, scratch, orderRadius)
            : this.staticIndex.near(p[0]!, p[2]!, r, scratch, orderRadius);
        const out = slot.out;
        out.length = 0;
        for (const plane of this.staticGroups?this.staticGroups.globalValues():this.globalPlanes)
            if (plane.enabled !== false)
                out.push(plane);
        for (let i = 0; i < near.length; i++) {
            const body = near[i]!;
            if (body.enabled !== false)
                out.push(body);
        }
        return out;
        } finally { candidateState.depth = depth; }
    }
    overlapsBox(p: Vector, half: Vector, ignore: SolidBody | null = null, filter?: ((body: SolidBody) => boolean) | null) {
        const box = { p, half, axes: [[1, 0, 0], [0, 1, 0], [0, 0, 1]] }, radius = Vlen(half), candidates = this.candidates(p, radius);
        const candidateState = this.candidateState(), candidateDepth = candidateState.depth;
        candidateState.depth = candidateDepth + 1;
        try {
        for (let i = 0; i < candidates.length; i++) {
            const b = candidates[i]!;
            if (b.plane || !b.enabled || b === ignore || filter && !filter(b))
                continue;
            const dx = b.p[0]! - p[0]!, dy = b.p[1]! - p[1]!, dz = b.p[2]! - p[2]!;
            if (dx * dx + dy * dy + dz * dz >= (b.radius + radius) * (b.radius + radius))
                continue;
            if ((b.cachedBoxes || b.boxes()).some(other => boxesPenetrate(box, other, .012)))
                return true;
        }
        } finally { candidateState.depth = candidateDepth; }
        for (const b of this.bodies) {
            if (b.plane || !b.enabled || b === ignore || filter && !filter(b))
                continue;
            const dx = b.p[0]! - p[0]!, dy = b.p[1]! - p[1]!, dz = b.p[2]! - p[2]!;
            if (dx * dx + dy * dy + dz * dz >= (b.radius + radius) * (b.radius + radius))
                continue;
            if ((b.cachedBoxes || b.boxes()).some(other => boxesPenetrate(box, other, .012)))
                return true;
        }
        return false;
    }
    private rayBoxes(body: SolidBody): SolidBox[] {
        // Public boxes() calls still return fresh geometry, and custom builders
        // have no declared cause contract. Cache only the Engine's pure builder.
        if (body.boxes !== solidBoxes || body.axes !== solidAxes || body.point !== solidPoint) return body.boxes();
        const cached = this.rayBoxCache.get(body);
        let valid = !!cached && cached.tag === body.tag && cached.sources === body.shapes && cached.shapes.length === body.shapes.length && same3(cached.p,body.p) && same4(cached.q,body.q) && same3(cached.half,body.half);
        if (valid) for (let i=0;i<body.shapes.length;i++) {
            const shape=body.shapes[i]!,old=cached!.shapes[i]!;
            if (old.source !== shape || old.half !== shape.half || old.offset !== shape.offset || old.q !== shape.q || old.tag !== shape.tag || old.structureNode !== shape.structureNode || old.structureBeam !== shape.structureBeam || !same3(old.halfValues,shape.half) || (shape.offset && !same3(old.offsetValues!,shape.offset)) || (shape.q && !same4(old.qValues!,shape.q))) {valid=false;break;}
        }
        if (valid) return cached!.boxes;
        const boxes=body.boxes();
        this.rayBoxCache.set(body,{p:[...body.p],q:[...body.q],half:[...body.half],tag:body.tag,sources:body.shapes,boxes,shapes:body.shapes.map(shape=>({source:shape,half:shape.half,offset:shape.offset,q:shape.q,halfValues:[...shape.half],offsetValues:shape.offset?[...shape.offset]:undefined,qValues:shape.q?[...shape.q]:undefined,tag:shape.tag,structureNode:shape.structureNode,structureBeam:shape.structureBeam}))});
        return boxes;
    }
    ray(origin: Vector, dir: Vector, maxDistance: number, ignore: SolidBody | null = null, filter?: ((body: SolidBody) => boolean) | null): SolidRayHit | null {
        let best: SolidRayHit | null = null;
        const mx = origin[0]! + dir[0]! * maxDistance * .5, my = origin[1]! + dir[1]! * maxDistance * .5, mz = origin[2]! + dir[2]! * maxDistance * .5;
        // The broad phase is X/Z. Vertical distance must not expand a roof/floor
        // query across half the city. Retain the old enclosing query's order so
        // equal-distance planes/boxes still select the same surface and tag.
        const enclosingRadius = maxDistance * .5 + 1;
        const horizontalRadius = Math.min(enclosingRadius, Math.hypot(dir[0]!, dir[2]!) * maxDistance * .5 + 1);
        const candidates = this.candidates([mx, my, mz], horizontalRadius, enclosingRadius);
        const candidateState = this.candidateState(), candidateDepth = candidateState.depth;
        candidateState.depth = candidateDepth + 1;
        try {
        for (let i = 0; i < candidates.length; i++) {
            const item = candidates[i]!;
            if (item === ignore || !item.plane && filter && !filter(item)) continue;
            if (item.plane) {
                const dn = Vdot(dir, item.n);
                if (dn >= -1e-8)
                    continue;
                const ox = item.p[0]! - origin[0]!, oy = item.p[1]! - origin[1]!, oz = item.p[2]! - origin[2]!;
                const t = (ox * item.n[0]! + oy * item.n[1]! + oz * item.n[2]!) / dn;
                if (t < 0 || t > maxDistance || best && t >= best.t)
                    continue;
                // Preserve vector operation order and public per-candidate reads,
                // but only allocate a point once finite bounds admit a callback/hit.
                const sx = dir[0]! * t, sy = dir[1]! * t, sz = dir[2]! * t;
                const px = origin[0]! + sx, py = origin[1]! + sy, pz = origin[2]! + sz;
                const dx = px - item.p[0]!, dy = py - item.p[1]!, dz = pz - item.p[2]!;
                if (Math.abs(dx * item.u[0]! + dy * item.u[1]! + dz * item.u[2]!) > item.hu + .001 || Math.abs(dx * item.v[0]! + dy * item.v[1]! + dz * item.v[2]!) > item.hv + .001)
                    continue;
                const p: Vec = [px, py, pz];
                if (item.filter && !item.filter(p))
                    continue;
                best = { t, p, n: item.n, body: null, tag: item.tag, plane: item };
            }
            else if (Math.abs(origin[1]! - item.p[1]!) < maxDistance + item.radius) {
                for (const box of item.cachedBoxes || item.boxes()) {
                    const hit = rayBox3(origin, dir, box, best ? best.t : maxDistance);
                    if (hit && (!best || hit.t < best.t))
                        best = hit;
                }
            }
        }
        } finally { candidateState.depth = candidateDepth; }
        const maxR = maxDistance;
        for (const body of this.bodies) {
            if (body === ignore || !body.enabled || filter && !filter(body) || ignore?.ignore.has(body.id) || this.policies.rayBody?.(body, ignore) === false)
                continue;
            const dx = body.p[0]! - origin[0]!, dy = body.p[1]! - origin[1]!, dz = body.p[2]! - origin[2]!;
            if (dx * dx + dy * dy + dz * dz > (maxR + body.radius) * (maxR + body.radius))
                continue;
            for (const box of body.cachedBoxes || this.rayBoxes(body)) {
                const hit = rayBox3(origin, dir, box, best ? best.t : maxDistance);
                if (hit && (!best || hit.t < best.t))
                    best = hit;
            }
        }
        return best;
    }
    contactsForPlane(a: SolidBody, box: SolidBox, plane: SolidPlane, h: number) {
        const d = Vdot(Vsub(box.p, plane.p), plane.n), ra = box.axes.reduce((s, x, i) => s + Math.abs(Vdot(x, plane.n)) * box.half[i]!, 0);
        if (d - ra > .018 || d + ra < -.10)
            return;
        for (const p of solidVertices(box)) {
            const rel = Vsub(p, plane.p), depth = -Vdot(rel, plane.n);
            if (depth < -.012 || depth > 2.5)
                continue;
            const cp = Vadd(p, Vscale(plane.n, depth));
            const delta = Vsub(cp, plane.p);
            if (Math.abs(Vdot(delta, plane.u)) > plane.hu + .015 || Math.abs(Vdot(delta, plane.v)) > plane.hv + .015 || plane.filter && !plane.filter(cp))
                continue;
            this.addContact(a, null, cp, plane.n, depth, plane.tag, h);
        }
    }
    addContact(a: SolidBody, b: SolidBody | null, p: Vec, n: Vec, depth: number, tag: string, h: number) {
        const va = a.pointVelocity(p), vb = b ? b.pointVelocity(p) : [0, 0, 0], vn = Vdot(Vsub(va, vb), n);
        const bounce = vn < -2 ? -vn * Math.min(a.restitution, b?.restitution ?? .08) : 0;
        const rawMu = Math.sqrt(a.friction * (b?.friction ?? .72)), limit = b ? this.policies.frictionLimit?.(a, b) : undefined, mu = limit === undefined ? rawMu : Math.min(rawMu, limit);
        // Static buildings/pillars need stronger Baumgarte than vehicle pairs — thin facade
        // slabs otherwise swallow a broadside at 60 Hz and the car sits inside the wall.
        const staticHit = !b, bias = staticHit ? (depth > .12 ? .48 : .28) : .15;
        let target = Math.max(bounce, Math.max(depth - .008, 0) * bias / h);
        if (staticHit && depth > .20)
            target = Math.max(target, depth * .62 / h);
        this.contacts.push({ a, b, p, n, depth, tag, kn: this.effective(a, b, p, n), jn: 0, jt: [0, 0, 0], target, mu, approach: -vn });
    }
    effective(a: SolidBody, b: SolidBody | null, p: Vector, n: Vector) { const ra = Vsub(p, a.p), rb = b ? Vsub(p, b.p) : [0, 0, 0]; return a.invMass + (b?.invMass || 0) + Vdot(n, Vcross(a.inertia(Vcross(ra, n)), ra)) + (b ? Vdot(n, Vcross(b.inertia(Vcross(rb, n)), rb)) : 0); }
    solveContact(c: SolidContact) {
        const { a, b, p, n } = c, rv = Vsub(a.pointVelocity(p), b ? b.pointVelocity(p) : [0, 0, 0]);
        const k = c.kn;
        if (k < 1e-12)
            return;
        const old = c.jn;
        c.jn = Math.max(0, old + (c.target - Vdot(rv, n)) / k);
        const j = Vscale(n, c.jn - old);
        a.impulse(j, p);
        if (b)
            b.impulse(Vscale(j, -1), p);
        const vel = Vsub(a.pointVelocity(p), b ? b.pointVelocity(p) : [0, 0, 0]), t = Vsub(vel, Vscale(n, Vdot(vel, n))), speed = Vlen(t);
        if (speed > .0001) {
            const direction = Vscale(t, 1 / speed), kt = this.effective(a, b, p, direction), wanted = Vsub(c.jt, Vscale(direction, speed / kt)), length = Vlen(wanted), limit = c.mu * c.jn, next = length > limit ? Vscale(wanted, limit / length) : wanted, jt = Vsub(next, c.jt);
            c.jt = next;
            a.impulse(jt, p);
            if (b)
                b.impulse(Vscale(jt, -1), p);
        }
    }
    solveJoint(j: SolidJoint, h: number) { if (j.type === 'distance' || j.type === 'range') {
        const { a, b } = j, d = Vsub(a.p, b.p), len = Vlen(d), n = Vscale(d, 1 / Math.max(len, 1e-8)), rv = Vdot(Vsub(a.v, b.v), n), k = a.invMass + b.invMass;
        if (k <= 0) return;
        const target = j.type === 'range' ? clamp(len, j.min, j.max) : j.length;
        const force = j.type === 'range' && len === target ? 0 : -(rv + (len - target) * .22 / h) / k, J = Vscale(n, clamp(force, -300, 300));
        a.impulse(J);
        b.impulse(Vscale(J, -1));
        return;
    } const { a, b } = j, pa = a.point(j.anchorA), pb = b.point(j.anchorB), error = Vsub(pa, pb); for (const n of [[1, 0, 0], [0, 1, 0], [0, 0, 1]]) {
        const rv = Vdot(Vsub(a.pointVelocity(pa), b.pointVelocity(pb)), n), k = this.effective(a, b, Vscale(Vadd(pa, pb), .5), n), imp = clamp(-(rv + Vdot(error, n) * .15 / h) / Math.max(k, 1e-8), -200, 200), J = Vscale(n, imp);
        a.impulse(J, pa);
        b.impulse(Vscale(J, -1), pb);
    } }
    step(dt: number): SolidImpact[] {
        if (!(dt > 0 && dt <= 1 / 30))
            throw Error('SolidWorld requires dt <= 1/30 s.');
        for (const b of this.bodies)
            if (b.sleeping && (Vlen(b.v) > .05 || Vlen(b.w) > .04 || b.sleepSupports.some(s => !s.body.enabled || s.body.removed || Vlen(Vsub(s.body.p, s.p)) > .01 || Math.abs(s.body.q.reduce((sum, v, i) => sum + v * s.q[i]!, 0)) < .99995)))
                b.wake();
        const bodies = this.bodies.filter(b => b.enabled), parent = bodies.map((_, i) => i), index = new Map(bodies.map((b, i) => [b, i]));
        const root = (start: number) => { let i = start; while (parent[i]! !== i) {
            parent[i] = parent[parent[i]!]!;
            i = parent[i]!;
        } return i; }, join = (a: number, b: number) => { parent[root(a)] = root(b); };
        // Swept bounding spheres conservatively connect possible collisions and suspension supports.
        const reach = bodies.map(b => b.radius + Vlen(b.v) * dt + Vlen(b.force) * b.invMass * dt * dt + 1);
        for (let i = 0; i < bodies.length; i++)
            for (let j = i + 1; j < bodies.length; j++) {
                const a = bodies[i]!.p, b = bodies[j]!.p, r = reach[i]! + reach[j]!;
                if ((a[0]! - b[0]!) ** 2 + (a[1]! - b[1]!) ** 2 + (a[2]! - b[2]!) ** 2 <= r * r)
                    join(i, j);
            }
        for (const j of this.joints)
            if (index.has(j.a) && index.has(j.b))
                join(index.get(j.a)!, index.get(j.b)!);
        const groups = new Map<number, SolidBody[]>();
        for (let i = 0; i < bodies.length; i++) {
            const key = root(i);
            if (!groups.has(key))
                groups.set(key, []);
            groups.get(key)!.push(bodies[i]!);
        }
        this.events = [];
        const contacts: SolidContact[] = [];
        let maxSubsteps = 1, bodySubsteps = 0;
        for (const group of groups.values()) {
            if (group.every(b => b.sleeping))
                continue;
            const members = new Set(group), joints = this.joints.filter(j => members.has(j.a) && members.has(j.b));
            const count = this.stepIsland(dt, group, members, joints);
            maxSubsteps = Math.max(maxSubsteps, count);
            bodySubsteps += count * group.length;
            contacts.push(...this.contacts);
        }
        this.contacts = contacts;
        this.metrics.substeps += maxSubsteps;
        this.metrics.bodySubsteps = (this.metrics.bodySubsteps || 0) + bodySubsteps;
        this.metrics.islands = groups.size;
        this.metrics.steps++;
        return this.events;
    }
    stepIsland(dt: number, bodies: SolidBody[], members: Set<SolidBody>, joints: SolidJoint[]): number {
        const startPositions = new Map(bodies.filter(b => b.enabled && !b.sleeping).map(b => [b, [...b.p]]));
        const speed = Math.max(0, ...bodies.filter(b => b.enabled && !b.sleeping).map(b => Vlen(b.v))), substeps = Math.min(16, Math.max(1, Math.ceil(speed * dt / .14))), h = dt / substeps;
        for (let sub = 0; sub < substeps; sub++) {
            this.beforeSubstep?.(h, members);
            for (const a of bodies)
                if (a.enabled && !a.sleeping) {
                    a.v = Vadd(a.v, Vscale(Vadd(this.gravity, Vscale(a.force, a.invMass)), h));
                    a.w = Vadd(a.w, Vscale(a.inertia(a.torque), h));
                    a.w = Vscale(a.w, Math.exp(-.06 * h));
                    a.p = Vadd(a.p, Vscale(a.v, h));
                    const qd = Qmul([...a.w, 0], a.q);
                    a.q = Qunit(a.q.map((v, i) => v + qd[i]! * h * .5));
                    a.contacts = 0;
                    a.force = [0, 0, 0];
                    a.torque = [0, 0, 0];
                }
            this.contacts = [];
            const dynamic = bodies.filter(b => b.enabled), boxes = new Map(dynamic.map(a => [a, a.sleeping ? a.sleepBoxes! : a.boxes()]));
            for (let i = 0; i < dynamic.length; i++) {
                const a = dynamic[i]!;
                if (!a.sleeping) {
                    this.terrainContacts?.(a, boxes.get(a)!, h);
                    const candidates = this.candidates(a.p, a.radius + .2), candidateState = this.candidateState(), candidateDepth = candidateState.depth;
                    candidateState.depth = candidateDepth + 1;
                    try {
                    for (const item of candidates) {
                        if (item.plane) {
                            for (const box of boxes.get(a)!)
                                this.contactsForPlane(a, box, item, h);
                            continue;
                        }
                        const dx = a.p[0]! - item.p[0]!, dy = a.p[1]! - item.p[1]!, dz = a.p[2]! - item.p[2]!, radius = a.radius + item.radius + .02;
                        if (dx * dx + dy * dy + dz * dz > radius * radius)
                            continue;
                        for (const box of boxes.get(a)!)
                            for (const boxB of item.cachedBoxes || item.boxes()) {
                                const c = intersectBoxes3(box, boxB);
                                if (c)
                                    for (const p of c.points)
                                        this.addContact(a, null, p, c.n, c.depth, boxB.tag, h);
                            }
                    }
                    } finally { candidateState.depth = candidateDepth; }
                }
                for (let j = i + 1; j < dynamic.length; j++) {
                    const b = dynamic[j]!;
                    if (a.sleeping && b.sleeping)
                        continue;
                    if (a.ignore.has(b.id) || b.ignore.has(a.id) || Vlen(Vsub(a.p, b.p)) > a.radius + b.radius)
                        continue;
                    for (const box of boxes.get(a)!)
                        for (const boxB of boxes.get(b)!) {
                            const c = intersectBoxes3(box, boxB);
                            if (c)
                                for (const p of c.points)
                                    this.addContact(a, b, p, c.n, c.depth, b.tag, h);
                        }
                }
            }
            this.contacts = pruneDynamicContactManifolds(this.contacts, this.policies);
            for (const c of this.contacts)
                if (c.escapeManifold) {
                    c.n = Vunit(Vsub(c.a.p, c.b!.p));
                    c.kn = this.effective(c.a, c.b, c.p, c.n);
                    c.mu = 0;
                    c.target = Math.max(c.target, Math.max(c.depth - .004, 0) * .30 / h);
                }
            for (let iteration = 0; iteration < this.iterations; iteration++) {
                for (const c of this.contacts)
                    this.solveContact(c);
                for (const j of joints)
                    if (!j.a.sleeping || !j.b.sleeping)
                        this.solveJoint(j, h);
            }
            const pairEvents = new Map<string, SolidImpact>();
            for (const c of this.contacts) {
                c.a.contacts++;
                if (c.b)
                    c.b.contacts++;
                this.metrics.maxPenetration = Math.max(this.metrics.maxPenetration, c.depth);
                if (c.tag === 'ceiling')
                    this.metrics.ceilingContacts++;
                if (c.jn <= 0)
                    continue;
                const key = c.a.id + ':' + (c.b?.id || c.tag);
                const old = pairEvents.get(key);
                if (old) {
                    const sum = old.impulse + c.jn;
                    for (let axis = 0; axis < 3; axis++)
                        old.p[axis] = (old.p[axis]! * old.impulse + c.p[axis]! * c.jn) / sum;
                    old.impulse = sum;
                    old.approach = Math.max(old.approach, c.approach);
                }
                else
                    pairEvents.set(key, { a: c.a, b: c.b, p: [...c.p], n: c.n, impulse: c.jn, approach: c.approach, tag: c.tag });
            }
            this.events.push(...pairEvents.values());
            this.metrics.contacts += this.contacts.length;
            for (const a of dynamic)
                if (![...a.p, ...a.v, ...a.q, ...a.w].every(Number.isFinite))
                    throw Error('Non-finite physics state: ' + a.tag + ' #' + a.id);
        }
        for (const b of bodies) {
            if (!b.enabled || b.sleeping)
                continue;
            const driven = this.policies.active?.(b);
            // Contact bias can leave an upward velocity on a stationary body. Measure actual travel.
            const start = startPositions.get(b), quiet = start && Vlen(Vsub(b.p, start)) < .05 * dt && Vlen(b.w) < .04;
            if (!driven && (b.contacts > 0 || this.policies.supported?.(b)) && quiet)
                b.sleepTime += dt;
            else
                b.sleepTime = 0;
            if (b.sleepTime >= 1) {
                b.sleeping = true;
                b.v = [0, 0, 0];
                b.w = [0, 0, 0];
                b.force = [0, 0, 0];
                b.torque = [0, 0, 0];
                b.sleepBoxes = b.boxes();
                const supports = new Set([...this.contacts.flatMap(c => c.a === b && c.b ? [c.b] : c.b === b ? [c.a] : []), ...(this.policies.supports?.(b) ?? [])]);
                b.sleepSupports = [...supports].map(body => ({ body, p: [...body.p], q: [...body.q] }));
            }
        }
        return substeps;
    }
}
