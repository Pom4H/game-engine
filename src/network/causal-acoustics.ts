/** Original Game causal acoustic validation, definition partition and blend. */
export type Sound=[id:string,rpm:number,load:number,tires:number[][],gear:number,startTick:number];
type Entity={id:string;x:number;y:number;z:number;yaw:number;vx:number;vy:number;vz:number;phase:number;animation:string;q?:number[];extra?:Record<string,unknown>};
const finite=(v:unknown):number=>{if(typeof v!=='number'||!Number.isFinite(v))throw TypeError('Expected finite number');return v;};
const integer=(v:unknown):number=>{const n=finite(v);if(!Number.isInteger(n)||n<0||n>0xffffffff)throw TypeError('Expected uint32');return n;};
const dynamicKeys = new Set(('flight wheels doorAngles doors steer contacts jounce engineRunning handbrake burnout grounded crouch lookYaw pitch alive '+
 'boarding lift phase strike strikeSerial strikeTime stun impulseX impulseZ speed points tool').split(' '));
export const causalPoseKeys = ['x', 'y', 'z', 'yaw', 'vx', 'vy', 'vz', 'phase'] as const;
const coreKeys = new Set<string>([...causalPoseKeys, 'animation', 'q', 'id', 'extra']);
export function validateCausalSound(value: unknown, id: string): Sound | null {
  if (value === null) return null;
  if (!Array.isArray(value) || value.length !== 6 || value[0] !== id || !/^vehicle:\d{1,6}$/.test(id)) throw new TypeError('Invalid acoustic owner');
  const rpm = integer(value[1]), load = integer(value[2]), gear = finite(value[4]); integer(value[5]);
  if (rpm > 8000 || load > 100 || !Number.isInteger(gear) || gear < -1 || gear > 12 || !Array.isArray(value[3]) || value[3].length > 4) throw new TypeError('Invalid acoustic state');
  const seen = new Set<number>();
  for (const tire of value[3]) {
    if (!Array.isArray(tire) || tire.length !== 6) throw new TypeError('Invalid tire tuple');
    const wheel = integer(tire[0]), material = integer(tire[1]);
    if (wheel > 3 || material > 255 || seen.has(wheel)) throw new TypeError('Invalid tire identity');
    seen.add(wheel);
    for (let i = 2; i < 6; i++) { const n = finite(tire[i]); if (n < 0 || n > (i === 2 ? 80 : i === 5 ? 100 : 40)) throw new TypeError('Invalid tire value'); }
  }
  return value as Sound;
}
export function splitCausalEntity(entity: Entity) {
  const root: Record<string, unknown> = {}, slow: Record<string, unknown> = {}, dynamic: Record<string, unknown> = {};
  const source = entity as unknown as Record<string, unknown>;
  for (const key of Object.keys(source)) if (!coreKeys.has(key) && source[key] !== undefined) root[key] = source[key];
  const extra = entity.extra;
  if (extra) for (const key of Object.keys(extra)) if (extra[key] !== undefined) (dynamicKeys.has(key) ? dynamic : slow)[key] = extra[key];
  // An absent extra bag stays absent after the round trip.
  root.hasExtra = entity.extra !== undefined;
  const core: unknown[] = [...causalPoseKeys.map(key => entity[key]), entity.animation, entity.q ?? null];
  return {root, slow, dynamic, core};
}

export function sampleCausalSound<T extends Sound>(selected:T,a:Sound|null|undefined,b:Sound|null|undefined,alpha:number,compatible:boolean):T{const sound=structuredClone(selected);if(a&&b&&a[5]===b[5]&&a[1]>0&&b[1]>0&&compatible){sound[1]=Math.round(a[1]+(b[1]-a[1])*alpha);sound[2]=Math.round(a[2]+(b[2]-a[2])*alpha);}return sound;}
export const causalDefinitionKey=(entity:Entity):string=>{const p=splitCausalEntity(entity);return JSON.stringify([p.root,p.slow]);};
