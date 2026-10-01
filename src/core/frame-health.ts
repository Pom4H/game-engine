/** Whole-run frame evidence with fixed memory and no per-frame sorting/array shifts.
 * Quantiles use 0.25 ms buckets (upper bound), not a rolling window that forgets hitches.
 * Record actual submitted frames separately from RAF callbacks. */
export class FrameHealth {
 private readonly buckets=new Uint32Array(2001);
 private count=0;private total=0;private maximum=0;
 private overBudget=0;private overDouble=0;private long=0;private severe=0;
 constructor(readonly budgetMs=1000/60){if(!Number.isFinite(budgetMs)||budgetMs<=0)throw new RangeError('Invalid frame budget');}
 record(milliseconds:number):void{
  if(!Number.isFinite(milliseconds)||milliseconds<0)throw new RangeError('Invalid frame duration');
  this.count++;this.total+=milliseconds;this.maximum=Math.max(this.maximum,milliseconds);
  const index=Math.min(this.buckets.length-1,Math.ceil(milliseconds*4));this.buckets[index]=this.buckets[index]!+1;
  if(milliseconds>this.budgetMs+.25)this.overBudget++;if(milliseconds>this.budgetMs*2+.25)this.overDouble++;
  if(milliseconds>50)this.long++;if(milliseconds>100)this.severe++;
 }
 private percentile(q:number):number{if(!this.count)return 0;const target=Math.ceil(this.count*q);let n=0;for(let i=0;i<this.buckets.length;i++){n+=this.buckets[i]!;if(n>=target)return i===this.buckets.length-1?this.maximum:i/4;}return this.maximum;}
 inspect(){return {samples:this.count,budgetMs:this.budgetMs,quantileResolutionMs:.25,meanMs:this.count?this.total/this.count:0,p50Ms:this.percentile(.5),p95Ms:this.percentile(.95),p99Ms:this.percentile(.99),maxMs:this.maximum,overBudget:this.overBudget,overDoubleBudget:this.overDouble,over50Ms:this.long,over100Ms:this.severe};}
 reset():void{this.buckets.fill(0);this.count=this.total=this.maximum=this.overBudget=this.overDouble=this.long=this.severe=0;}
}
