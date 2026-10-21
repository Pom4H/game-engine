export interface SequencedInput<I> {readonly seq:number;readonly input:I}
/** Bounded command-time prediction. An ACK means EXECUTED, never merely received.
 * Transport supplies reliable ordered inputs; this class owns no socket or frame loop. */
export class InputReplay<S,I> {
 private queue:SequencedInput<I>[]=[];
 private sequence=0;private acknowledged=0;
 state:S;
 readonly stats={corrections:0,replayed:0,overflows:0};
 constructor(initial:S,private readonly copy:(state:S)=>S,private readonly step:(state:S,input:I)=>void,readonly capacity=120){
  if(!Number.isSafeInteger(capacity)||capacity<2||capacity>1024)throw new RangeError('Invalid replay capacity');this.state=copy(initial);
 }
 push(input:I):SequencedInput<I>|undefined {
  if(this.queue.length>=this.capacity){this.stats.overflows++;return;}
  const item={seq:++this.sequence,input};this.step(this.state,input);this.queue.push(item);return item;
 }
 correct(ack:number,state:S):boolean {
  if(!Number.isSafeInteger(ack)||ack<this.acknowledged||ack>this.sequence)return false;
  this.queue=this.queue.filter(item=>item.seq>ack);this.acknowledged=ack;this.state=this.copy(state);
  for(const item of this.queue)this.step(this.state,item.input);
  this.stats.corrections++;this.stats.replayed+=this.queue.length;return true;
 }
 reset(state:S,sequence=0):void {
  if(!Number.isSafeInteger(sequence)||sequence<0)throw new RangeError('Invalid sequence');
  this.state=this.copy(state);this.queue.length=0;this.sequence=this.acknowledged=sequence;
 }
 after(sequence:number,limit=32):readonly SequencedInput<I>[] {return this.queue.filter(item=>item.seq>sequence).slice(0,limit);}
 get pending():number{return this.queue.length;}
 get latestSequence():number{return this.sequence;}
 get ack():number{return this.acknowledged;}
}
