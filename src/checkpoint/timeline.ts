export interface EngineCheckpoint<State>{readonly version:1;readonly tick:number;readonly time:number;readonly state:State}
export interface CheckpointCodec<State>{readonly encode:(checkpoint:EngineCheckpoint<State>)=>Uint8Array;readonly decode:(bytes:Uint8Array)=>EngineCheckpoint<State>}
const encoder=new TextEncoder(),decoder=new TextDecoder();
export function jsonCheckpointCodec<State>():CheckpointCodec<State>{return{encode:checkpoint=>encoder.encode(JSON.stringify(checkpoint)),decode:bytes=>JSON.parse(decoder.decode(bytes)) as EngineCheckpoint<State>};}
export class CheckpointTimeline<State>{
  private readonly checkpoints:EngineCheckpoint<State>[]=[];
  constructor(readonly capacity=120){if(!Number.isSafeInteger(capacity)||capacity<1)throw new RangeError('Checkpoint timeline capacity must be positive');}
  capture(tick:number,time:number,state:State):EngineCheckpoint<State>{
    if(!Number.isSafeInteger(tick)||tick<0||!Number.isFinite(time)||time<0)throw new RangeError('Invalid checkpoint time');
    const latest=this.checkpoints.at(-1);if(latest&&tick<=latest.tick)throw new RangeError('Checkpoint ticks must increase monotonically');
    const checkpoint:EngineCheckpoint<State>=Object.freeze({version:1,tick,time,state:structuredClone(state)});
    this.checkpoints.push(checkpoint);if(this.checkpoints.length>this.capacity)this.checkpoints.shift();
    return structuredClone(checkpoint);
  }
  atOrBefore(tick:number):EngineCheckpoint<State>|undefined{if(!Number.isSafeInteger(tick)||tick<0)throw new RangeError('Invalid checkpoint tick');for(let i=this.checkpoints.length-1;i>=0;i--)if(this.checkpoints[i]!.tick<=tick)return structuredClone(this.checkpoints[i]!);return undefined;}
  truncateAfter(tick:number):void{while(this.checkpoints.length&&this.checkpoints.at(-1)!.tick>tick)this.checkpoints.pop();}
  get latest():EngineCheckpoint<State>|undefined{const checkpoint=this.checkpoints.at(-1);return checkpoint&&structuredClone(checkpoint);}
  get size():number{return this.checkpoints.length;}
  encode(codec:CheckpointCodec<State>=jsonCheckpointCodec<State>()):Uint8Array[]{
    return this.checkpoints.map(checkpoint=>codec.encode(structuredClone(checkpoint)));
  }
  restore(encoded:readonly Uint8Array[],codec:CheckpointCodec<State>=jsonCheckpointCodec<State>()):void{
    const staged:EngineCheckpoint<State>[]=[];
    let previousTick=-1;
    for(const bytes of encoded){
      const checkpoint=codec.decode(bytes);
      if(checkpoint.version!==1||!Number.isSafeInteger(checkpoint.tick)||checkpoint.tick<0||
        !Number.isFinite(checkpoint.time)||checkpoint.time<0||checkpoint.tick<=previousTick)
        throw new RangeError('Invalid checkpoint sequence');
      previousTick=checkpoint.tick;
      staged.push(Object.freeze({version:1,tick:checkpoint.tick,time:checkpoint.time,state:structuredClone(checkpoint.state)}));
      if(staged.length>this.capacity)staged.shift();
    }
    this.checkpoints.length=0;
    for(const checkpoint of staged)this.checkpoints.push(checkpoint);
  }
}
