import {assertCounter} from '../world/contracts.js';
import {compareIds} from '../world/locations.js';

export interface RevisionedProjection{readonly id:string;readonly revision:number}
export interface ProjectionDelta<T extends RevisionedProjection>{readonly changed:readonly T[];readonly removed:readonly string[]}
export class ProjectionDeltaTracker<T extends RevisionedProjection>{
  private readonly revisions=new Map<string,number>();
  constructor(readonly capacity=8192){if(!Number.isSafeInteger(capacity)||capacity<1)throw new RangeError('Invalid projection delta capacity');}
  diff(current:readonly T[]):ProjectionDelta<T>{
    if(current.length>this.capacity)throw new RangeError('Projection exceeds delta tracker capacity');
    const next=new Map<string,number>(),changed:T[]=[];
    for(const entity of current){
      if(!entity.id||!Number.isSafeInteger(entity.revision)||entity.revision<0||next.has(entity.id))throw new TypeError('Projection entities need unique ids and non-negative revisions');
      next.set(entity.id,entity.revision);if(this.revisions.get(entity.id)!==entity.revision)changed.push(structuredClone(entity));
    }
    const removed=[...this.revisions.keys()].filter(id=>!next.has(id)).sort(compareIds);
    this.revisions.clear();for(const [id,revision] of next)this.revisions.set(id,revision);
    return{changed,removed};
  }
  reset():void{this.revisions.clear();}
}
export interface ReplicationFrame<T extends RevisionedProjection>{
  readonly schemaVersion:1;readonly tick:number;readonly baseTick:number|null;readonly full:boolean;
  readonly changed:readonly T[];readonly removed:readonly string[];
}
export class ReplicationStream<T extends RevisionedProjection>{
  private readonly tracker:ProjectionDeltaTracker<T>;private lastTick:number|null=null;
  constructor(capacity=8192){this.tracker=new ProjectionDeltaTracker<T>(capacity);}
  frame(tick:number,current:readonly T[],full=false):ReplicationFrame<T>{
    assertCounter(tick,'replication tick');if(this.lastTick!==null&&tick<=this.lastTick)throw new RangeError('Replication ticks must increase');
    if(full)this.tracker.reset();
    const delta=this.tracker.diff(current),frame={schemaVersion:1 as const,tick,baseTick:full?null:this.lastTick,full,changed:delta.changed,removed:delta.removed};
    this.lastTick=tick;return frame;
  }
}
export class ReplicationReceiver<T extends RevisionedProjection>{
  private readonly entities=new Map<string,T>();private tick:number|null=null;
  apply(frame:ReplicationFrame<T>):ReadonlyMap<string,T>{
    assertCounter(frame.tick,'replication tick');
    if(frame.full)this.entities.clear();
    else if(this.tick===null||frame.baseTick!==this.tick)throw new RangeError('Replication frame base does not match receiver state');
    for(const id of frame.removed)this.entities.delete(id);
    for(const entity of frame.changed){const old=this.entities.get(entity.id);if(old&&entity.revision<old.revision)throw new RangeError('Replication revision moved backwards');this.entities.set(entity.id,structuredClone(entity));}
    this.tick=frame.tick;return this.snapshot();
  }
  snapshot():ReadonlyMap<string,T>{return new Map([...this.entities].map(([id,value])=>[id,structuredClone(value)]));}
  get currentTick():number|null{return this.tick;}
}
