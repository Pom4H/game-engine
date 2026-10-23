export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | readonly JsonValue[] | {readonly [key:string]:JsonValue};

function stable(value: JsonValue): string {
  if (typeof value === 'number' && !Number.isFinite(value)) throw new TypeError('Blueprint numbers must be finite');
  if (value === null || typeof value !== 'object') return JSON.stringify(value) as string;
  if (Array.isArray(value)) return `[${value.map(item => stable(item)).join(',')}]`;
  const object = value as Readonly<Record<string,JsonValue>>;
  return `{${Object.keys(object).sort().map(key => `${JSON.stringify(key)}:${stable(object[key]!)}`).join(',')}}`;
}

/** Fast deterministic content identity; this is a cache/version digest, not a security hash. */
export function definitionDigest(value: JsonValue): string {
  const text = stable(value);
  let hash = 0xcbf29ce484222325n;
  for (let i=0;i<text.length;i++) { hash ^= BigInt(text.charCodeAt(i)); hash = BigInt.asUintN(64,hash * 0x100000001b3n); }
  return hash.toString(36).padStart(13,'0');
}

function cloneJson<T extends JsonValue>(value:T):T { return JSON.parse(stable(value)) as T; }
function deepFreeze<T>(value:T):T {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  if (Array.isArray(value)) for (const child of value) deepFreeze(child);
  else for (const child of Object.values(value as unknown as Record<string,unknown>)) deepFreeze(child);
  return value;
}

export interface BlueprintSource<TSpec extends JsonValue = JsonValue> {
  readonly id: string;
  readonly revision: number;
  readonly kind: string;
  readonly author: string;
  readonly spec: TSpec;
}
export interface CompiledBlueprint<TSpec extends JsonValue = JsonValue,TCompiled extends JsonValue = JsonValue> {
  readonly key: string;
  readonly id: string;
  readonly revision: number;
  readonly kind: string;
  readonly author: string;
  readonly digest: string;
  readonly spec: TSpec;
  readonly compiled: TCompiled;
}
export interface BlueprintRef { readonly key:string; readonly id:string; readonly revision:number; readonly digest:string }

/**
 * Published definitions are immutable shared values. Ten thousand physical cars may
 * reference one compiled design instead of copying engine/body/audio/production data.
 */
export class BlueprintRegistry<TSpec extends JsonValue = JsonValue,TCompiled extends JsonValue = JsonValue> {
  private readonly byKey = new Map<string,CompiledBlueprint<TSpec,TCompiled>>();
  private readonly identity = new Map<string,string>();
  constructor(private readonly compile:(spec:Readonly<TSpec>)=>TCompiled, readonly capacity=16384) {
    if (!Number.isSafeInteger(capacity) || capacity < 1) throw new RangeError('Invalid blueprint capacity');
  }

  publish(source:BlueprintSource<TSpec>):CompiledBlueprint<TSpec,TCompiled> {
    if (!source.id || source.id.length>180 || !source.kind || source.kind.length>120 || !source.author || source.author.length>180) throw new TypeError('Blueprint identity is invalid');
    if (!Number.isSafeInteger(source.revision) || source.revision < 1) throw new RangeError('Blueprint revision starts at one');
    const spec=deepFreeze(cloneJson(source.spec)),digest=definitionDigest(spec),identity=`${source.kind}:${source.id}@${source.revision}`;
    const previousKey=this.identity.get(identity);
    if(previousKey){const previous=this.byKey.get(previousKey)!;if(previous.digest!==digest)throw new Error(`Published blueprint revision is immutable: ${identity}`);return previous;}
    if(this.byKey.size>=this.capacity)throw new RangeError('Blueprint registry is full');
    const compiled=deepFreeze(cloneJson(this.compile(spec))),key=`${identity}:${digest}`;
    const published=deepFreeze({key,id:source.id,revision:source.revision,kind:source.kind,author:source.author,digest,spec,compiled}) as CompiledBlueprint<TSpec,TCompiled>;
    this.byKey.set(key,published);this.identity.set(identity,key);return published;
  }

  get(key:string):CompiledBlueprint<TSpec,TCompiled>|undefined{return this.byKey.get(key);}
  getRevision(kind:string,id:string,revision:number):CompiledBlueprint<TSpec,TCompiled>|undefined{const key=this.identity.get(`${kind}:${id}@${revision}`);return key?this.byKey.get(key):undefined;}
  ref(key:string):BlueprintRef{const blueprint=this.byKey.get(key);if(!blueprint)throw new Error(`Unknown blueprint: ${key}`);return {key:blueprint.key,id:blueprint.id,revision:blueprint.revision,digest:blueprint.digest};}
  get size():number{return this.byKey.size;}
}
