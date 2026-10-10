/**
 * World coupling v1: declarative, typed and causally ordered OBSERVATION edges.
 * A descriptor cannot mutate physical state; execution remains with domain owners.
 * Tags and dimensions are the WSCN v3 ABI, mirrored by compiler/src/lib.rs.
 */
export const WORLD_SIGNAL_PORTS=Object.freeze([
  {path:'physics.contact.energy',unit:'J',dimension:'energy'},           // 0
  {path:'audio.impact.energy',unit:'J',dimension:'energy'},             // 1
  {path:'material.fracture.energy',unit:'J',dimension:'energy'},        // 2
  {path:'thermal.energy',unit:'J',dimension:'energy'},                  // 3
  {path:'acoustic.source.energy',unit:'J',dimension:'energy'},          // 4
  {path:'fluid.pressure',unit:'Pa',dimension:'pressure'},               // 5
  {path:'acoustic.pressure',unit:'Pa',dimension:'pressure'},            // 6
  {path:'npc.hearing.pressure',unit:'Pa',dimension:'pressure'},         // 7
  {path:'environment.temperature',unit:'C',dimension:'temperature'},   // 8
  {path:'thermal.temperature',unit:'C',dimension:'temperature'},       // 9
  {path:'surface.temperature',unit:'C',dimension:'temperature'},       // 10
  {path:'material.temperature',unit:'C',dimension:'temperature'},      // 11
  {path:'fluid.depth',unit:'m',dimension:'length'},                     // 12
  {path:'surface.water.depth',unit:'m',dimension:'length'},            // 13
  {path:'surface.friction',unit:'1',dimension:'scalar'},               // 14
  {path:'physics.friction',unit:'1',dimension:'scalar'},               // 15
  {path:'physics.contact.impulse',unit:'Ns',dimension:'impulse'},      // 16
  {path:'acoustic.impulse',unit:'Ns',dimension:'impulse'},             // 17
  {path:'environment.wind.speed',unit:'m/s',dimension:'speed'},       // 18
  {path:'fluid.velocity.speed',unit:'m/s',dimension:'speed'},         // 19
  {path:'npc.movement.speed',unit:'m/s',dimension:'speed'},           // 20
  {path:'physics.body.speed',unit:'m/s',dimension:'speed'},           // 21
  {path:'npc.intent.confidence',unit:'1',dimension:'scalar'},        // 22
  {path:'material.damage.fraction',unit:'1',dimension:'scalar'},     // 23
] as const);
export type WorldSignalPort=typeof WORLD_SIGNAL_PORTS[number]['path'];
export type WorldCouplingDimension=typeof WORLD_SIGNAL_PORTS[number]['dimension'];
export interface WorldCoupling {
  readonly id:string;
  readonly from:WorldSignalPort;
  readonly to:WorldSignalPort;
  /** Extra ordering dependency on an earlier/later named coupling. */
  readonly after?:string;
  /** Source-unit minimum for an observational match, never a physical filter. */
  readonly min?:number;
}
export const WORLD_COUPLING_ABI_VERSION=1 as const;
export const WORLD_MAX_COUPLINGS=256 as const;

const index=new Map<string,number>(WORLD_SIGNAL_PORTS.map((p,i)=>[p.path,i]));
export function signalPortIndex(name:string):number{
  const i=index.get(name);
  if(i===undefined)throw new TypeError('Unknown World coupling signal '+name);
  return i;
}
export function signalPortDimension(name:string):WorldCouplingDimension{
  return WORLD_SIGNAL_PORTS[signalPortIndex(name)]!.dimension;
}
function stable(value:unknown,label:string):string{
  if(typeof value!=='string'||!value||new TextEncoder().encode(value).length>180)
    throw new TypeError(label+' must be a nonempty UTF-8 id <=180 bytes');
  if(value.includes('\0'))throw new TypeError(label+' cannot contain NUL');
  return value;
}

/**
 * Compile/validate dependencies in a stable, topological order. An inferred
 * edge A->B exists when A.to == B.from; explicit after edges add constraints.
 * A directed cycle cannot be scheduled within one causal time boundary.
 *
 * Does not invent a conversion between physical dimensions: energy->pressure,
 * for instance, requires a future named physical law with its own parameters.
 */
export function compileWorldCouplings(value:unknown):readonly WorldCoupling[]{
  if(!Array.isArray(value)||value.length>WORLD_MAX_COUPLINGS)
    throw new TypeError('World couplings require an array <=256');
  const seen=new Set<string>();
  const incoming=new Map<string,number>();
  const indexed=new Map<string,WorldCoupling>();
  const edges:WorldCoupling[]=[];
  for(const [i,raw] of value.entries()){
    if(!raw||typeof raw!=='object'||Array.isArray(raw))
      throw new TypeError('World coupling '+i+' must be a record');
    const r=raw as Record<string,unknown>;
    if(Object.keys(r).some(key=>!['id','from','to','after','min'].includes(key)))
      throw new TypeError('Unknown World coupling field at '+i);
    const id=stable(r.id,'coupling.id');
    if(seen.has(id))throw new TypeError('Duplicate World coupling '+id);
    seen.add(id);
    const from=stable(r.from,'coupling.from') as WorldSignalPort;
    const to=stable(r.to,'coupling.to') as WorldSignalPort;
    const sourceDimension=signalPortDimension(from);
    const targetDimension=signalPortDimension(to);
    if(sourceDimension!==targetDimension)
      throw new TypeError('World coupling '+id+' dimension mismatch: '+from+' ('+sourceDimension+') -> '+to+' ('+targetDimension+')');
    if(from===to)throw new TypeError('World coupling '+id+' cannot feed the same signal');
    if(r.min!==undefined&&
      (typeof r.min!=='number'||!Number.isFinite(r.min)||r.min<0))
      throw new TypeError('World coupling '+id+' min must be finite and nonnegative in '+WORLD_SIGNAL_PORTS[signalPortIndex(from)]!.unit);
    const after=r.after===undefined?undefined:stable(r.after,'coupling.after');
    const coupling:WorldCoupling=Object.freeze({id,from,to,...(after?{after}:{}),...(r.min!==undefined?{min:r.min as number}:{})});
    edges.push(coupling);indexed.set(id,coupling);incoming.set(id,0);
  }
  const adjacency=new Map<string,Set<string>>(edges.map(e=>[e.id,new Set<string>()]));
  const depend=(parent:string,child:string)=>{
    if(!adjacency.get(parent)!.has(child)){
      adjacency.get(parent)!.add(child);
      incoming.set(child,incoming.get(child)!+1);
    }
  };
  for(const next of edges){
    if(next.after!==undefined){
      if(!indexed.has(next.after))throw new TypeError('Unknown World coupling dependency '+next.after);
      depend(next.after,next.id);
    }
    for(const earlier of edges)if(earlier.to===next.from)depend(earlier.id,next.id);
  }
  const ordered:WorldCoupling[]=[];
  while(ordered.length<edges.length){
    const next=edges.find(edge=>incoming.get(edge.id)===0&&!ordered.includes(edge));
    if(!next)throw new TypeError('Cyclic World coupling dependency');
    ordered.push(next);incoming.set(next.id,-1);
    for(const child of adjacency.get(next.id)!)incoming.set(child,incoming.get(child)!-1);
  }
  return Object.freeze(ordered);
}
