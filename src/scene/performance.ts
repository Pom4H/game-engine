/** Bounded opt-in CPU diagnostics; does not modify the simulation's causal state. */
export interface ScenePerformanceConfig{
  readonly tickBudgetMs:number;readonly sampleEvery:number;readonly history:number;
}
export interface PerformanceStats{
  readonly count:number;readonly meanMs:number;readonly p50Ms:number;readonly p95Ms:number;readonly maxMs:number;
}
export interface PerformanceWork{
  readonly entities:number;readonly bodies:number;readonly contacts:number;
  readonly substeps:number;readonly collisionSurfaceIterations:number;
  readonly dispatch:'kernel'|'direct';
}
export interface ScenePerformanceSample{
  readonly tick:number;readonly totalMs:number;readonly overBudget:boolean;
  readonly systems:Readonly<Record<string,number>>;readonly overheadMs:number;
  readonly work:Readonly<PerformanceWork>;
}
export interface ScenePerformanceReport{
  readonly budgetMs:number;readonly sampleEvery:number;readonly recordedTicks:number;readonly exceededTicks:number;
  readonly tick:PerformanceStats;readonly systems:Readonly<Record<string,PerformanceStats>>;
  readonly overhead:PerformanceStats;readonly latest?:ScenePerformanceSample;
}
const stats=(numbers:readonly number[]):PerformanceStats=>{
  const ordered=[...numbers].sort((a,b)=>a-b);
  const quantile=(q:number)=>ordered.length?ordered[Math.floor(q*(ordered.length-1))]!:0;
  return Object.freeze({
    count:ordered.length,meanMs:numbers.length?numbers.reduce((a,b)=>a+b,0)/numbers.length:0,
    p50Ms:quantile(.50),p95Ms:quantile(.95),maxMs:ordered.at(-1)??0,
  });
};
export class ScenePerformanceProfiler{
  private readonly history:ScenePerformanceSample[]=[];
  private active:{tick:number;start:number;systems:Record<string,number>}|undefined;
  constructor(readonly config:ScenePerformanceConfig){}
  shouldSample(tick:number):boolean{return tick%this.config.sampleEvery===0;}
  begin(tick:number):void{
    if(this.active)throw new TypeError('Performance sample already active');
    this.active={tick,start:performance.now(),systems:Object.create(null) as Record<string,number>};
  }
  system(action:string,elapsedMs:number):void{
    const active=this.active;if(!active)return;
    active.systems[action]=(active.systems[action]??0)+elapsedMs;
  }
  end(work:PerformanceWork):void{
    const active=this.active;
    if(!active)throw new TypeError('Performance sample not active');
    this.active=undefined;
    const totalMs=performance.now()-active.start;
    const systemMs=Object.values(active.systems).reduce((sum,value)=>sum+value,0);
    this.history.push(Object.freeze({
      tick:active.tick,totalMs,overBudget:totalMs>this.config.tickBudgetMs,
      systems:Object.freeze({...active.systems}),
      overheadMs:Math.max(0,totalMs-systemMs),work:Object.freeze({...work}),
    }));
    if(this.history.length>this.config.history)this.history.shift();
  }
  report():ScenePerformanceReport{
    const names=new Set(this.history.flatMap(sample=>Object.keys(sample.systems)));
    const systems:Record<string,PerformanceStats>={};
    for(const name of names)systems[name]=stats(this.history.flatMap(sample=>
      sample.systems[name]===undefined?[]:[sample.systems[name]!]));
    return Object.freeze({
      budgetMs:this.config.tickBudgetMs,sampleEvery:this.config.sampleEvery,
      recordedTicks:this.history.length,exceededTicks:this.history.filter(sample=>sample.overBudget).length,
      tick:stats(this.history.map(sample=>sample.totalMs)),
      systems:Object.freeze(systems),overhead:stats(this.history.map(sample=>sample.overheadMs)),
      ...(this.history.length?{latest:this.history[this.history.length-1]}:{}),
    });
  }
  clear():void{this.history.length=0;this.active=undefined;}
}
