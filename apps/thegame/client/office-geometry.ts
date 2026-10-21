import type { Color, EntitySpec, MaterialSpec, Primitive, SceneSpec } from '../../../src/scene/types.js';
import type { Vec3 } from '../../../src/math.js';
import { batchStaticScenery } from '../../../src/procedural/static-batch.js';
import type { OfficeObject, OfficeState } from '../shared.js';
import {buildOfficeLayout,objectBounds,ringThickness,type Bounds,type Wall,type OfficeLayout} from '../office-layout.js';
export {objectBounds};
export type {Bounds};

export const P = {
  paper: [.87, .89, .84, 1], cream: [.77, .72, .62, 1], tile: [.79, .79, .73, 1],
  wood: [.64, .43, .28, 1], oak: [.79, .61, .42, 1], ink: [.10, .17, .23, 1],
  slate: [.25, .36, .41, 1], blue: [.23, .48, .63, 1], sky: [.46, .70, .76, 1],
  teal: [.22, .59, .53, 1], mint: [.49, .70, .61, 1], leaf: [.19, .44, .31, 1],
  lime: [.49, .68, .30, 1], coral: [.87, .42, .32, 1], peach: [.88, .63, .48, 1],
  gold: [.93, .68, .25, 1], lilac: [.64, .55, .75, 1], violet: [.42, .37, .61, 1],
  skin: [.88, .64, .44, 1], steel: [.44, .53, .57, 1], glass: [.46, .77, .80, .23],
} satisfies Record<string, Color>;

export const colorOf = (value: string | undefined, fallback: Color = P.mint): Color => {
  if (!value) return fallback;
  const named: Record<string, Color> = { mint: P.mint, linen: P.cream, cream: P.cream, ivory: P.paper, white: P.paper, sky: P.sky, coral: P.coral, lilac: P.lilac, lavender: P.lilac, teal: P.teal, blue: P.blue, wood: P.oak, sand: P.cream, peach: P.peach, graphite: P.slate, green: P.mint, pink: P.peach, yellow: P.gold, orange: P.coral, red: P.coral };
  const namedColor = named[value.toLowerCase()];
  if (namedColor) return namedColor;
  const hex = value.replace('#', '');
  if (!/^[\da-f]{6}$/i.test(hex)) return fallback;
  return [parseInt(hex.slice(0, 2), 16) / 255, parseInt(hex.slice(2, 4), 16) / 255, parseInt(hex.slice(4, 6), 16) / 255, 1];
};

export type ActorPart = { id: string; offset: Vec3; rotation: Vec3; limb?: number; prop?:'phone'|'coffee'|'tool'|'crate' };
export type ActorDrawing = { id: string; parts: ActorPart[]; marker: string };

const roundedMeshes = new Map<string, Primitive>();
/** Bevelled geometry is authored directly in The Engine's mesh IR. */
function roundedBox(size: Vec3, radius = .10): Primitive {
  const key = `${size.join('/')}/${radius}`;
  if (roundedMeshes.has(key)) return roundedMeshes.get(key)!;
  const half = size.map(n => n / 2), r = Math.min(radius, ...half.map(n => n * .8));
  const positions: number[] = [], normals: number[] = [], indices: number[] = [];
  const coords = half.map(h => [-h, -h + r * .35, -h + r, h - r, h - r * .35, h]);
  for (let axis = 0; axis < 3; axis++) for (const sign of [-1, 1]) {
    const a = (axis + 1) % 3, b = (axis + 2) % 3, offset = positions.length / 3;
    for (let j = 0; j < 6; j++) for (let i = 0; i < 6; i++) {
      const point = [0, 0, 0]; point[axis] = half[axis]! * sign; point[a] = coords[a]![i]!; point[b] = coords[b]![j]!;
      const core = point.map((n, k) => Math.max(-half[k]! + r, Math.min(half[k]! - r, n)));
      const normal = point.map((n, k) => n - core[k]!), length = Math.hypot(...normal) || 1;
      normals.push(...normal.map(n => n / length));
      positions.push(...core.map((n, k) => n + normal[k]! / length * r));
    }
    for (let j = 0; j < 5; j++) for (let i = 0; i < 5; i++) {
      const q = offset + j * 6 + i;
      indices.push(...(sign > 0 ? [q, q + 1, q + 7, q, q + 7, q + 6] : [q, q + 7, q + 1, q, q + 6, q + 7]));
    }
  }
  const mesh: Primitive = { kind: 'triangle-mesh', positions, normals, indices };
  roundedMeshes.set(key, mesh); return mesh;
}

export class ToyKit {
  ceilingHeight=Infinity;
  readonly entities: EntitySpec[] = [];
  readonly bounds: Bounds[] = [];
  private serial = 0;
  private root = { id: 'architecture', x: 0, z: 0, rotation: 0 };
  private p(local: Vec3): Vec3 {
    const { x, z, rotation: a } = this.root;
    return [x + Math.cos(a) * local[0] + Math.sin(a) * local[2], local[1], z - Math.sin(a) * local[0] + Math.cos(a) * local[2]];
  }
  scope(id: string, x: number, z: number, rotation: number, draw: () => void) {
    const before = this.root; this.root = { id, x, z, rotation }; draw(); this.root = before;
  }
  localTransform(x: number, z: number, rotation: number, draw: () => void) {
    const before = this.root, origin = this.p([x, 0, z]);
    this.root = { id: before.id, x: origin[0], z: origin[2], rotation: before.rotation + rotation };
    draw(); this.root = before;
  }
  part(mesh: Primitive, p: Vec3, color: Color, extra: Partial<MaterialSpec> = {}, rotation: Vec3 = [0, 0, 0], id?: string): string {
    const key = id ?? `${this.root.id.slice(0, 125)}:${this.serial++}`;
    this.entities.push({ id: key, position: this.p(p), rotation: [rotation[0], rotation[1] + this.root.rotation, rotation[2]], renderOnly: true, mesh,
      material: { color, roughness: .57, clearcoat: .08, clearcoatRoughness: .40, ...(color===P.oak||color===P.wood?{kind:'wood' as const,texture:{url:'/assets/materials/oak.png',sizeM:2,bumpStrength:.08,albedoStrength:.35},roughness:.68}:{}), ...extra } });
    return key;
  }
  box(p: Vec3, size: Vec3, color: Color, extra: Partial<MaterialSpec> = {}, rounded = false, rotation: Vec3 = [0, 0, 0], id?: string) {
    return this.part(rounded ? roundedBox(size, Math.min(.13, size[1] * .25)) : { kind: 'box', size }, p, color, extra, rotation, id);
  }
  cylinder(p: Vec3, radius: number, height: number, color: Color, extra: Partial<MaterialSpec> = {}, rotation: Vec3 = [0, 0, 0], topRadius?: number, id?: string) {
    return this.part({ kind: 'cylinder', radius, height, segments: 16, ...(topRadius === undefined ? {} : { topRadius }) }, p, color, extra, rotation, id);
  }
  ball(p: Vec3, radius: number, color: Color, scale: Vec3 = [1, 1, 1]) {
    const id = this.part({ kind: 'sphere', radius, segments: 12 }, p, color);
    this.entities.at(-1)!.scale = scale; return id;
  }
  lamp(p: Vec3, intensity = 12, color: Vec3 = [1, .87, .67]) {
    this.entities.push({ id: `${this.root.id}:lamp:${this.serial++}`, position: this.p([p[0],Math.min(p[1],this.ceilingHeight),p[2]]), renderOnly: true, light: { kind: 'point', intensity, range: 8, color } });
  }
  plant(p: Vec3, size = 1, pot: Color = P.paper, flowering = false) {
    const [x, y, z] = p;
    this.cylinder([x, y + .25 * size, z], .31 * size, .47 * size, pot, {}, [0, 0, 0], .38 * size);
    this.cylinder([x, y + .50 * size, z], .31 * size, .025 * size, P.wood);
    this.cylinder([x, y + .80 * size, z], .045 * size, .63 * size, P.leaf);
    for (let i = 0; i < 7; i++) {
      const angle = i * 2.4, yy = y + (.77 + i * .067) * size;
      this.ball([x + Math.cos(angle) * .25 * size, yy, z + Math.sin(angle) * .25 * size], .20 * size, i % 2 ? P.leaf : P.mint, [1.4, .47, .75]);
      if (flowering && i > 3) this.ball([x + Math.cos(angle) * .29 * size, yy + .12 * size, z + Math.sin(angle) * .29 * size], .10 * size, i % 2 ? P.coral : P.gold);
    }
    this.ball([x, y + 1.30 * size, z], .25 * size, P.lime, [.80, 1.5, .65]);
  }
  chair(p: Vec3, color: Color, rotation = 0, scale = 1) {
    const [x, y, z] = p;
    const at = (dx: number, yy: number, dz: number): Vec3 => [x + (Math.cos(rotation) * dx + Math.sin(rotation) * dz) * scale, y + yy * scale, z + (-Math.sin(rotation) * dx + Math.cos(rotation) * dz) * scale];
    this.box(at(0, .58, 0), [.77 * scale, .18 * scale, .73 * scale], color, {}, true, [0, rotation, 0]);
    this.box(at(0, .93, .31), [.75 * scale, .66 * scale, .18 * scale], color, {}, true, [0, rotation, -.03]);
    this.cylinder(at(0, .30, 0), .075 * scale, .42 * scale, P.steel);
    for (let i = 0; i < 5; i++) {
      const a = i * Math.PI * 2 / 5;
      this.box(at(Math.sin(a) * .20, .11, Math.cos(a) * .20), [.065 * scale, .065 * scale, .47 * scale], P.ink, {}, false, [0, rotation + a, 0]);
      this.ball(at(Math.sin(a) * .39, .08, Math.cos(a) * .39), .06 * scale, P.ink);
    }
    for (const d of [-1, 1]) {
      this.box(at(d * .43, .77, 0), [.07 * scale, .08 * scale, .43 * scale], P.ink, {}, true, [0, rotation, 0]);
      this.box(at(d * .43, .64, .08), [.055 * scale, .23 * scale, .07 * scale], P.ink, {}, false, [0, rotation, 0]);
    }
  }
  mug(p: Vec3, color = P.coral) {
    this.cylinder(p, .10, .17, color);
    this.cylinder([p[0], p[1] + .09, p[2]], .08, .014, P.wood);
    this.part({ kind: 'torus', radius: .082, tube: .023, segments: 12 }, [p[0] + .10, p[1], p[2]], color, {}, [Math.PI / 2, 0, 0]);
  }
  monitor(p: Vec3, width = 1.12, accent: Color = P.sky) {
    const [x, y, z] = p;
    this.box([x, y + .43, z], [width, .70, .105], P.ink, {}, true);
    this.box([x, y + .43, z + .058], [width - .10, .59, .016], [.13, .26, .33, 1], { emissive: [.015, .042, .050], roughness: .18 });
    for (let i = 0; i < 5; i++) this.box([x - width * .31 + i * .035, y + .57 - i * .078, z + .069], [width * (.35 + i % 3 * .1), .019, .004], i % 3 ? accent : P.gold, { emissive: [.015, .025, .023] });
    this.box([x, y + .10, z], [.09, .22, .10], P.steel);
    this.box([x, y, z + .04], [.40, .045, .26], P.ink, {}, true);
  }
}

export function architecture(k: ToyKit, wallpaper: string, includeElevator = true, placement?:OfficeState['placement']) {
  const wall = colorOf(wallpaper, P.paper);
  // A floating architectural model, with a warm timber lip and a slate foundation.
  const platform=(y:number,size:Vec3,color:Color,rounded=false)=>{
    if(includeElevator){k.box([0,y,0],size,color,{},rounded);return;}
    const rear=-size[2]/2,front=size[2]/2,edge=-8.10,half=size[0]/2,sideWidth=half-1.85;
    k.box([0,y,(edge+front)/2],[size[0],size[1],front-edge],color,{},rounded);
    for(const side of [-1,1])k.box([side*(1.85+sideWidth/2),y,(rear+edge)/2],[sideWidth,size[1],edge-rear],color,{},rounded);
  };
  const width=placement?.width??28,depth=placement?.depth??20;
  if(placement)k.box([0,.035,0],[width,.02,depth],P.tile);
  else{platform(-.54,[28.7,.52,20.7],P.ink,true);platform(-.24,[28.4,.28,20.4],P.oak,true);platform(-.055,[28,.10,20],P.tile);}
  for (let x = -width/2+.5; x < width/2; x++) for (let z = -depth/2+.5; z < depth/2; z++) {
    if(x+.4875>width/2||z+.4875>depth/2)continue;
    if(!placement&&!includeElevator&&Math.abs(x)-.4875<1.85&&z-.4875<-8.10)continue;
    const variation: Color = ((Math.round(x * 2 + z * 3) % 7 + 7) % 7 === 0) ? P.paper : [.76, .76, .70, 1];
    k.box([x, placement?.05:.006, z], [.975, placement?.01:.015, .975], variation);
  }
  // The server-owned WorldLayer draws the working lift in a connected world.
  if (includeElevator) {
  k.box([0, 1.55, -9.15], [3.75, 3.15, 1.28], P.ink, {}, true);
  k.box([0, 1.55, -8.49], [3.25, 2.68, .07], P.steel, { metalness: .55, roughness: .25 });
  for (const x of [-.72, .72]) {
    k.box([x, 1.52, -8.43], [1.38, 2.50, .075], P.teal, { clearcoat: .45 }, true);
    k.box([x + .27, 1.56, -8.37], [.045, 2.22, .012], P.mint);
  }
  k.box([0, 2.96, -8.43], [2.12, .24, .095], P.gold, { label: 'E L E V A T O R', labelColor: [.13, .23, .25] }, true);
  k.box([0, .055, -7.90], [3.7, .04, .85], P.ink, {}, true);
  k.box([1.88, 1.35, -8.43], [.20, .45, .10], P.paper, {}, true);
  k.ball([1.89, 1.38, -8.34], .053, P.gold);
  }
  k.lamp([0, 3.4, -7.4], 16);
  k.plant([-2.65, .035, -8.5], 1.38, P.peach);
  k.plant([2.65, .035, -8.5], 1.38, P.paper);
  // A small maker's plate on the model's front fascia.
  if(!placement)k.box([0, -.32, 10.26], [5.8, .24, .04], P.ink, { label: 'THE ENGINE  /  AGENT OFFICE', labelColor: [.75, .88, .84] });
  for (const x of [-11, 11]) k.lamp([x, 5, 2], 24);
}

function kitchen(k: ToyKit, b: Bounds) {
  const w = Math.max(.7,Math.min(b.width - 1.25, 5.6)), z = -b.depth / 2 + .65;
  k.box([0, .54, z], [w, 1.05, .93], P.mint, {}, true);
  k.box([0, 1.10, z], [w + .10, .13, 1.04], P.paper, {}, true);
  for (let i = 0; i < 4; i++) {
    const x = -w / 2 + (i + .5) * w / 4;
    k.box([x, .63, z + .475], [w / 4 - .08, .68, .035], i % 2 ? P.teal : P.mint, {}, true);
    k.box([x, .81, z + .51], [.26, .045, .025], P.paper, {}, true);
  }
  k.box([-w / 2 + .6, 1.20, z], [.77, .055, .54], P.steel, { metalness: .45 });
  k.box([-w / 2 + .6, 1.24, z], [.62, .035, .38], P.ink);
  k.part({ kind: 'torus', radius: .20, tube: .045, segments: 12 }, [-w / 2 + .61, 1.47, z - .29], P.steel, { metalness: .55 }, [Math.PI / 2, 0, 0]);
  k.box([w / 2 - .7, 1.41, z], [.65, .57, .58], P.ink, {}, true);
  k.box([w / 2 - .7, 1.41, z + .30], [.38, .24, .014], P.peach);
  k.mug([w / 2 - .7, 1.2, z + .32], P.gold);
  k.box([0, 2.09, z - .39], [w, .12, .36], P.oak, {}, true);
  for (let i = 0; i < 6; i++) k.cylinder([-w*.4 + i * w*.16, 2.27, z - .39], .11, .23, [P.gold, P.coral, P.paper][i % 3]!);
  k.plant([w / 2 - .25, 2.18, z - .39], .42, P.paper);
  const fridge=-b.width/2+.4;
  k.box([fridge, 1.22, z], [.64, 2.38, 1.0], P.paper, {}, true);
  k.box([fridge, 1.84, z + .515], [.56, .96, .028], P.sky, {}, true);
  k.box([fridge, .65, z + .515], [.56, 1.24, .028], P.sky, {}, true);
  k.box([fridge+.21, 1.72, z + .54], [.045, .4, .04], P.ink, {}, true);
  k.box([0, 2.56, z - .50], [2.5, .30, .07], P.teal, { label: 'K I T C H E N', labelColor: [.93, .90, .78] }, true);
  k.lamp([0, 3.4, 0], 13);
}

function drawRoom(k: ToyKit, o: OfficeObject, b: Bounds, c: Color) {
  k.box([0, .026, 0], [b.width, .035, b.depth], c, { roughness: .76 }, true);
  for (const d of [-1, 1]) {
    k.box([0, .05, d * (b.depth / 2 - .12)], [b.width - .24, .022, .035], P.paper);
    k.box([d * (b.width / 2 - .12), .05, 0], [.035, .022, b.depth - .24], P.paper);
  }
  const label = o.label || 'WORKSPACE';
  if (/кух|kitchen|cafe/i.test(label)) {
    // Side-facing cabinetry leaves the central elevator landing unobstructed.
    kitchen(k,b);
  }
  else if (/переговор|meeting/i.test(label)) {
    const z = -b.depth / 2 + .1;
    k.box([0, 1.82, z + .09], [Math.min(2.8, b.width - .5), 1.27, .055], P.paper, {}, true);
    for (let i = 0; i < 4; i++) k.box([-.83 + i * .53, 1.79 + Math.sin(i) * .23, z + .125], [.33, .27, .01], [P.gold, P.coral, P.mint, P.sky][i]!);
    k.box([0, 2.58, z + .08], [Math.min(3.2, b.width - .3), .27, .04], P.ink, { label: 'MEETING ROOM', labelColor: [.89, .88, .76] });
    k.lamp([0, 3.9, 0], 12);
  } else if (/лаунж|lounge|отдых/i.test(label)) {
    k.box([b.width / 2 - .28, 1.08, 0], [.38, 2.12, Math.min(2.6, b.depth - .5)], P.oak, {}, true);
    for (let j = 0; j < 3; j++) for (let i = 0; i < 5; i++) k.box([b.width / 2 - .50, .44 + j * .64, -1.1 + i * .49], [.075, .40 + (i % 3) * .06, .22], [P.coral, P.teal, P.paper, P.gold, P.lilac][i]!, {}, true);
    k.cylinder([b.width / 2 - .6, 1.36, -b.depth / 2 + .6], .052, 2.54, P.ink);
    k.cylinder([b.width / 2 - .6, 2.56, -b.depth / 2 + .6], .42, .37, P.paper, {}, [0, 0, 0], .26);
    k.cylinder([b.width / 2 - .6, .11, -b.depth / 2 + .6], .37, .15, P.ink);
    k.lamp([b.width / 2 - .6, 2.37, -b.depth / 2 + .6], 8);
  } else if (/сервер|server/i.test(label)) {
    k.box([0, .04, 0], [b.width - .4, .028, b.depth - .4], P.slate, {}, true);
    for (let i = 0; i < 5; i++) k.box([0, .06, -b.depth / 2 + .55 + i * .4], [b.width - .7, .01, .016], P.sky);
  }
}

export function drawOfficeObject(k: ToyKit, o: OfficeObject, resolved?:Bounds) {
  const b = resolved??objectBounds(o), color = colorOf(o.color, { desk: P.paper, chair: P.teal, plant: P.paper, sofa: P.coral, table: P.oak, corridor: P.mint, room: P.sky, wall: P.paper, window: P.sky, door: P.oak, server: P.ink }[o.kind]);
  const firstEntity = k.entities.length;
  k.bounds.push(b);
  k.scope(`object/${o.id}`, b.x, b.z, b.rotation, () => {
    switch (o.kind) {
      case 'desk': {
        k.box([0, .92, 0], [b.width, .16, b.depth], color, {}, true);
        for (const dx of [-b.width * .40, b.width * .40]) for (const dz of [-b.depth * .35, b.depth * .35]) k.box([dx, .45, dz], [.105, .84, .105], P.paper, {}, true);
        k.box([b.width * .34, .47, -.03], [.49, .74, Math.max(.45, b.depth - .15)], P.mint, {}, true);
        for (let i = 0; i < 3; i++) { k.box([b.width * .34, .28 + i * .23, b.depth / 2 - .05], [.41, .17, .014], P.teal, {}, true); k.box([b.width * .34, .29 + i * .23, b.depth / 2 - .038], [.16, .027, .017], P.paper); }
        k.monitor([-.22, 1.025, -b.depth * .22], Math.min(1.22, b.width * .49));
        k.box([-.18, 1.024, b.depth * .24], [.71, .037, .22], P.slate, {}, true);
        for (let i = 0; i < 8; i++) k.box([-.47 + i * .08, 1.045, b.depth * .24], [.048, .006, .13], P.paper);
        k.box([.36, 1.026, b.depth * .27], [.18, .041, .23], P.sky, {}, true);
        k.mug([b.width * .35, 1.11, b.depth * .25], P.gold);
        k.box([-b.width * .38, 1.035, b.depth * .10], [.33, .04, .40], P.coral, {}, true);
        k.plant([-b.width * .38, 1.05, -b.depth * .26], .29, P.paper); break;
      }
      case 'chair': k.chair([0, 0, 0], color, 0, Math.min(b.width / .9, b.depth / .9)); break;
      case 'plant': k.plant([0, .035, 0], Math.min(1.2, Math.max(.55, b.width)), color, /цвет|flower/i.test(o.label)); break;
      case 'sofa': {
        k.box([0, .31, 0], [b.width, .40, b.depth], P.oak, {}, true);
        k.box([0, .61, 0], [b.width - .24, .37, b.depth - .10], color, { roughness: .8 }, true);
        k.box([0, .98, -b.depth * .37], [b.width, .84, .31], color, { roughness: .8 }, true);
        for (const dx of [-b.width / 2 + .12, b.width / 2 - .12]) k.box([dx, .78, 0], [.28, .68, b.depth], color, { roughness: .8 }, true);
        for (let i = 0; i < 3; i++) k.box([(-1 + i) * (b.width - .65) / 3, .79, .04], [(b.width - .65) / 3 - .03, .07, b.depth * .68], color, { roughness: .8 }, true);
        for (const dx of [-b.width * .33, b.width * .33]) k.box([dx, 1.01, -b.depth * .16], [.44, .48, .18], dx < 0 ? P.peach : P.gold, {}, true, [0, 0, dx < 0 ? .12 : -.12]); break;
      }
      case 'table': {
        k.box([0, .88, 0], [b.width, .15, b.depth], color, {}, true);
        for (const dx of [-b.width * .34, b.width * .34]) k.box([dx, .45, 0], [.15, .77, b.depth * .59], P.paper, {}, true);
        k.plant([0, .98, 0], .34, P.paper);
        for (const side of [-1, 1]) {
          k.box([side * b.width * .27, .97, .09], [.55, .04, .42], P.ink, {}, true);
          k.box([side * b.width * .27, 1.12, -.09], [.55, .29, .026], P.sky, { roughness: .18 }, true, [-.2, 0, 0]);
          k.mug([side * b.width * .36, 1.055, b.depth * .27], side < 0 ? P.coral : P.teal);
        } break;
      }
      case 'room': drawRoom(k, o, b, color); break;
      case 'corridor': {
        if ((o as OfficeObject & {shape?:string}).shape === 'ring') {
          const rx = b.width / 2, rz = b.depth / 2, thickness = Math.min(1.15, Math.min(rx, rz) * .36), n = 64;
          const positions: number[] = [], normals: number[] = [], indices: number[] = [];
          for (let i = 0; i <= n; i++) {
            const a = i * Math.PI * 2 / n;
            for (const outer of [true, false]) {
              positions.push(Math.cos(a) * (outer ? rx : rx - thickness), .047, Math.sin(a) * (outer ? rz : rz - thickness)); normals.push(0, 1, 0);
            }
            if (i < n) { const v = i * 2; indices.push(v, v + 1, v + 2, v + 1, v + 3, v + 2); }
            if (i % 4 === 0 && i < n) {
              const aa = a + .07, x = Math.cos(aa) * (rx - thickness / 2), z = Math.sin(aa) * (rz - thickness / 2);
              k.box([x, .071, z], [.30, .018, .065], P.gold, {}, true, [0, -aa + Math.PI / 2, 0]);
            }
          }
          k.part({ kind: 'triangle-mesh', positions, normals, indices }, [0, 0, 0], color, { roughness: .68 });
          k.cylinder([0, .075, 0], Math.min(rx - thickness - .18, rz - thickness - .18), .10, P.mint);
          k.cylinder([0, .11, 0], Math.min(rx - thickness - .30, rz - thickness - .30), .075, P.paper);
          k.plant([0, .16, -.36], 1.42, P.peach, true);
          for (const side of [-1, 1]) {
            k.cylinder([side * .90, .25, .62], .40, .40, side < 0 ? P.lilac : P.gold);
            k.cylinder([side * .90, .47, .62], .41, .13, side < 0 ? P.lilac : P.gold);
          }
          break;
        }
        k.box([0, .038, 0], [b.width, .06, b.depth], color, { roughness: .72 }, true);
        for (const side of [-1, 1]) k.box([0, .079, side * (b.depth / 2 - .16)], [b.width - .15, .008, .035], P.paper);
        for (let x = -b.width / 2 + .7; x < b.width / 2 - .3; x += 1.2) k.box([x, .079, 0], [.30, .008, .075], P.gold);
        break;
      }
      case 'wall': {
        k.box([0, 1.42, 0], [b.width, 2.8, b.depth], color, { roughness: .73 }, true);
        k.box([0, .20, b.depth / 2 + .01], [b.width, .19, .06], P.paper);
        k.box([0, 2.84, 0], [b.width + .04, .11, b.depth + .07], P.paper, {}, true);
        // Material-only wallpaper pattern; geometry keeps stable ownership.
        for (let x = -b.width / 2 + .28; x < b.width / 2; x += .55) k.box([x, 1.42, b.depth / 2 + .015], [.018, 2.46, .008], P.paper);
        break;
      }
      case 'window': {
        k.box([0, 1.58, 0], [b.width, 2.1, Math.max(.045, b.depth * .35)], P.glass, { kind: 'glass', roughness: .07 });
        for (const dx of [-b.width / 2, 0, b.width / 2]) k.box([dx, 1.56, 0], [.065, 2.25, b.depth], color);
        for (const y of [.42, 2.72]) k.box([0, y, 0], [b.width + .13, .10, b.depth + .1], color, {}, true);
        k.box([0, .41, .10], [b.width + .16, .09, .44], P.paper, {}, true); break;
      }
      case 'door': {
        for (const dx of [-b.width / 2, b.width / 2]) k.box([dx, 1.38, 0], [.12, 2.74, b.depth], color, {}, true);
        k.box([0, 2.75, 0], [b.width + .12, .14, b.depth + .04], color, {}, true);
        k.box([b.width * .36, 1.2, 0], [.11, .17, .13], P.gold, { metalness: .5 }, true);
        k.box([0, .046, 0], [b.width, .045, b.depth + .2], P.oak); break;
      }
      case 'aquarium': {
        const w=b.width,d=b.depth,h=b.height,y=.72;
        k.box([0,.36,0],[w,.67,d],P.oak,{kind:'wood',pattern:'plaster'},true);
        k.box([0,y,0],[w+.08,.10,d+.08],P.ink,{},true);
        k.box([0,y+.12,0],[w-.1,.15,d-.1],P.cream,{pattern:'plaster'});
        for(const side of [-1,1]){k.box([0,(y+h)/2,side*d/2],[w,h-y,.035],P.glass,{kind:'glass',roughness:.04});k.box([side*w/2,(y+h)/2,0],[.035,h-y,d],P.glass,{kind:'glass',roughness:.04});}
        for(const yy of [y,h])k.box([0,yy,0],[w+.06,.065,d+.06],P.ink);
        k.box([0,h-.08,0],[w-.08,.014,d-.08],[.22,.64,.70,.16],{kind:'glass',roughness:.10});
        k.box([0,.4,d/2+.012],[w*.65,.14,.025],P.oak,{label:'A Q U A R I U M',labelColor:[.2,.3,.24]});
        for(let i=0;i<4;i++){const x=-w*.35+i*w*.23;k.plant([x,y+.1,-d*.22],.35,P.wood);}
        for(let i=0;i<(o.fish??6);i++){
          const x=Math.sin(i*2.4)*w*.30,yy=y+.24+(i%3)/2*(h-y-.48),z=Math.cos(i*2.4)*d*.27;
          const id=k.ball([x,yy,z],.10,i%2?P.gold:P.coral,[1.7,.8,.55]);k.entities.at(-1)!.id='fish:'+o.id+':'+i;
        }
        break;
      }
      case 'pet': {
        const dog=o.species==='dog',size=dog?1.3:1;
        k.ball([0,.37*size,0],.28*size,color,[1.3,.8,.7]);
        k.ball([.27*size,.47*size,0],.19*size,color,[.95,1,1]);
        for(const side of [-1,1]){
          k.cylinder([.27*size,.65*size,side*.10*size],.08*size,.17*size,color,{},[0,0,side*.22],dog?.075:0);
          k.ball([.44*size,.51*size,side*.068*size],.028*size,P.ink);
          for(const x of [-.18,.19])k.box([x*size,.16*size,side*.14*size],[.09*size,.26*size,.09*size],color,{},true);
        }
        k.ball([.48*size,.44*size,0],.04*size,P.peach);
        k.cylinder([-.33*size,.46*size,0],.048*size,.45*size,color,{},[0,0,-.70]);
        k.cylinder([.7,.08,.38],.23,.12,P.steel);
        k.cylinder([.7,.145,.38],.18,.015,P.ink);
        break;
      }
      case 'beanbag': {
        k.ball([0,.38,0],.68,color,[b.width/1.36,.63,b.depth/1.36]);
        k.ball([0,.58,-b.depth*.22],.51,color,[b.width/1.05,.70,.58]);
        k.ball([0,.51,b.depth*.12],.44,P.cream,[b.width/1.05,.25,.84]);
        break;
      }
      case 'kitchen': kitchen(k,b); break;
      case 'server': {
        k.box([0, 1.10, 0], [b.width, 2.12, b.depth], color, { roughness: .3 }, true);
        k.box([0, 1.11, b.depth / 2 + .018], [b.width - .16, 1.92, .03], P.slate);
        for (let i = 0; i < 8; i++) {
          k.box([0, .26 + i * .24, b.depth / 2 + .04], [b.width - .25, .17, .035], P.ink, {}, true);
          k.ball([b.width * .32, .26 + i * .24, b.depth / 2 + .065], .027, i % 3 ? P.mint : P.gold);
          for (let j = 0; j < 4; j++) k.box([-b.width * .32 + j * .10, .26 + i * .24, b.depth / 2 + .062], [.048, .085, .005], P.steel);
        } break;
      }
      default: k.box([0, .5, 0], [b.width, 1, b.depth], color, {}, true);
    }
  });
  if (o.height !== undefined && !['aquarium','room','corridor'].includes(o.kind)) {
    const {height: authoredHeight, ...naturalObject} = o;
    const naturalHeight = objectBounds(naturalObject).height, ratio = authoredHeight / naturalHeight;
    for (const entity of k.entities.slice(firstEntity)) {
      if (entity.position) entity.position = [entity.position[0], entity.position[1] * ratio, entity.position[2]];
      entity.scale = [entity.scale?.[0] ?? 1, (entity.scale?.[1] ?? 1) * ratio, entity.scale?.[2] ?? 1];
    }
  }
  const presets:Record<string,Partial<MaterialSpec>>={oak:{kind:'wood',texture:{url:'/assets/materials/oak.png',sizeM:2,bumpStrength:.08,albedoStrength:.5},roughness:.72},plaster:{pattern:'plaster',roughness:.88},linen:{pattern:'fabric',texture:{url:'/assets/materials/linen.png',sizeM:.7,bumpStrength:.12,albedoStrength:.18},roughness:.92},glass:{kind:'glass',roughness:.045},ceramic:{clearcoat:.6,roughness:.2},concrete:{kind:'concrete',pattern:'plaster',roughness:.94}};
  if(o.material)for(const entity of k.entities.slice(firstEntity))if(entity.mesh&&entity.material?.kind!=='glass'&&!entity.material?.label)entity.material={...entity.material,...presets[o.material]};
}

export function drawActor(k: ToyKit, id: string, index: number): ActorDrawing {
  const parts: ActorPart[] = [], color = [P.teal, P.coral, P.blue, P.violet, P.gold, P.mint][index % 6] ?? P.teal, root = `actor/${id}`.slice(0, 125);
  k.scope(root, 0, 0, 0, () => {
    const part = (mesh: Primitive, p: Vec3, c: Color, limb?: number, scale?: Vec3) => {
      const key = k.part(mesh, p, c);
      if (scale) k.entities.at(-1)!.scale = scale;
      parts.push({ id: key, offset: p, rotation: [0, 0, 0], ...(limb === undefined ? {} : { limb }) });
    };
    const box = (p: Vec3, s: Vec3, c: Color, limb?: number) => part(roundedBox(s, .08), p, c, limb);
    for (const side of [-1, 1]) {
      box([side * .17, .31, 0], [.24, .49, .30], P.ink, side);
      box([side * .17, .09, .07], [.29, .15, .39], P.paper, side);
      box([side * .43, .91, 0], [.19, .47, .23], color, -side * 2);
      part({ kind: 'sphere', radius: .13, segments: 10 }, [side * .43, .64, .03], P.skin, -side * 2);
    }
    box([0, .90, 0], [.69, .65, .37], color);
    box([0, 1.19, .05], [.16, .06, .22], P.paper);
    part({ kind: 'sphere', radius: .31, segments: 16 }, [0, 1.51, .02], P.skin, undefined, [1, 1.06, 1]);
    part({ kind: 'sphere', radius: .32, segments: 12 }, [0, 1.70, -.03], index % 2 ? P.wood : P.ink, undefined, [1, .52, 1]);
    for (const side of [-1, 1]) part({ kind: 'sphere', radius: .029, segments: 8 }, [side * .115, 1.55, .31], P.ink);
    box([0, 1.41, .315], [.11, .017, .017], P.wood);
    box([0, .96, .195], [.14, .17, .023], P.paper);
    const prop=(kind:'phone'|'coffee'|'tool'|'crate',draw:()=>void)=>{const start=parts.length;draw();for(const p of parts.slice(start)){p.prop=kind;const e=k.entities.find(e=>e.id===p.id)!;e.renderVisible=false;}};
    prop('tool',()=>{
      box([.38,1.04,.29],[.065,.35,.065],P.wood);
      box([.38,1.20,.29],[.23,.105,.12],P.steel);
    });
    prop('crate',()=>{
      box([0,.85,.58],[.56,.40,.38],P.oak);
      for(const x of [-.20,.20])box([x,.85,.78],[.045,.43,.024],P.wood);
    });
    prop('phone',()=>{
      box([.27,1.11,.34],[.17,.28,.038],P.ink);
      box([.27,1.12,.365],[.139,.223,.007],P.slate);
      for(let i=0;i<5;i++)box([.25+(i%2)*.01,1.20-i*.036,.372],[.08-i%3*.014,.012,.005],i%2?P.mint:P.sky);
    });
    prop('coffee',()=>{
      part({kind:'cylinder',radius:.075,height:.14,segments:12},[.38,1.10,.24],P.paper);
      part({kind:'cylinder',radius:.063,height:.007,segments:12},[.38,1.173,.24],P.wood);
      part({kind:'torus',radius:.049,tube:.014,segments:12},[.47,1.10,.24],P.paper);
      parts.at(-1)!.rotation=[Math.PI/2,0,0];
    });
  });
  const marker = k.part({ kind: 'torus', radius: .58, tube: .035, segments: 24 }, [0, .058, 0], color, { emissive: [.02, .04, .03] }, [0, 0, 0], root + ':marker');
  parts.push({ id: marker, offset: [0, .058, 0], rotation: [0, 0, 0] });
  return { id, parts, marker };
}

function drawWall(k:ToyKit,wall:Wall,layout:OfficeLayout){
  const color=colorOf(wall.color,P.paper),cap=wall.glass?P.paper:P.cream;
  k.scope(wall.id,wall.x,wall.z,wall.rotation,()=>{
    for(const solid of layout.solids.filter(s=>s.wallId===wall.id)){
      const dx=solid.x-wall.x,dz=solid.z-wall.z,x=Math.cos(wall.rotation)*dx-Math.sin(wall.rotation)*dz;
      const bottom=solid.baseY??0,height=Math.min(solid.height,wall.visibleHeight-bottom);if(height<=0)continue;
      if(wall.glass&&bottom<.8&&height>.8){
        k.box([x,.40,0],[solid.width,.8,wall.depth],color,{roughness:.75});
        k.box([x,(height+.8)/2,0],[solid.width-.055,height-.8,.038],P.glass,{kind:'glass',roughness:.065});
        for(const side of [-1,1])k.box([x+side*(solid.width/2-.025),height/2,0],[.06,height,wall.depth+.06],P.paper);
      }else k.box([x,bottom+height/2,0],[solid.width,height,wall.depth],color,{roughness:.82,pattern:'plaster'});
      if(bottom===0){k.box([x,.065,.04],[solid.width,.13,wall.depth+.06],P.oak);k.box([x,wall.visibleHeight+.025,0],[solid.width,.07,wall.depth+.06],cap);}
    }
    for(const opening of wall.openings){
      if(opening.id==='shell:lift')continue;
      const x=opening.center,w=opening.width,y=opening.sill,h=opening.height,c=colorOf(opening.color,P.paper);
      if(opening.kind==='window'){
        k.box([x,y+h/2,0],[w-.08,h-.08,.035],P.glass,{kind:'glass',roughness:.055,clearcoat:.6});
        for(const side of [-1,1])k.box([x+side*w/2,y+h/2,0],[.075,h+.12,wall.depth+.06],c);
        for(const yy of [y,y+h])k.box([x,yy,0],[w+.13,.085,wall.depth+.07],c);
        k.box([x,y+h/2,0],[.055,h,wall.depth+.03],P.paper);
        k.box([x,y-.015,.09],[w+.17,.075,.42],P.paper);
      }else{
        for(const side of [-1,1])k.box([x+side*w/2,h/2,0],[.09,h,wall.depth+.08],P.oak);
        k.box([x,h,0],[w+.15,.12,wall.depth+.08],P.oak);
        k.box([x,.035,0],[w-.1,.035,.42],P.cream);
      }
    }
  });
}

function drawPassage(k:ToyKit,b:Bounds){
  k.scope(b.id,b.x,b.z,b.rotation,()=>{
    k.box([0,.04,0],[b.width,.042,b.depth],P.cream,{roughness:.8});
    for(const side of [-1,1])k.box([0,.065,side*(b.depth/2-.07)],[b.width,.014,.025],P.oak);
  });
}

export function compileOffice(state: OfficeState, drawings: { id: string; index: number }[], options: {elevator?:boolean;cutaway?:boolean;movableObjects?:readonly string[];removedWalls?:readonly string[];construction?:boolean;fedPets?:readonly string[]} = {}): { spec: SceneSpec; actors: ActorDrawing[]; bounds: Bounds[]; movers: string[];layout:OfficeLayout;decor:{id:string;position:Vec3;rotation:Vec3;objectId:string;kind:string;index:number}[] } {
  const k = new ToyKit(), floor = state.floors.find(f => f.id === state.activeFloor),layout=buildOfficeLayout(state);
  if(state.placement)k.ceilingHeight=state.placement.floorHeight-.22;
  architecture(k, floor?.wallpaper ?? 'ivory', state.placement?false:options.elevator ?? true,state.placement);
  // Layer floor patches beneath furniture independent of the backend's item order.
  const objects = state.objects.filter(o => o.floor === state.activeFloor);
  for (const o of objects.filter(o => o.kind === 'room'||o.kind==='corridor'&&o.shape==='ring')) drawOfficeObject(k,o,layout.objects.get(o.id));
  for(const passage of layout.corridors.filter(c=>c.kind!=='ring'))drawPassage(k,passage);
  for(const wall of layout.walls){
    if(options.removedWalls?.includes(wall.id))continue;
    const owner=objects.find(o=>o.id===wall.ownerId);
    drawWall(k,{...wall,...(options.cutaway===false?{visibleHeight:wall.height}:{}),glass:wall.glass||owner?.material==='glass'},layout);
  }
  for (const o of objects.filter(o => !['room','corridor','wall','window','door'].includes(o.kind))) drawOfficeObject(k,o,layout.objects.get(o.id));
  for(const o of objects.filter(o=>o.kind==='pet'&&options.fedPets?.includes(o.id))){
    const b=layout.objects.get(o.id)!;
    k.scope('pet-food/'+o.id,b.x,b.z,b.rotation,()=>{
      for(let i=0;i<9;i++)k.ball([.7+Math.sin(i*2.4)*.12,.17,.38+Math.cos(i*2.4)*.12],.037,P.oak);
    });
  }
  for(const o of objects.filter(o=>['corridor','wall','window','door'].includes(o.kind)))k.bounds.push(layout.objects.get(o.id)!);
  if(options.construction){
    k.scope('construction-stock',-11.76,8.1,0,()=>{
      k.box([0,.08,0],[1.1,.12,1.0],P.wood);
      for(let i=0;i<3;i++)k.box([(i%2-.5)*.42,.29+Math.floor(i/2)*.34,0],[.4,.3,.5],P.oak);
    });
  }
  const actors = drawings.map(a => drawActor(k, a.id, a.index));
  const selection: string[] = [];
  for (let i = 0; i < 4; i++){selection.push(k.box([0, .104, 0], [1, .025, .042], P.gold, { emissive: [.17, .11, .02] }, false, [0, 0, 0], `selection:${i}`));k.entities.at(-1)!.renderVisible=false;}
  const decor=k.entities.filter(e=>e.mesh&&(e.id.startsWith('fish:')||objects.some(o=>o.kind==='pet'&&e.id.startsWith('object/'+o.id+':')))).map((e,index)=>({id:e.id,position:[...e.position!] as Vec3,rotation:[...(e.rotation??[0,0,0])] as Vec3,objectId:objects.find(o=>e.id.startsWith('fish:'+o.id+':')||e.id.startsWith('object/'+o.id+':'))!.id,kind:e.id.startsWith('fish:')?'fish':'pet',index}));
  const movable=k.entities.filter(e=>options.movableObjects?.some(id=>e.id.startsWith('object/'+id+':')||e.id.startsWith('fish:'+id+':')||e.id.startsWith('room/'+id+':')||e.id.startsWith('object/'+id+':wall:'))).map(e=>e.id);
  const movers = [...new Set([...movable,...k.entities.filter(e=>e.id.startsWith('pet-food/')).map(e=>e.id),...decor.map(d=>d.id),...actors.flatMap(a => a.parts.map(p => p.id)), ...selection])], moving = new Set(movers);
  const entities = batchStaticScenery(k.entities, e => !!e.mesh && !moving.has(e.id), 16).map(e => ({ ...e, renderOnly: true }));
  return { actors,decor, bounds: k.bounds, movers,layout, spec: {
    version: 1, seed: 9208765, ground: -1, entities,
    clearColor: [.085, .11, .12, 1],
    environment: { temperatureC: 22, humidity: .42, wind: [0, 0, 0], sunlight: .88, groundMoisture: 0, precipitation: 'arid', snowfall: 'none' },
    rendering: { sunDirection: [-.47, .83, .30], sunColor: [1, .91, .79], sunIntensity: 1.40, skyColor: [.40, .58, .65], ambientIrradiance: [.22, .27, .28], backgroundColor: [.066, .095, .135], exposure: .87, fogDensity: 0, shadowExtent: 34 },
    camera: { position: [29, 30, 33], target: [0, .1, 0], fov: 39, aperture: 0 },
  } };
}



