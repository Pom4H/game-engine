import { boxBounds,boxBoundsOverlap, withBoxBounds, boxesPenetrate, staticQueryRadius, STATIC_COLLISION_CELL_SIZE } from './box-overlap.js';
// Full compound 6-DOF kernel promoted from TheGame's rigid solver.
// Original source SHA-256 E82B4281A744C7A0DF2405C79EEF829592F9A20A5E1509E833BBF85956D4836B.
// SI units, Y up. Convex boxes and finite planes; application policies are callbacks.
// Sequential impulses, angular inertia, Coulomb friction, speculative contacts and motion substeps.
import { SpatialHash } from '../core/spatial-hash.js';
import type {EngineTrace} from '../observability/trace.js';
import {StaticGroupStorage,type StaticCollisionGroup} from './static-groups.js';
import {castRoundedBox} from './rounded-query.js';
import {trianglePrism,prismSAT,prismManifold,prismInside,prismSupport,rayTrianglePrism,closestTrianglePoint,type TrianglePrism,type TrianglePrismAdjacency} from './triangle-prism.js';
import {OrderedShapeBoundsIndex} from './ordered-shape-bounds.js';
import {triangleAdaptiveMotion} from './prism-adaptive-motion.js';
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
// Relative quaternion arc is scale invariant in atan2 and treats q/-q as the
// same pose. The saved pose contains position followed by quaternion values.
function completedAngularTravel(q:Vector,pose:Vector){
    const a=pose[3]!,b=pose[4]!,c=pose[5]!,d=pose[6]!,x=d*q[0]!-a*q[3]!-b*q[2]!+c*q[1]!,y=d*q[1]!+a*q[2]!-b*q[3]!-c*q[0]!,z=d*q[2]!-a*q[1]!+b*q[0]!-c*q[3]!,w=d*q[3]!+a*q[0]!+b*q[1]!+c*q[2]!,s=Math.hypot(x,y,z);
    return s===0&&w===0?Infinity:2*Math.atan2(s,Math.abs(w));
}
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
    /** Actual body-local sheet surface. offset/half remain broad bounds only. */
    triangle?: readonly [Vector,Vector,Vector];
    thickness?: number;
    structureNodes?: readonly [number,number,number];
    /** Cold affine material maps for fine surface vertices. Replace this tuple
     * when its mapping changes; moving triangle coordinates remain independent. */
    structureBindings?:SolidTriangleBindings;
    /** Weld topology IDs are geometric vertices, not mass-chart node IDs. */
    geometryNodes?:readonly[number,number,number];
}
export interface SolidMaterialBinding {readonly nodes:readonly number[];readonly weights:readonly number[];}
export type SolidTriangleBindings=readonly[SolidMaterialBinding,SolidMaterialBinding,SolidMaterialBinding];
/** Optional nodal owner. While active the rigid integrator must not advance the same mass. */
export interface DeformableSolid {
    readonly structure?:import('./structure.js').StructuralBody;
    activate?():void;
    /** Optional phased solve: all graph predictions precede shared contact projection. */
    readonly solverIterations?:number;
    beginAdvance?(dt:number,gravity:Vector,deferReduction?:boolean):void;
    readonly reductionReady?:boolean;
    reduce?():void;
    projectAdvance?(iteration:number):void;
    endAdvance?():void;
    positionAnchor?(point:Vector):SolidPositionAnchor;
    /** One scalar material row with arbitrary vector gradients at fixed samples. */
    positionMaterialConstraint?(points:readonly Vector[],gradients:readonly Vector[]):SolidPositionMaterialConstraint;
    /** Bind a collision sample to a specific physical node carried by its shape. */
    bindContactPoint?(point:Vector,node:number):void;
    bindMaterialContact?(point:Vector,nodes:readonly number[],weights:readonly number[]):void;
    /** Refine thin released structures before they enter a static contact. */
    readonly refineStaticsBeforePrediction?:boolean;
    readonly maxInternalSpeed?:number;
    /** Bound penetration recovery separately from physical impact restitution. */
    readonly maxContactBiasSpeed?:number;
    /** Split position correction: move the owner without creating kinetic energy. */
    translate?(offset:Vector):void;
 readonly active:boolean;
 advance(dt:number,gravity:Vector):void;
 syncAfterContacts?():void;
 pointVelocity(point:Vector):Vec;
 pointVelocityInto?(point:Vector,out:Vec):void;
 pointVelocityAxis?(point:Vector,axis:number):number;
 inverseEffectiveMass(point:Vector,direction:Vector):number;
 /** Inverse response to equal/opposite point impulses, including shared nodes. */
 inverseCoupleMass?(positive:Vector,negative:Vector):number;
 impulse(impulse:Vector,point:Vector):void;
 force(force:Vector,point:Vector):void;
 torque(torque:Vector):void;
}
export interface SolidPositionAnchor {
    point(out:Vec):void;
    inverseMass(direction:Vector):number;
    displace(direction:Vector,lambda:number):void;
    /** Unilateral contact may retract finite rigid motion while bilateral
     * mounts retain their ordinary material displacement. Both owners must
     * receive the same scalar reaction, with opposite signs. */
    inverseContactMass?(direction:Vector):number;
    displaceContact?(direction:Vector,lambda:number):void;
}
export interface SolidPositionMaterialConstraint {
    inverseMass():number;
    velocityInverseMass?():number;
    displace(lambda:number):void;
    available?():boolean;
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
    triangle?:TrianglePrism|null;
    structureNodes?:readonly [number,number,number];
    structureBindings?:SolidTriangleBindings;
    geometryNodes?:readonly[number,number,number];
    triangleAdjacency?:TrianglePrismAdjacency;
}
type Geometry = import('./box-overlap.js').OrientedBox & {triangle?:TrianglePrism|null;triangleAdjacency?:TrianglePrismAdjacency};
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
    nodeA?:number;nodeB?:number;
    materialA?:SolidMaterialContact;materialB?:SolidMaterialContact;
    projected?:boolean;
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
export interface SolidMaterialContact {nodes:readonly number[];weights:readonly number[];geometryNodes?:readonly[number,number,number];}
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
    type:'constraint';
    a:SolidBody;
    b:SolidBody;
    constraint:SolidConstraint;
} | {
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
/** A bounded application-independent constraint solved with rigid contacts. */
export interface SolidConstraint {beginStep?(dt:number):void;solve(dt:number):void;endStep?(dt:number):void;readonly broken?:boolean;readonly enabled?:boolean;readonly positionProjection?:boolean;projectPosition?(dt:number,iteration:number):void;}
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
    onRemoved?:()=>void;
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
    private localInverseInertiaTensor?: readonly number[];
    private localInertiaTensor?: readonly number[];
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
    deformable?:DeformableSolid;
    /** Optional bound on numerical penetration recovery, independent of physical
     * approach/restitution. Thin articulated parts can share their owner's bound. */
    maxContactBiasSpeed?:number;
    contactRefinement?: (point:Vector,normal:Vector,approach:number,dt:number)=>void;
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
    pointVelocity(p: Vector):Vec { if(this.deformable?.active)return this.deformable.pointVelocity(p);const x=p[0]!-this.p[0],y=p[1]!-this.p[1],z=p[2]!-this.p[2],w=this.w;return [this.v[0]+(w[1]*z-w[2]*y),this.v[1]+(w[2]*x-w[0]*z),this.v[2]+(w[0]*y-w[1]*x)]; }
    pointVelocityInto(p:Vector,out:Vec):void {
        if(this.deformable?.active){if(this.deformable.pointVelocityInto)this.deformable.pointVelocityInto(p,out);else{const v=this.deformable.pointVelocity(p);out[0]=v[0];out[1]=v[1];out[2]=v[2];}return;}
        const x=p[0]!-this.p[0],y=p[1]!-this.p[1],z=p[2]!-this.p[2],w=this.w;out[0]=this.v[0]+(w[1]*z-w[2]*y);out[1]=this.v[1]+(w[2]*x-w[0]*z);out[2]=this.v[2]+(w[0]*y-w[1]*x);
    }
    pointVelocityAxis(p:Vector,axis:number):number {
        if(this.deformable?.active)return this.deformable.pointVelocityAxis?.(p,axis)??this.deformable.pointVelocity(p)[axis]!;
        const a=(axis+1)%3,b=(axis+2)%3;return this.v[axis]!+(this.w[a]!*(p[b]!-this.p[b]!)-this.w[b]!*(p[a]!-this.p[a]!));
    }
    /** Optional full row-major inverse tensor about this body's mass centre,
     * expressed in its local frame. Deformed mass distributions need the
     * products of inertia as well as the three diagonal terms. Own the input;
     * callers use this setter again after a mass/shape change. While installed,
     * it owns angular response; invI exposes its diagonal for compatibility.
     * Undefined restores the existing diagonal invI contract. */
    setInverseInertiaTensor(tensor:readonly number[]|undefined):void {
        if(tensor===undefined){delete this.localInverseInertiaTensor;delete this.localInertiaTensor;delete this.inertiaCache;return;}
        if(!this.invMass||tensor.length!==9||!tensor.every(Number.isFinite))throw new RangeError('Invalid inverse inertia tensor for a dynamic body');
        const m=[...tensor],scale=Math.max(...m.map(Math.abs));
        if(!(scale>0))throw new RangeError('Inverse inertia tensor must be positive definite');
        for(const [a,b]of [[1,3],[2,6],[5,7]] as const){if(Math.abs(m[a]!-m[b]!)>scale*1e-10)throw new RangeError('Inverse inertia tensor must be symmetric');m[a]=m[b]=m[a]!*.5+m[b]!*.5;}
        const l00=Math.sqrt(m[0]!/scale),l10=m[3]!/scale/l00,l20=m[6]!/scale/l00,l11=Math.sqrt(m[4]!/scale-l10*l10),l21=(m[7]!/scale-l20*l10)/l11,l22=Math.sqrt(m[8]!/scale-l20*l20-l21*l21);
        if(![l00,l11,l22].every(n=>Number.isFinite(n)&&n>0))throw new RangeError('Inverse inertia tensor must be positive definite');
        const forward=Array<number>(9).fill(0);
        for(let axis=0;axis<3;axis++){
            const y0=(axis===0?1:0)/l00,y1=((axis===1?1:0)-l10*y0)/l11,y2=((axis===2?1:0)-l20*y0-l21*y1)/l22,x2=y2/l22,x1=(y1-l21*x2)/l11,x0=(y0-l10*x1-l20*x2)/l00;
            forward[axis]=x0/scale;forward[3+axis]=x1/scale;forward[6+axis]=x2/scale;
        }
        if(!forward.every(Number.isFinite))throw new RangeError('Inertia tensor exceeds the finite range');
        this.localInverseInertiaTensor=Object.freeze(m);this.localInertiaTensor=Object.freeze(forward);this.invI=[m[0]!,m[4]!,m[8]!];delete this.inertiaCache;
    }
    get inverseInertiaTensor():readonly number[]|undefined{return this.localInverseInertiaTensor;}
    /** Conservative spectral bound, also for a non-diagonal tensor. */
    get maxInverseInertia():number {const m=this.localInverseInertiaTensor;return m?Math.max(Math.abs(m[0]!)+Math.abs(m[1]!)+Math.abs(m[2]!),Math.abs(m[3]!)+Math.abs(m[4]!)+Math.abs(m[5]!),Math.abs(m[6]!)+Math.abs(m[7]!)+Math.abs(m[8]!)):Math.max(...this.invI);}
    private inverseInertiaMatrix():number[] {
        // R * I^-1 * R^T is fixed throughout the contact iterations for this pose.
        const q = this.q, i = this.invI, c = this.inertiaCache;
        if (!c || !same4(q,c.q) || !same3(i,c.i)) {
            const a = this.axes(), m = [], full=this.localInverseInertiaTensor;
            for (let r = 0; r < 3; r++)
                for (let s = 0; s < 3; s++){
                    if(full){let value=0;for(let u=0;u<3;u++)for(let v=0;v<3;v++)value+=a[u]![r]!*full[u*3+v]!*a[v]![s]!;m.push(value);}
                    else m.push(a[0]![r]! * i[0]! * a[0]![s]! + a[1]![r]! * i[1]! * a[1]![s]! + a[2]![r]! * i[2]! * a[2]![s]!);
                }
            this.inertiaCache = { q: [...q], i: [...i], m };
        }
        return this.inertiaCache!.m;
    }
    inertia(v: Vector): Vec {
        const m = this.inverseInertiaMatrix();
        return [m[0]! * v[0]! + m[1]! * v[1]! + m[2]! * v[2]!, m[3]! * v[0]! + m[4]! * v[1]! + m[5]! * v[2]!, m[6]! * v[0]! + m[7]! * v[1]! + m[8]! * v[2]!];
    }
    /** World angular momentum of this rigid mass representation. Active nodal
     * owners account their own particle momentum instead. */
    angularMomentum(angularVelocity:Vector=this.w):Vec {
        const w=QinverseRotate(this.q,angularVelocity),m=this.localInertiaTensor;
        return Qrotate(this.q,m?[m[0]!*w[0]+m[1]!*w[1]+m[2]!*w[2],m[3]!*w[0]+m[4]!*w[1]+m[5]!*w[2],m[6]!*w[0]+m[7]!*w[1]+m[8]!*w[2]]:w.map((n,i)=>this.invI[i]!>0?n/this.invI[i]!:0));
    }
    inverseEffectiveMass(p:Vector,n:Vector):number {
        if(this.deformable?.active)return this.deformable.inverseEffectiveMass(p,n);
        const x=p[0]!-this.p[0],y=p[1]!-this.p[1],z=p[2]!-this.p[2],tx=y*n[2]!-z*n[1]!,ty=z*n[0]!-x*n[2]!,tz=x*n[1]!-y*n[0]!,m=this.inverseInertiaMatrix(),wx=m[0]!*tx+m[1]!*ty+m[2]!*tz,wy=m[3]!*tx+m[4]!*ty+m[5]!*tz,wz=m[6]!*tx+m[7]!*ty+m[8]!*tz;
        return this.invMass+(n[0]!*(wy*z-wz*y)+n[1]!*(wz*x-wx*z)+n[2]!*(wx*y-wy*x));
    }
    impulse(j: Vector, p: Vector = this.p) {
        if(this.deformable?.active){this.wake();this.deformable.impulse(j,p);return;}if(!this.invMass)return;
        if(this.sleeping&&Vlen(j)>.0001)this.wake();
        const x=p[0]!-this.p[0],y=p[1]!-this.p[1],z=p[2]!-this.p[2],jx=j[0]!,jy=j[1]!,jz=j[2]!,tx=y*jz-z*jy,ty=z*jx-x*jz,tz=x*jy-y*jx,m=this.inverseInertiaMatrix();
        // Same impulse and tensor product, without temporary cross/add arrays in
        // every contact and hinge iteration. Active nodes still own their mass.
        this.v[0]+=jx*this.invMass;this.v[1]+=jy*this.invMass;this.v[2]+=jz*this.invMass;
        this.w[0]+=m[0]!*tx+m[1]!*ty+m[2]!*tz;this.w[1]+=m[3]!*tx+m[4]!*ty+m[5]!*tz;this.w[2]+=m[6]!*tx+m[7]!*ty+m[8]!*tz;
    }
    applyForce(f: Vector, p: Vector = this.p) { if(this.deformable?.active){this.wake();this.deformable.force(f,p);return;}if (this.sleeping && Vlen(f) > .0001)
        this.wake(); this.force = Vadd(this.force, f); this.torque = Vadd(this.torque, Vcross(Vsub(p, this.p), f)); }
    applyTorque(t: Vector) { if(this.deformable?.active){this.wake();this.deformable.torque(t);return;}if (this.sleeping && Vlen(t) > .0001)
        this.wake(); this.torque = Vadd(this.torque, t); }
    boxes(): SolidBox[] { return solidBoxSnapshot(this,true); }
}
/** Every prism owns a completed, never-mutated numeric snapshot. Only the
 * public boundary requires freezing; internal physics never recycles it. */
const privateBoxSnapshots=new WeakSet<readonly SolidBox[]>();
function solidBoxSnapshot(body:SolidBody,expose:boolean):SolidBox[]{const axes=body.axes(),boxes=body.shapes.map(s=>{const shapeAxes=s.q?rotationAxes(Qmul(body.q,s.q)):axes,face=s.triangle?worldTriangle(body,s,expose):undefined,box:SolidBox={body,p:body.point(s.offset||[0,0,0]),axes:shapeAxes,half:s.half,tag:s.tag||body.tag,structureNode:s.structureNode,structureBeam:s.structureBeam,...(face?{triangle:face.prism,...(face.local.nodes?{structureNodes:face.local.nodes}:{}),...(face.local.bindings?{structureBindings:face.local.bindings}:{}),...(face.local.geometryNodes?{geometryNodes:face.local.geometryNodes}:{})}:{})};if(box.triangle){box.bounds=box.triangle.bounds;return box;}return withBoxBounds(box);});attachTriangleAdjacency(body,boxes);if(!expose)privateBoxSnapshots.add(boxes);return boxes;}
type WeldedTriangleTopology={shapes:SolidShape[];ids:(readonly number[]|undefined)[];valid:boolean[];edges:number[][][];vertices:number[][][];prisms:(TrianglePrism|null|undefined)[];adjacency:(TrianglePrismAdjacency|undefined)[]};
const weldedTriangleTopologies=new WeakMap<SolidBody,WeldedTriangleTopology>();
function attachTriangleAdjacency(body:SolidBody,boxes:SolidBox[]){
    if(!boxes.some(box=>box.triangle&&box.geometryNodes))return;let topology=weldedTriangleTopologies.get(body),same=!!topology&&topology.shapes.length===body.shapes.length;for(let i=0;same&&i<boxes.length;i++){const ids=boxes[i]!.geometryNodes,old=topology!.ids[i];if(topology!.shapes[i]!==body.shapes[i]||topology!.valid[i]!==!!boxes[i]!.triangle||(ids?!old||!same3(ids,old):!!old))same=false;}
    if(!same){const edges=boxes.map(()=>[[],[],[]] as number[][]),vertices=boxes.map(()=>[[],[],[]] as number[][]),edgeFaces=new Map<string,number[]>(),vertexFaces=new Map<number,number[]>();for(let i=0;i<boxes.length;i++){const box=boxes[i]!,ids=box.geometryNodes;if(!box.triangle||!ids)continue;for(let v=0;v<3;v++){const id=ids[v]!,list=vertexFaces.get(id)??[];list.push(i);vertexFaces.set(id,list);const other=ids[(v+1)%3]!,key=Math.min(id,other)+':'+Math.max(id,other),faces=edgeFaces.get(key)??[];faces.push(i);edgeFaces.set(key,faces);}}for(let i=0;i<boxes.length;i++){const ids=boxes[i]!.geometryNodes;if(!boxes[i]!.triangle||!ids)continue;for(let v=0;v<3;v++){vertices[i]![v]=vertexFaces.get(ids[v]!)!.filter(face=>face!==i);const other=ids[(v+1)%3]!,key=Math.min(ids[v]!,other)+':'+Math.max(ids[v]!,other);edges[i]![v]=edgeFaces.get(key)!.filter(face=>face!==i);}}topology={shapes:body.shapes.slice(),ids:boxes.map(box=>box.geometryNodes?[...box.geometryNodes]:undefined),valid:boxes.map(box=>!!box.triangle),edges,vertices,prisms:[],adjacency:[]};weldedTriangleTopologies.set(body,topology);}
    let changed=topology!.prisms.length!==boxes.length;for(let i=0;!changed&&i<boxes.length;i++)if(topology!.prisms[i]!==boxes[i]!.triangle)changed=true;if(changed){topology!.prisms=boxes.map(box=>box.triangle);topology!.adjacency=boxes.map((box,i)=>box.triangle&&box.geometryNodes?{edges:topology!.edges[i]!.map(list=>list.map(index=>boxes[index]!.triangle!).filter(Boolean)),vertices:topology!.vertices[i]!.map(list=>list.map(index=>boxes[index]!.triangle!).filter(Boolean))}:undefined);}for(let i=0;i<boxes.length;i++)if(topology!.adjacency[i])boxes[i]!.triangleAdjacency=topology!.adjacency[i]!;
}
type CompiledMaterialBindings={bindings:SolidTriangleBindings;nodes:readonly number[];coefficients:Float64Array};
const compiledMaterialBindings=new WeakMap<SolidTriangleBindings,CompiledMaterialBindings>();
function compileMaterialBindings(source:SolidTriangleBindings){let entry=compiledMaterialBindings.get(source);if(entry)return entry;
    const nodes:number[]=[],slots=new Map<number,number>();for(const stencil of source){if(!stencil.nodes.length||stencil.nodes.length!==stencil.weights.length||stencil.nodes.some(n=>!Number.isInteger(n)||n<0)||stencil.weights.some(w=>!Number.isFinite(w)))throw new RangeError('Invalid material surface vertex stencil');for(const node of stencil.nodes)if(!slots.has(node)){slots.set(node,nodes.length);nodes.push(node);}}
    const coefficients=new Float64Array(nodes.length*3);for(let vertex=0;vertex<3;vertex++){const stencil=source[vertex]!;for(let i=0;i<stencil.nodes.length;i++)coefficients[vertex*nodes.length+slots.get(stencil.nodes[i]!)!]!+=stencil.weights[i]!;}
    const bindings=Object.freeze(source.map(stencil=>Object.freeze({nodes:Object.freeze([...stencil.nodes]),weights:Object.freeze([...stencil.weights])}))) as unknown as SolidTriangleBindings;entry={bindings,nodes:Object.freeze(nodes),coefficients};compiledMaterialBindings.set(source,entry);compiledMaterialBindings.set(bindings,entry);return entry;
}
type LocalTriangleEntry={values:number[];thickness:number;nodes:SolidShape['structureNodes'];sourceBindings:SolidShape['structureBindings'];bindings:SolidShape['structureBindings'];geometryNodes:SolidShape['geometryNodes'];prism?:TrianglePrism|null;precisionLimit:number;coordinateMagnitude:number};
type WorldTriangleEntry={p:Vec;q:Quaternion;point:SolidBody['point'];local:LocalTriangleEntry;prism:TrianglePrism|null};
const localTriangles=new WeakMap<SolidShape,LocalTriangleEntry>();
const worldTriangles=new WeakMap<SolidBody,WeakMap<SolidShape,WorldTriangleEntry>>();
function localTriangle(shape:SolidShape):LocalTriangleEntry{
    const source=shape.triangle!,thickness=shape.thickness??.0008,nodes=shape.structureNodes,geometryNodes=shape.geometryNodes??nodes,old=localTriangles.get(shape);
    let same=!!old&&old.thickness===thickness&&old.sourceBindings===shape.structureBindings&&(!nodes?!old.nodes:!!old.nodes&&same3(nodes,old.nodes))&&(!geometryNodes?!old.geometryNodes:!!old.geometryNodes&&same3(geometryNodes,old.geometryNodes));
    if(same)for(let i=0;i<9;i++)if(old!.values[i]!==source[Math.floor(i/3)]![i%3]){same=false;break;}
    if(same)return old!;
    const immutableNodes=nodes?(old?.nodes&&same3(nodes,old.nodes)?old.nodes:Object.freeze([...nodes]) as readonly[number,number,number]):undefined,immutableGeometry=geometryNodes?(old?.geometryNodes&&same3(geometryNodes,old.geometryNodes)?old.geometryNodes:Object.freeze([...geometryNodes]) as readonly[number,number,number]):undefined;
    const entry:LocalTriangleEntry={values:source.flatMap(p=>[...p]),thickness,nodes:immutableNodes,sourceBindings:shape.structureBindings,bindings:shape.structureBindings?compileMaterialBindings(shape.structureBindings).bindings:undefined,geometryNodes:immutableGeometry,precisionLimit:0,coordinateMagnitude:0};localTriangles.set(shape,entry);return entry;
}
function prepareLocalTriangle(local:LocalTriangleEntry){
    if(local.prism!==undefined)return local.prism;const v=local.values,prism=local.prism=trianglePrism([[v[0]!,v[1]!,v[2]!],[v[3]!,v[4]!,v[5]!],[v[6]!,v[7]!,v[8]!]],local.thickness);
    if(prism){const a=prism.triangle[0],b=prism.triangle[1],c=prism.triangle[2],ab=Vsub(b,a),ac=Vsub(c,a),bc=Vsub(c,b),twiceArea=Vdot(prism.normals[0]!,Vcross(ab,ac)),longest=Math.sqrt(Math.max(Vdot(ab,ab),Vdot(ac,ac),Vdot(bc,bc)));local.precisionLimit=twiceArea/longest/Number.EPSILON*1e-8;for(let i=0;i<6;i++)local.coordinateMagnitude=Math.max(local.coordinateMagnitude,Math.abs(prism.bounds[i]!));}return prism;
}
function materialWorldPoint(body:SolidBody,values:readonly number[],at:number):Vec{
    const a=values[at]!,b=values[at+1]!,c=values[at+2]!,q=body.q,p=body.p,x=q[0],y=q[1],z=q[2],w=q[3],tx=(y*c-z*b)*2,ty=(z*a-x*c)*2,tz=(x*b-y*a)*2;
    return[p[0]+(a+(tx*w+(y*tz-z*ty))),p[1]+(b+(ty*w+(z*tx-x*tz))),p[2]+(c+(tz*w+(x*ty-y*tx)))];
}
const frozenWorldPrisms=new WeakSet<TrianglePrism>(),frozenWorldDirections=new WeakSet<object>();
function freezeWorldTriangle(prism:TrianglePrism){
    if(frozenWorldPrisms.has(prism))return prism;
    for(let i=0;i<3;i++)Object.freeze(prism.triangle[i]);for(let i=0;i<6;i++)Object.freeze(prism.vertices[i]);
    // The last edge direction and four plane normals already belong to normals.
    // Freeze each owned vector once, and share them across pure translations.
    if(!frozenWorldDirections.has(prism.normals)){for(let i=0;i<4;i++)Object.freeze(prism.normals[i]);for(let i=0;i<3;i++)Object.freeze(prism.edgeDirections[i]);Object.freeze(prism.planes[1]!.n);Object.freeze(prism.normals);Object.freeze(prism.edgeDirections);frozenWorldDirections.add(prism.normals);}
    for(let i=0;i<5;i++)Object.freeze(prism.planes[i]);Object.freeze(prism.triangle);Object.freeze(prism.vertices);Object.freeze(prism.planes);Object.freeze(prism.center);Object.freeze(prism.bounds);Object.freeze(prism);frozenWorldPrisms.add(prism);return prism;
}
/** Apply only a rigid pose to an already-normalized immutable material prism.
 * This avoids rebuilding every face/edge normal and allocating Qrotate scratch
 * vectors whenever the same sheet spins or its body pose is refitted. */
function poseTriangle(body:SolidBody,local:TrianglePrism,old:WorldTriangleEntry|undefined):TrianglePrism{
    const q=body.q,p=body.p,x=q[0],y=q[1],z=q[2],w=q[3],transform=(v:Vector,translate:boolean):Vec=>{
        const a=v[0]!,b=v[1]!,c=v[2]!,tx=(y*c-z*b)*2,ty=(z*a-x*c)*2,tz=(x*b-y*a)*2;
        return[(translate?p[0]:0)+(a+(tx*w+(y*tz-z*ty))),(translate?p[1]:0)+(b+(ty*w+(z*tx-x*tz))),(translate?p[2]:0)+(c+(tz*w+(x*ty-y*tx)))];
    },shared=!!old?.prism&&same4(old.q,q),triangle=local.triangle.map(v=>transform(v,true)) as [Vec,Vec,Vec],vertices=local.vertices.map(v=>transform(v,true)),normals=shared?old!.prism!.normals:local.normals.map(v=>transform(v,false)),edgeDirections=shared?old!.prism!.edgeDirections:[transform(local.edgeDirections[0]!,false),transform(local.edgeDirections[1]!,false),transform(local.edgeDirections[2]!,false),normals[0]!],opposite=shared?old!.prism!.planes[1]!.n:transform(local.planes[1]!.n,false),planes=local.planes.map((plane,i)=>{const n=i===0?normals[0]!:i===1?opposite:normals[i-1]!;return{n,offset:Vdot(n,vertices[plane.vertices[0]!]!),vertices:plane.vertices};}),bounds=[Infinity,Infinity,Infinity,-Infinity,-Infinity,-Infinity] as [number,number,number,number,number,number];
    for(let i=0;i<6;i++){const v=vertices[i]!;for(let k=0;k<3;k++){bounds[k]=Math.min(bounds[k]!,v[k]!);bounds[k+3]=Math.max(bounds[k+3]!,v[k]!);}}
    return {triangle,halfThickness:local.halfThickness,vertices,normals,planes,edgeDirections,edges:local.edges,center:transform(local.center,true),bounds};
}
/** Geometry is immutable and shared only while all nine material coordinates
 * and the body pose match. Shape identity alone cannot validate a deforming face. */
function worldTriangle(body:SolidBody,shape:SolidShape,expose=true):WorldTriangleEntry{
    let entries=worldTriangles.get(body);if(!entries){entries=new WeakMap();worldTriangles.set(body,entries);}const old=entries.get(shape),local=localTriangle(shape),sameLocal=old?.local===local,samePoint=old?.point===body.point;
    if(body.point===solidPoint&&samePoint&&sameLocal&&same3(old.p,body.p)&&same4(old.q,body.q)){if(expose&&old.prism)freezeWorldTriangle(old.prism);return old;}
    // A changing material face is built directly once. Prepare its local prism
    // lazily only after the same geometry needs another rigid pose, avoiding
    // duplicate local+world construction on every deformation publication.
    const builtin=body.point===solidPoint,q=body.q,norm=q[0]*q[0]+q[1]*q[1]+q[2]*q[2]+q[3]*q[3],geometry=sameLocal&&builtin&&Math.abs(norm-1)<=64*Number.EPSILON?prepareLocalTriangle(local):undefined,magnitude=local.coordinateMagnitude+Math.max(Math.abs(body.p[0]),Math.abs(body.p[1]),Math.abs(body.p[2]));
    let prism:TrianglePrism|null;if(geometry&&magnitude<local.precisionLimit)prism=poseTriangle(body,geometry,samePoint?old:undefined);
    // Near floating-point resolution retain actual world-corner construction;
    // a tiny material face must not survive a world-space collapse.
    else{const v=local.values,points:[Vec,Vec,Vec]=builtin?[materialWorldPoint(body,v,0),materialWorldPoint(body,v,3),materialWorldPoint(body,v,6)]:[body.point(v.slice(0,3)),body.point(v.slice(3,6)),body.point(v.slice(6,9))];prism=trianglePrism(points,local.thickness);}
    if(expose&&prism)freezeWorldTriangle(prism);
    const entry:WorldTriangleEntry={p:[...body.p],q:[...body.q],point:body.point,local,prism};entries.set(shape,entry);return entry;
}
const solidBoxes = SolidBody.prototype.boxes;
const solidAxes = SolidBody.prototype.axes,solidPoint = SolidBody.prototype.point;
// Do not add reads of user-supplied method getters or change custom geometry
// callback order. Only built-in snapshot construction receives the index.
function builtinGeometry(body:SolidBody){
 for(const [name,method]of [['boxes',solidBoxes],['axes',solidAxes],['point',solidPoint]] as const){let source:object|null=body;while(source){const descriptor=Object.getOwnPropertyDescriptor(source,name);if(descriptor){if(!('value'in descriptor)||descriptor.value!==method)return false;break;}source=Object.getPrototypeOf(source);}if(!source)return false;}return true;
}
function physicsBoxes(body:SolidBody){return builtinGeometry(body)?solidBoxSnapshot(body,false):body.boxes();}
function exposePhysicsBoxes(boxes:readonly SolidBox[]){if(!privateBoxSnapshots.has(boxes))return;for(const box of boxes)if(box.triangle)freezeWorldTriangle(box.triangle);}
export type SolidBodyOverlapSource=Pick<SolidBody,'boxes'>;
/** One synchronous separation/ownership pass. Only booleans cross the public
 * boundary; private owned snapshots cannot escape or be mutated by callers.
 * Representation changes within the pass must explicitly invalidate the body. */
export class SolidBodyOverlapQuery{
 #samples=new Map<SolidBodyOverlapSource,{boxes:readonly SolidBox[];bounds:Float64Array}>();
 invalidate(body:SolidBodyOverlapSource){this.#samples.delete(body);}
 #sample(body:SolidBodyOverlapSource){let value=this.#samples.get(body);if(value)return value;const boxes=body instanceof SolidBody?physicsBoxes(body):body.boxes(),bounds=Float64Array.of(Infinity,Infinity,Infinity,-Infinity,-Infinity,-Infinity);for(const box of boxes){const b=box.bounds??boxBounds(box);for(let axis=0;axis<3;axis++){bounds[axis]=Math.min(bounds[axis]!,b[axis]!);bounds[axis+3]=Math.max(bounds[axis+3]!,b[axis+3]!);}}value={boxes,bounds};this.#samples.set(body,value);return value;}
 overlaps(a:SolidBodyOverlapSource,b:SolidBodyOverlapSource){const A=this.#sample(a),B=this.#sample(b),p=A.bounds,q=B.bounds;if(p[0]!>q[3]!||q[0]!>p[3]!||p[1]!>q[4]!||q[1]!>p[4]!||p[2]!>q[5]!||q[2]!>p[5]!)return false;for(const first of A.boxes)for(const second of B.boxes)if(intersectBoxes3(first,second,0))return true;return false;}
}
function pairBoundsIndex(a:SolidBody,b:SolidBody,A:readonly SolidBox[],B:readonly SolidBox[],cache?:Map<SolidBody,OrderedShapeBoundsIndex>){if(!builtinGeometry(a)||!builtinGeometry(b)||A.length<=1||B.length<=8||Object.getPrototypeOf(A)!==Array.prototype||Object.getPrototypeOf(B)!==Array.prototype||Object.hasOwn(A,Symbol.iterator)||Object.hasOwn(B,Symbol.iterator))return;let index=cache?.get(b);if(!index){index=new OrderedShapeBoundsIndex(B);cache?.set(b,index);}return index;}
function* orderedBoxes(index:OrderedShapeBoundsIndex,query:SolidBox,source:readonly SolidBox[],margin:number,scratch:number[]){for(const i of index.candidates(query,margin,scratch))yield source[i]!;}
interface QueryShapeCause {
    source: SolidShape;half: Vector;offset: Vector | undefined;q: Vector | undefined;
    halfValues: Vector;offsetValues: Vector | undefined;qValues: Vector | undefined;
    tag: string | undefined;structureNode: number | undefined;structureBeam: number | undefined;
    triangle:SolidShape['triangle'];triangleValues:number[]|undefined;thickness:number|undefined;structureNodes:SolidShape['structureNodes'];nodeValues:number[]|undefined;structureBindings:SolidShape['structureBindings'];geometryNodes:SolidShape['geometryNodes'];geometryValues:number[]|undefined;
}
interface QueryBoxEntry {
    p: Vec;q: Quaternion;half: Vec;tag: string;sources: SolidShape[];shapes: QueryShapeCause[];boxes: SolidBox[];
}
const same3 = (a: Vector, b: Vector) => a[0] === b[0] && a[1] === b[1] && a[2] === b[2];
const same4 = (a: Vector, b: Vector) => same3(a,b) && a[3] === b[3];
function sameTriangle(old:QueryShapeCause,shape:SolidShape){if(old.triangle!==shape.triangle||old.thickness!==shape.thickness||old.structureNodes!==shape.structureNodes||old.structureBindings!==shape.structureBindings||old.geometryNodes!==shape.geometryNodes)return false;if(shape.triangle)for(let i=0;i<9;i++)if(old.triangleValues![i]!==shape.triangle[Math.floor(i/3)]![i%3])return false;if(shape.structureNodes&&!same3(old.nodeValues!,shape.structureNodes))return false;if(shape.geometryNodes&&!same3(old.geometryValues!,shape.geometryNodes))return false;return true;}
function materialContact(box:SolidBox,p:Vector):SolidMaterialContact|undefined{
    if(!box.triangle||!box.structureNodes&&!box.structureBindings)return;const barycentric=closestTrianglePoint(p,...box.triangle.triangle).weights,geometry=box.geometryNodes?{geometryNodes:box.geometryNodes}:{};
    if(box.structureBindings){const map=compileMaterialBindings(box.structureBindings),count=map.nodes.length,weights=new Array<number>(count);for(let i=0;i<count;i++)weights[i]=barycentric[0]*map.coefficients[i]!+barycentric[1]*map.coefficients[count+i]!+barycentric[2]*map.coefficients[count*2+i]!;return{nodes:map.nodes,weights,...geometry};}
    return{nodes:[...box.structureNodes!],weights:barycentric,...geometry};
}
function bindContact(body:SolidBody,point:Vector,node:number|undefined,material:SolidMaterialContact|undefined){if(material)body.deformable?.bindMaterialContact?.(point,material.nodes,material.weights);else if(node!==undefined)body.deformable?.bindContactPoint?.(point,node);}
function penetrateGeometry(a:Geometry,b:Geometry,tolerance:number){return a.triangle!==undefined||b.triangle!==undefined?(prismSAT(a,b,-tolerance)?.depth??-Infinity)>tolerance:boxesPenetrate(a,b,tolerance);}
function solidSupport(box: Geometry, n: Vector): Vec { if(box.triangle)return prismSupport(box.triangle,n);let p = [...box.p] as Vec; for (let i = 0; i < 3; i++) {
    const d = Vdot(box.axes[i]!, n);
    if (Math.abs(d) > 1e-8)
        p = Vadd(p, Vscale(box.axes[i]!, box.half[i]! * Math.sign(d)));
} return p; }
function solidVertices(box: Geometry): readonly Vec[] { if(box.triangle!==undefined)return box.triangle?.vertices??[];const out: Vec[] = []; for (let x of [-1, 1])
    for (let y of [-1, 1])
        for (let z of [-1, 1])
            out.push(Vadd(box.p, Vadd(Vscale(box.axes[0]!, x * box.half[0]!), Vadd(Vscale(box.axes[1]!, y * box.half[1]!), Vscale(box.axes[2]!, z * box.half[2]!))))); return out; }
export function solidInside(p: Vector, box: Geometry, margin = .015) { if(box.triangle!==undefined)return !!box.triangle&&prismInside(p,box.triangle,margin);const d = Vsub(p, box.p); return box.axes.every((a, i) => Math.abs(Vdot(d, a)) <= box.half[i]! + margin); }
export function intersectBoxes3(a: Geometry, b: Geometry, margin = .006): {
    n: Vec;
    depth: number;
    points: Vec[];
} | null {
    if (!boxBoundsOverlap(a, b, margin))
        return null;
    if(a.triangle!==undefined||b.triangle!==undefined){const contact=prismSAT(a,b,margin);return contact?{...contact,points:prismManifold(a,b,contact.n,margin)}:null;}
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
    // Adjacent material triangles share node corners. Their identical contact
    // stencil and surface sample name one reaction, rather than extra masses.
    const unique:SolidContact[]=[],seen=new Map<string,number>(),rounded=(x:number)=>Math.round(x*1e9),stencil=(m:SolidMaterialContact|undefined)=>m?m.nodes.map((node,i)=>[node,m.weights[i]!] as const).filter(([,w])=>Math.abs(w)>1e-12).sort((a,b)=>a[0]-b[0]).map(([n,w])=>n+','+rounded(w)).join(';'):'';
    for(const c of contacts){if(!c.materialA&&!c.materialB){unique.push(c);continue;}const key=[c.a.id,c.b?.id??0,c.tag,...c.p.map(rounded),...c.n.map(rounded),stencil(c.materialA),stencil(c.materialB)].join(':'),previous=seen.get(key);if(previous===undefined){seen.set(key,unique.length);unique.push(c);}else if(c.depth>unique[previous]!.depth)unique[previous]=c;}
    for (const c of unique) {
        if (!c.b) {
            out.push(c);
            continue;
        }
        const lo = Math.min(c.a.id, c.b.id), hi = Math.max(c.a.id, c.b.id), key = lo + ':' + hi+':'+((c.materialA?.geometryNodes??c.materialA?.nodes)?.join(',')??c.nodeA??'body')+':'+((c.materialB?.geometryNodes??c.materialB?.nodes)?.join(',')??c.nodeB??'body');
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
        const first = list[0]!, pair = !first.materialA&&!first.materialB&&first.nodeA===undefined&&first.nodeB===undefined&&!!first.b&&policies.escapeAmbiguous?.(first.a, first.b), ambiguous = pair && clusters.length > 1 && clusters[1]!.score > clusters[0]!.score * .18;
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
    if(box.triangle!==undefined){const hit=box.triangle&&rayTrianglePrism(origin,dir,maxDistance,box.triangle);return hit?{...hit,body:box.body,tag:box.tag}:null;}
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
    trace:EngineTrace|undefined;
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
    remove(body: SolidBody) {if(body.removed)return;body.deformable?.structure?.leaveMechanicalEnergyGroup();body.deformable?.structure?.disposeNumericalResources();body.removed = true;body.onRemoved?.();this.bodies = this.bodies.filter(b => b !== body); this.joints = this.joints.filter(j => j.a !== body && j.b !== body); }
    addPlane({ p, n = [0, 1, 0], u = [1, 0, 0], v = [0, 0, 1], hu = 1, hv = 1, tag = 'road', filter = null }: SolidPlaneOptions): SolidPlane { const plane: SolidPlane = { id: solidId++, plane: true, p, n: Vunit(n), u: Vunit(u), v: Vunit(v), hu, hv, tag, filter, x: p[0]!, z: p[2]!, radius: Math.hypot(hu, hv), body: null };if(this.staticGroups)this.staticGroups.add(plane,true,plane.radius>256,this.currentStaticGroup);else this.planes.push(plane); if (plane.radius > 256){
        if(!this.staticGroups)this.globalPlanes.push(plane);}
    else
        this.staticIndex.add(plane, plane.radius,this.currentStaticGroup); return plane; }
    joint(a: SolidBody, b: SolidBody, anchorA: Vector, anchorB: Vector) { const j: SolidJoint = { a, b, anchorA, anchorB }; a.ignore.add(b.id); b.ignore.add(a.id); this.joints.push(j); return j; }
    constraint(a:SolidBody,b:SolidBody,constraint:SolidConstraint){const j:SolidJoint={type:'constraint',a,b,constraint};this.joints.push(j);return j;}
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
            if ((b.cachedBoxes || b.boxes()).some(other => penetrateGeometry(box, other, .012)))
                return true;
        }
        } finally { candidateState.depth = candidateDepth; }
        for (const b of this.bodies) {
            if (b.plane || !b.enabled || b === ignore || filter && !filter(b))
                continue;
            const dx = b.p[0]! - p[0]!, dy = b.p[1]! - p[1]!, dz = b.p[2]! - p[2]!;
            if (dx * dx + dy * dy + dz * dz >= (b.radius + radius) * (b.radius + radius))
                continue;
            if ((b.cachedBoxes || b.boxes()).some(other => penetrateGeometry(box, other, .012)))
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
            if (old.source !== shape || old.half !== shape.half || old.offset !== shape.offset || old.q !== shape.q || old.tag !== shape.tag || old.structureNode !== shape.structureNode || old.structureBeam !== shape.structureBeam || !sameTriangle(old,shape) || !same3(old.halfValues,shape.half) || (shape.offset && !same3(old.offsetValues!,shape.offset)) || (shape.q && !same4(old.qValues!,shape.q))) {valid=false;break;}
        }
        if (valid) return cached!.boxes;
        const boxes=physicsBoxes(body);
        this.rayBoxCache.set(body,{p:[...body.p],q:[...body.q],half:[...body.half],tag:body.tag,sources:body.shapes,boxes,shapes:body.shapes.map(shape=>({source:shape,half:shape.half,offset:shape.offset,q:shape.q,halfValues:[...shape.half],offsetValues:shape.offset?[...shape.offset]:undefined,qValues:shape.q?[...shape.q]:undefined,tag:shape.tag,structureNode:shape.structureNode,structureBeam:shape.structureBeam,triangle:shape.triangle,triangleValues:shape.triangle?.flatMap(p=>[...p]),thickness:shape.thickness,structureNodes:shape.structureNodes,nodeValues:shape.structureNodes?[...shape.structureNodes]:undefined,structureBindings:shape.structureBindings,geometryNodes:shape.geometryNodes,geometryValues:shape.geometryNodes?[...shape.geometryNodes]:undefined}))});
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
    /** Volume support query with rounded edges, sharing the existing broad phase
     * and cached OBBs. Distance is to the sphere centre, unlike ray(). */
    sphereCast(origin:Vector,dir:Vector,maxDistance:number,radius:number,ignore:SolidBody|null=null,refineHit?:(hit:SolidRayHit)=>SolidRayHit|null):SolidRayHit|null{
        if(!(radius>0)||!(maxDistance>=0))return null;
        const mid=Vadd(origin,Vscale(dir,maxDistance*.5));
        const candidates=this.candidates(mid,Math.hypot(dir[0]!,dir[2]!)*maxDistance*.5+radius);
        let best:SolidRayHit|null=null;
        // A finite support shape can use the sphere as its broad bound. Refine
        // every candidate BEFORE nearest-hit ordering; a rejected flank must
        // not hide the supporting road behind it.
        const refine=(raw:SolidRayHit|null)=>{const hit=raw&&refineHit?refineHit(raw):raw;return hit&&hit.t>=0&&hit.t<=(best?.t??maxDistance)?hit:null;};
        const state=this.candidateState(),depth=state.depth;state.depth=depth+1;
        try{
        for(const item of candidates){
            if(item===ignore||!item.plane&&ignore?.ignore.has(item.id))continue;
            if(item.plane){
                if(Vdot(dir,item.n)>=-1e-8||Vdot(Vsub(origin,item.p),item.n)<0)continue;
                const box={p:item.p as Vec,axes:[item.u,item.n,item.v] as Axes,half:[item.hu,0,item.hv],tag:item.tag,body:null as unknown as SolidBody};
                const raw=castRoundedBox(origin,dir,best?.t??maxDistance,radius,box);if(raw)raw.plane=item;
                const hit=refine(raw);if(hit&&(!item.filter||item.filter(hit.p)))best=hit;
            }else for(const box of item.cachedBoxes||this.rayBoxes(item)){const hit=refine(castRoundedBox(origin,dir,best?.t??maxDistance,radius,box));if(hit)best=hit;}
        }
        }finally{state.depth=depth;}
        for(const body of this.bodies){
            if(body===ignore||!body.enabled||ignore?.ignore.has(body.id)||this.policies.rayBody?.(body,ignore)===false)continue;
            if(Vlen(Vsub(body.p,mid))>body.radius+radius+maxDistance*.5)continue;
            for(const box of this.rayBoxes(body)){const hit=refine(castRoundedBox(origin,dir,best?.t??maxDistance,radius,box));if(hit)best=hit;}
        }
        return best;
    }
    contactsForPlane(a: SolidBody, box: SolidBox, plane: SolidPlane, h: number) {
        if(box.triangle===null)return;
        const low=Vdot(Vsub(solidSupport(box,Vscale(plane.n,-1)),plane.p),plane.n),high=Vdot(Vsub(solidSupport(box,plane.n),plane.p),plane.n);
        if (low > .018 || high < -.10)
            return;
        for (const p of solidVertices(box)) {
            const rel = Vsub(p, plane.p), depth = -Vdot(rel, plane.n);
            if (depth < -.012 || depth > 2.5)
                continue;
            const cp = Vadd(p, Vscale(plane.n, depth));
            const delta = Vsub(cp, plane.p);
            if (Math.abs(Vdot(delta, plane.u)) > plane.hu + .015 || Math.abs(Vdot(delta, plane.v)) > plane.hv + .015 || plane.filter && !plane.filter(cp))
                continue;
            this.addContact(a, null, cp, plane.n, depth, plane.tag, h,box.structureNode,undefined,materialContact(box,p));
        }
    }
    addContact(a: SolidBody, b: SolidBody | null, p: Vec, n: Vec, depth: number, tag: string, h: number,nodeA?:number,nodeB?:number,materialA?:SolidMaterialContact,materialB?:SolidMaterialContact) {
        bindContact(a,p,nodeA,materialA);if(b)bindContact(b,p,nodeB,materialB);
        const va = a.pointVelocity(p), vb = b ? b.pointVelocity(p) : [0, 0, 0], vn = Vdot(Vsub(va, vb), n);
        // Refine before applying the first contact impulse; it must have exactly one mass owner.
        if(vn<0){
            // Opt-in owners already inspected swept static approach before
            // gravity/prediction. Repeating refinement here mistakes the next
            // gravity support impulse (g*h) for a fresh material impact and
            // keeps a settled plate cycling through nodal activation forever.
            if(b||!a.deformable?.refineStaticsBeforePrediction)a.contactRefinement?.(p,n,-vn,h);
            b?.contactRefinement?.(p,Vscale(n,-1),-vn,h);
        }
        const bounce = vn < -2 ? -vn * Math.min(a.restitution, b?.restitution ?? .08) : 0;
        const rawMu = Math.sqrt(a.friction * (b?.friction ?? .72)), limit = b ? this.policies.frictionLimit?.(a, b) : undefined, mu = limit === undefined ? rawMu : Math.min(rawMu, limit);
        // Static buildings/pillars need stronger Baumgarte than vehicle pairs — thin facade
        // slabs otherwise swallow a broadside at 60 Hz and the car sits inside the wall.
        const staticHit = !b, bias = staticHit ? (depth > .12 ? .48 : .28) : .15;
        let target = Math.max(bounce, Math.max(depth - .008, 0) * bias / h);
        if (staticHit && depth > .20)
            target = Math.max(target, depth * .62 / h);
        const biasLimit=Math.min(a.maxContactBiasSpeed??a.deformable?.maxContactBiasSpeed??Infinity,b?.maxContactBiasSpeed??b?.deformable?.maxContactBiasSpeed??Infinity);
        target=Math.max(bounce,Math.min(target,biasLimit));
        this.contacts.push({ a, b, p, n, depth, tag, kn: this.effective(a, b, p, n), jn: 0, jt: [0, 0, 0], target, mu, approach: -vn,...(nodeA!==undefined?{nodeA}:{}),...(nodeB!==undefined?{nodeB}:{}),...(materialA?{materialA}:{}),...(materialB?{materialB}:{}) });
    }
    effective(a: SolidBody, b: SolidBody | null, p: Vector, n: Vector) { return a.inverseEffectiveMass(p,n)+(b?.inverseEffectiveMass(p,n)??0); }
    private readonly contactVA:Vec=[0,0,0];private readonly contactVB:Vec=[0,0,0];
    private readonly contactJ:Vec=[0,0,0];private readonly contactOpposite:Vec=[0,0,0];private readonly contactDirection:Vec=[0,0,0];
    solveContact(c: SolidContact) {
        const {a,b,p,n}=c,A=this.contactVA,B=this.contactVB,J=this.contactJ,opposite=this.contactOpposite;
        a.pointVelocityInto(p,A);if(b)b.pointVelocityInto(p,B);else B.fill(0);
        const k = c.kn;
        if (k < 1e-12)
            return;
        const old = c.jn;
        const normal=(A[0]-B[0])*n[0]+(A[1]-B[1])*n[1]+(A[2]-B[2])*n[2];
        c.jn=c.projected?old+Math.max(0,(c.target-normal)/k):Math.max(0,old+(c.target-normal)/k);
        const delta=c.jn-old;for(let axis=0;axis<3;axis++){J[axis]=n[axis]!*delta;opposite[axis]=-J[axis]!;}a.impulse(J,p);if(b)b.impulse(opposite,p);
        a.pointVelocityInto(p,A);if(b)b.pointVelocityInto(p,B);else B.fill(0);
        const vx=A[0]-B[0],vy=A[1]-B[1],vz=A[2]-B[2],dot=vx*n[0]+vy*n[1]+vz*n[2],tx=vx-n[0]*dot,ty=vy-n[1]*dot,tz=vz-n[2]*dot,speed=Math.hypot(tx,ty,tz);
        if (speed > .0001) {
            const direction=this.contactDirection,inv=1/speed;direction[0]=tx*inv;direction[1]=ty*inv;direction[2]=tz*inv;
            const kt=this.effective(a,b,p,direction),scale=speed/kt,wx=c.jt[0]-direction[0]*scale,wy=c.jt[1]-direction[1]*scale,wz=c.jt[2]-direction[2]*scale,length=Math.hypot(wx,wy,wz),limit=c.mu*c.jn,factor=length>limit?limit/length:1;
            const nx=length>limit?wx*factor:wx,ny=length>limit?wy*factor:wy,nz=length>limit?wz*factor:wz;
            J[0]=nx-c.jt[0];J[1]=ny-c.jt[1];J[2]=nz-c.jt[2];for(let axis=0;axis<3;axis++)opposite[axis]=-J[axis]!;
            c.jt[0]=nx;c.jt[1]=ny;c.jt[2]=nz;a.impulse(J,p);if(b)b.impulse(opposite,p);
        }
    }
    solveJoint(j: SolidJoint, h: number) {if(j.type==='constraint'){j.constraint.solve(h);return;} if (j.type === 'distance' || j.type === 'range') {
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
        const trace=this.trace?.recording?this.trace:undefined,start=trace?performance.now():0;
        try {
        for (const b of this.bodies)
            if (b.sleeping && (Vlen(b.v) > .05 || Vlen(b.w) > .04 || b.sleepSupports.some(s => !s.body.enabled || s.body.removed || s.body.deformable?.active || Vlen(Vsub(s.body.p, s.p)) > .01 || Math.abs(s.body.q.reduce((sum, v, i) => sum + v * s.q[i]!, 0)) < .99995)))
                b.wake();
        const bodies = this.bodies.filter(b => b.enabled), parent = bodies.map((_, i) => i), index = new Map(bodies.map((b, i) => [b, i]));
        const root = (start: number) => { let i = start; while (parent[i]! !== i) {
            parent[i] = parent[parent[i]!]!;
            i = parent[i]!;
        } return i; }, join = (a: number, b: number) => { parent[root(a)] = root(b); };
        // Swept bounding spheres conservatively connect possible collisions and suspension supports.
        const reach = bodies.map(b => b.radius + Vlen(b.v) * dt + Vlen(b.force) * b.invMass * dt * dt + 1);
        const swept=bodies.map(b=>{
            const bounds=[Infinity,Infinity,Infinity,-Infinity,-Infinity,-Infinity],angular=Vlen(b.w)*dt+Vlen(b.torque)*b.maxInverseInertia*dt*dt,padding=.02+Math.min(2,angular)*b.radius+(b.deformable?.active?b.deformable.maxInternalSpeed??0:0)*dt+Vlen(b.force)*b.invMass*dt*dt;
            for(const box of b.sleepBoxes??physicsBoxes(b)){const B=box.bounds??boxBounds(box);for(let axis=0;axis<3;axis++){const move=b.v[axis]!*dt;bounds[axis]=Math.min(bounds[axis]!,B[axis]!+Math.min(0,move)-padding);bounds[axis+3]=Math.max(bounds[axis+3]!,B[axis+3]!+Math.max(0,move)+padding);}}
            return bounds;
        });
        for (let i = 0; i < bodies.length; i++)
            for (let j = i + 1; j < bodies.length; j++) {
                if(bodies[i]!.ignore.has(bodies[j]!.id)||bodies[j]!.ignore.has(bodies[i]!.id))continue;
                const a = bodies[i]!.p, b = bodies[j]!.p, r = reach[i]! + reach[j]!;
                const A=swept[i]!,B=swept[j]!;
                if ((a[0]! - b[0]!) ** 2 + (a[1]! - b[1]!) ** 2 + (a[2]! - b[2]!) ** 2 <= r * r&&A[0]!<=B[3]!&&B[0]!<=A[3]!&&A[1]!<=B[4]!&&B[1]!<=A[4]!&&A[2]!<=B[5]!&&B[2]!<=A[5]!)
                    join(i, j);
            }
        for (const j of this.joints)
            if (index.has(j.a) && index.has(j.b))
                join(index.get(j.a)!, index.get(j.b)!);
        for(const body of bodies)for(const support of this.policies.supports?.(body)??[])if(index.has(support))join(index.get(body)!,index.get(support)!);
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
            const members = new Set(group), joints = this.joints.filter(j => j.a.enabled&&j.b.enabled&&!j.a.removed&&!j.b.removed&&(members.has(j.a)&&(members.has(j.b)||!j.b.invMass)||members.has(j.b)&&!j.a.invMass));
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
        } finally {
            if(trace){const end=performance.now(),context={tick:this.metrics.steps,dt,bodies:this.bodies.length,islands:this.metrics.islands??0};trace.complete('compound.step','physics',start,end,context);trace.sample('physics.step.ms',end-start,context,end);}
        }
    }
    stepIsland(dt: number, bodies: SolidBody[], members: Set<SolidBody>, joints: SolidJoint[]): number {
        const startPositions = new Map(bodies.filter(b => b.enabled && !b.sleeping).map(b => [b, [...b.p,...b.q]]));
        const moving=bodies.filter(b=>b.enabled&&!b.sleeping);
        // Sweep along each actual shape axis. A thin plate moving in its plane
        // does not cross its thickness every tick. Using the smallest thickness
        // for all motion made one closed panel multiply the whole island's work.
        // Bound the actual rotation on each axis with Rodrigues' formula. A
        // plate spinning about its normal does not sweep across its thickness.
        let motion=0;
        for(const b of moving){
            const physicalPrisms=builtinGeometry(b);
            if(physicalPrisms)motion=Math.max(motion,triangleAdaptiveMotion(b,dt));
            const speed=Vlen(b.w),theta=speed*dt,rotation=speed>0?Vscale(b.w,1/speed):null,sine=theta>=Math.PI/2?1:Math.sin(theta),cosine=theta>=Math.PI?2:1-Math.cos(theta);
            for(const box of physicsBoxes(b)){
                if(physicalPrisms&&box.triangle!==undefined)continue;
                const arms=[Vsub(box.p,b.p),...box.axes],crossed=rotation?arms.map(r=>Vcross(rotation,r)):[],curved=rotation?arms.map(r=>Vsub(Vscale(rotation,Vdot(rotation,r)),r)):[];
                for(let axis=0;axis<3;axis++){
                    const n=box.axes[axis]!,feature=Math.max(.025,Math.min(.14,box.half[axis]!*.8));let angular=0;
                    if(rotation)for(let j=0;j<4;j++)angular+=(j===0?1:box.half[j-1]!)*(sine*Math.abs(Vdot(crossed[j]!,n))+cosine*Math.abs(Vdot(curved[j]!,n)));
                    motion=Math.max(motion,(Math.abs(Vdot(b.v,n))*dt+angular)/feature);
                }
            }
        }
        const substeps=Math.min(16,Math.max(1,Math.ceil(motion))),h=dt/substeps;
        const external=bodies.filter(a=>Vlen(a.force)>0||Vlen(a.torque)>0).map(a=>({body:a,force:[...a.force],torque:[...a.torque]}));
        for (let sub = 0; sub < substeps; sub++) {
            for(const j of joints)if(j.type==='constraint')j.constraint.beginStep?.(h);
            if(sub)for(const load of external){load.body.force=Vadd(load.body.force,load.force);load.body.torque=Vadd(load.body.torque,load.torque);}
            this.beforeSubstep?.(h, members);
            // Material refinement must precede prediction for static impacts as
            // well as body pairs. Late activation starts nodes inside a wall and
            // mistakes penetration recovery for a fresh high-speed rebound.
            for(const a of bodies){
                if(!a.enabled||a.sleeping||!a.deformable?.refineStaticsBeforePrediction||a.deformable.active||!a.contactRefinement)continue;
                const margin=Vlen(a.v)*h+.02,shapes=physicsBoxes(a);
                for(const item of this.candidates(a.p,a.radius+margin)){
                    if(item.enabled===false||!item.plane&&(a.ignore.has(item.id)||item.ignore.has(a.id)))continue;
                    if(item.plane){
                        for(const box of shapes){const p=solidSupport(box,Vscale(item.n,-1)),d=Vdot(Vsub(p,item.p),item.n);if(d>margin||d<-.5)continue;const rel=Vsub(p,item.p);if(Math.abs(Vdot(rel,item.u))>item.hu+margin||Math.abs(Vdot(rel,item.v))>item.hv+margin||item.filter&&!item.filter(p))continue;const approach=-Vdot(a.pointVelocity(p),item.n);if(approach>0)a.contactRefinement(p,item.n,approach,h);}
                    }else{
                        const range=a.radius+item.radius+margin;if(Vdot(Vsub(a.p,item.p),Vsub(a.p,item.p))>range*range)continue;
                        for(const box of shapes)for(const other of item.cachedBoxes??item.boxes()){const c=intersectBoxes3(box,other,margin);if(!c)continue;const p=c.points[0]!,approach=-Vdot(a.pointVelocity(p),c.n);if(approach>0)a.contactRefinement(p,c.n,approach,h);}
                    }
                    if(a.deformable.active)break;
                }
            }
            const phased=new Set<SolidBody>();
            const coupling=new Set<SolidBody>();
            const materialJoints=joints.filter(j=>j.type==='constraint'&&j.constraint.positionProjection&&j.constraint.projectPosition&&!j.constraint.broken&&j.constraint.enabled!==false);
            for(let i=0;i<bodies.length;i++)for(let j=i+1;j<bodies.length;j++){
                const a=bodies[i]!,b=bodies[j]!;
                if(a.ignore.has(b.id)||b.ignore.has(a.id))continue;
                const margin=Vlen(Vsub(a.v,b.v))*h+.02;
                if(Vlen(Vsub(a.p,b.p))>a.radius+b.radius+margin)continue;
                const boxesA=physicsBoxes(a),boxesB=physicsBoxes(b);
                let contact:ReturnType<typeof intersectBoxes3>=null,approach=0;
                const dormantRefinement=!!(a.contactRefinement&&!a.deformable?.active||b.contactRefinement&&!b.deformable?.active);
                // A harmless near face can precede the actual closing face of
                // a compound body. Dormant material must find that approach
                // before prediction, rather than waking in addContact later.
                const pairIndex=pairBoundsIndex(a,b,boxesA,boxesB),pairCandidates:number[]=[];
                closingCandidate:for(const box of boxesA)for(const other of pairIndex?orderedBoxes(pairIndex,box,boxesB,margin,pairCandidates):boxesB){
                    const candidate=intersectBoxes3(box,other,margin);if(!candidate)continue;
                    const closing=-Vdot(Vsub(a.pointVelocity(candidate.points[0]!),b.pointVelocity(candidate.points[0]!)),candidate.n);
                    if(!contact){contact=candidate;approach=closing;}
                    if(!dormantRefinement||closing>0){contact=candidate;approach=closing;break closingCandidate;}
                }
                if(contact){
                    const p=contact.points[0]!;
                    // Refine both owners before prediction, including the first
                    // impact. Activating halfway through a velocity solve misses
                    // the shared material contact projection for one whole tick.
                    if(approach>0){a.contactRefinement?.(p,contact.n,approach,h);b.contactRefinement?.(p,Vscale(contact.n,-1),approach,h);}
                    if(a.deformable?.active&&b.deformable?.active&&a.deformable.beginAdvance&&b.deformable.beginAdvance){a.deformable.structure?.shareMechanicalEnergy(b.deformable.structure);coupling.add(a);coupling.add(b);}
                }
            }
            // Contact refinement may have activated only one endpoint above.
            // Close the material-joint component before predicting any graph.
            for(let pass=0;pass<=materialJoints.length;pass++){let changed=false;for(const {a,b} of materialJoints){if(a.deformable?.active&&!b.deformable?.active){b.deformable?.activate?.();changed ||= !!b.deformable?.active;}if(b.deformable?.active&&!a.deformable?.active){a.deformable?.activate?.();changed ||= !!a.deformable?.active;}}if(!changed)break;}
            for(const {a,b} of materialJoints){const compatible=(a.deformable?.active||!a.invMass)&&(b.deformable?.active||!b.invMass);if(!compatible)continue;for(const body of [a,b])if(body.deformable?.active&&body.deformable.beginAdvance)coupling.add(body);if(a.deformable?.active&&b.deformable?.active)a.deformable.structure?.shareMechanicalEnergy(b.deformable.structure);}
            // A quiet panel cannot reduce independently while its active parent
            // immediately refines it through their pin. Hand the whole material
            // component back to rigid owners at one common quiet boundary.
            const materialGroups:SolidBody[][]=[],materialGroup=new Map<SolidBody,SolidBody[]>();
            for(const {a,b} of materialJoints){const endpoints=[a,b].filter(body=>body.invMass&&body.deformable?.active&&body.deformable.reduce&&body.deformable.reductionReady!==undefined);if(!endpoints.length)continue;let group=materialGroup.get(endpoints[0]!);if(!group){group=[];materialGroups.push(group);}for(const body of endpoints){const old=materialGroup.get(body);if(old&&old!==group){for(const member of old){group.push(member);materialGroup.set(member,group);}old.length=0;}else if(!old){group.push(body);materialGroup.set(body,group);}}}
            for (const a of bodies)
                if (a.enabled && !a.sleeping) {
                    if(a.deformable?.active){
                        // Forces queued before refinement are consumed once by the nodal owner.
                        if(Vlen(a.force)>0)a.deformable.force(a.force,a.p);
                        if(Vlen(a.torque)>0)a.deformable.torque(a.torque);
                        a.force=[0,0,0];a.torque=[0,0,0];
                        if(coupling.has(a)&&a.deformable.beginAdvance&&a.deformable.projectAdvance&&a.deformable.endAdvance){a.deformable.beginAdvance(h,this.gravity,materialGroup.has(a));phased.add(a);}else a.deformable.advance(h,this.gravity);
                        a.contacts=0;continue;
                    }
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
            const dynamic = bodies.filter(b => b.enabled), boxes = new Map(dynamic.map(a => [a, a.sleeping ? a.sleepBoxes! : physicsBoxes(a)])),pairIndices=new Map<SolidBody,OrderedShapeBoundsIndex>();
            for (let i = 0; i < dynamic.length; i++) {
                const a = dynamic[i]!;
                if (!a.sleeping) {
                    const terrain=this.terrainContacts;if(terrain!=null){exposePhysicsBoxes(boxes.get(a)!);Reflect.apply(terrain,this,[a,boxes.get(a)!,h]);}
                    const candidates = this.candidates(a.p, a.radius + .2), candidateState = this.candidateState(), candidateDepth = candidateState.depth;
                    candidateState.depth = candidateDepth + 1;
                    try {
                    for (const item of candidates) {
                        if (item.plane) {
                            for (const box of boxes.get(a)!)
                                this.contactsForPlane(a, box, item, h);
                            continue;
                        }
                        if(a.ignore.has(item.id)||item.ignore.has(a.id))continue;
                        const dx = a.p[0]! - item.p[0]!, dy = a.p[1]! - item.p[1]!, dz = a.p[2]! - item.p[2]!, radius = a.radius + item.radius + .02;
                        if (dx * dx + dy * dy + dz * dz > radius * radius)
                            continue;
                        for (const box of boxes.get(a)!)
                            for (const boxB of item.cachedBoxes || item.boxes()) {
                                const c = intersectBoxes3(box, boxB);
                                if (c)
                                    for (const p of c.points)
                                        this.addContact(a, null, p, c.n, c.depth, boxB.tag, h,box.structureNode,undefined,materialContact(box,p));
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
                    const boxesA=boxes.get(a)!,boxesB=boxes.get(b)!,pairIndex=pairBoundsIndex(a,b,boxesA,boxesB,pairIndices),pairCandidates:number[]=[];
                    for (const box of boxesA)
                        for (const boxB of pairIndex?orderedBoxes(pairIndex,box,boxesB,.006,pairCandidates):boxesB) {
                            const c = intersectBoxes3(box, boxB);
                            if (c)
                                for (const p of c.points)
                                    this.addContact(a, b, p, c.n, c.depth, b.tag, h,box.structureNode,boxB.structureNode,materialContact(box,p),materialContact(boxB,p));
                        }
                }
            }
            this.contacts = pruneDynamicContactManifolds(this.contacts, this.policies);
            // The two material surface anchors share one unilateral constraint.
            // Equal/opposite position impulses load both graphs before their
            // velocities, stresses and permanent rest changes are finalized.
            const coupled=this.contacts.flatMap(c=>{
                if(!c.b||c.depth<=0||!phased.has(c.a)||!phased.has(c.b)||!c.a.deformable?.positionAnchor||!c.b.deformable?.positionAnchor)return [];
                c.projected=true;c.target=c.approach>2?c.approach*Math.min(c.a.restitution,c.b.restitution):0;
                const pa=Vadd(c.p,Vscale(c.n,-c.depth*.5)),pb=Vadd(c.p,Vscale(c.n,c.depth*.5));
                bindContact(c.a,pa,c.nodeA,c.materialA);bindContact(c.b,pb,c.nodeB,c.materialB);
                const anchorA=c.a.deformable.positionAnchor(pa),anchorB=c.b.deformable.positionAnchor(pb),initialA:Vec=[0,0,0],initialB:Vec=[0,0,0];anchorA.point(initialA);anchorB.point(initialB);
                // Material bindings name actual mid-surface points. Their initial
                // separation need not equal the synthetic SAT samples ±depth/2.
                const separation=Vdot(Vsub(initialA,initialB),c.n)+c.depth;
                return [{contact:c,a:anchorA,b:anchorB,separation,lambda:0,pa:[0,0,0] as Vec,pb:[0,0,0] as Vec}];
            });
            if(phased.size){
                const count=Math.max(...[...phased].map(a=>a.deformable!.solverIterations??this.iterations));
                for(let iteration=0;iteration<count;iteration++){
                    for(const a of phased)a.deformable!.projectAdvance!(iteration);
                    for(const joint of materialJoints)if(joint.type==='constraint')joint.constraint.projectPosition!(h,iteration);
                    for(const pair of coupled){
                        const n=pair.contact.n;pair.a.point(pair.pa);pair.b.point(pair.pb);
                        const C=Vdot(Vsub(pair.pa,pair.pb),n)-pair.separation;
                        // An unloaded, satisfied unilateral row has no reaction.
                        // Avoid a Schur solve and a zero displacement that would
                        // otherwise invalidate both owners' material responses.
                        if(C>=0&&pair.lambda===0)continue;
                        const k=(pair.a.inverseContactMass?.(n)??pair.a.inverseMass(n))+(pair.b.inverseContactMass?.(n)??pair.b.inverseMass(n));if(k<=1e-12)continue;
                        const next=Math.max(0,pair.lambda-C/k),delta=next-pair.lambda;pair.lambda=next;
                        if(delta===0)continue;
                        if(pair.a.displaceContact)pair.a.displaceContact(n,delta);else pair.a.displace(n,delta);if(pair.b.displaceContact)pair.b.displaceContact(n,-delta);else pair.b.displace(n,-delta);
                    }
                }
                for(const a of phased)a.deformable!.endAdvance!();
                for(const group of materialGroups)if(group.length&&group.every(body=>body.deformable!.reductionReady))for(const body of group)body.deformable!.reduce!();
                for(const pair of coupled)pair.contact.jn=pair.lambda/h;
            }
            for (const c of this.contacts)
                if (c.escapeManifold&&!c.projected) {
                    c.n = Vunit(Vsub(c.a.p, c.b!.p));
                    c.kn = this.effective(c.a, c.b, c.p, c.n);
                    c.mu = 0;
                    const biasLimit=Math.min(c.a.maxContactBiasSpeed??c.a.deformable?.maxContactBiasSpeed??Infinity,c.b?.maxContactBiasSpeed??c.b?.deformable?.maxContactBiasSpeed??Infinity);
                    c.target = Math.max(c.target, Math.min(biasLimit,Math.max(c.depth - .004, 0) * .30 / h));
                }
            for(const c of this.contacts)if(c.a.deformable?.active||c.b?.deformable?.active)c.kn=this.effective(c.a,c.b,c.p,c.n);
            for (let iteration = 0; iteration < this.iterations; iteration++) {
                for (const c of this.contacts)
                    this.solveContact(c);
                for (const j of joints)
                    if (!j.a.sleeping || !j.b.sleeping)
                        this.solveJoint(j, h);
            }
            for(const j of joints)if(j.type==='constraint')j.constraint.endStep?.(h);
            // Nodal contact mass is local. Resolve residual dynamic overlap with a
            // mass-weighted split position correction, rather than launching either
            // body with penetration/h or allowing their centres to cross and flip SAT.
            const separated=new Set<string>();
            for(const c of this.contacts){
                const a=c.a,b=c.b;
                if(a.deformable?.beginAdvance&&b?.deformable?.beginAdvance)continue;
                if(!b||c.depth<=.012||a.deformable?.maxContactBiasSpeed===undefined&&b.deformable?.maxContactBiasSpeed===undefined)continue;
                if(a.deformable?.active&&!a.deformable.translate||b.deformable?.active&&!b.deformable.translate)continue;
                const key=a.id+':'+b.id;if(separated.has(key))continue;separated.add(key);
                const sum=a.invMass+b.invMass;if(sum<=0)continue;
                const correction=Math.min(.14,(c.depth-.008)*.8),delta=Vscale(c.n,correction/sum);
                if(a.invMass){const shift=Vscale(delta,a.invMass);if(a.deformable?.active)a.deformable.translate!(shift);else a.p=Vadd(a.p,shift);}
                if(b.invMass){const shift=Vscale(delta,-b.invMass);if(b.deformable?.active)b.deformable.translate!(shift);else b.p=Vadd(b.p,shift);}
            }
            for(const a of dynamic)if(a.deformable?.active)a.deformable.syncAfterContacts?.();
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
        // A panel hanging from a supported chassis has support through its
        // joints. Requiring its own ground contact keeps an idle assembly awake.
        const jointPeers=new Map<SolidBody,SolidBody[]>(),supported=new Set<SolidBody>();
        for(const b of bodies)if(b.contacts>0||this.policies.supported?.(b)||!b.invMass)supported.add(b);
        for(const j of joints){
            if(!j.a.enabled||!j.b.enabled)continue;
            if(j.type==='constraint'&&(j.constraint.broken||j.constraint.enabled===false))continue;
            for(const [a,b]of [[j.a,j.b],[j.b,j.a]]){const peers=jointPeers.get(a!)??[];peers.push(b!);jointPeers.set(a!,peers);if(!a!.invMass)supported.add(a!);}
        }
        const supportQueue=[...supported];for(let i=0;i<supportQueue.length;i++)for(const peer of jointPeers.get(supportQueue[i]!)??[])if(!supported.has(peer)){supported.add(peer);supportQueue.push(peer);}
        for (const b of bodies) {
            if (!b.enabled || b.sleeping)
                continue;
            if(b.deformable?.active){b.sleepTime=0;continue;}
            const driven = this.policies.active?.(b);
            // Support constraints can leave linear/angular bias velocities on a
            // stationary assembly. Use completed pose travel for both thresholds.
            const start = startPositions.get(b), quiet = start && Vlen(Vsub(b.p, start)) < .05 * dt && completedAngularTravel(b.q,start) < .04 * dt;
            if (!driven && supported.has(b) && quiet)
                b.sleepTime += dt;
            else
                b.sleepTime = 0;
        }
        // Sleep connected assemblies together. A single sleeping leaf would be
        // woken by the next support reaction from its still-awake neighbour.
        const blocked=new Set(bodies.filter(b=>b.enabled&&b.invMass&&(b.sleepTime<1||b.deformable?.active))),wakeQueue=[...blocked];
        for(let i=0;i<wakeQueue.length;i++)for(const peer of jointPeers.get(wakeQueue[i]!)??[])if(!blocked.has(peer)){blocked.add(peer);wakeQueue.push(peer);}
        for(const b of bodies){
            if(b.enabled&&!b.sleeping&&b.sleepTime>=1&&!blocked.has(b)){
                b.sleeping = true;
                b.v = [0, 0, 0];
                b.w = [0, 0, 0];
                b.force = [0, 0, 0];
                b.torque = [0, 0, 0];
                b.sleepBoxes = b.boxes();
                const supports = new Set([...this.contacts.flatMap(c => c.a === b && c.b ? [c.b] : c.b === b ? [c.a] : []), ...(this.policies.supports?.(b) ?? [])]);
                for(const peer of jointPeers.get(b)??[])supports.add(peer);
                b.sleepSupports = [...supports].map(body => ({ body, p: [...body.p], q: [...body.q] }));
            }
        }
        return substeps;
    }
}
