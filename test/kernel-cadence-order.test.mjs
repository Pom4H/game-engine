import test from 'node:test';
import assert from 'node:assert/strict';
import {EngineKernel} from '../dist/core/kernel.js';

test('stable-ID resource ordering is selected by the state owner while strict hazards still reject ambiguity',()=>{
 const options={resourceOrder:'id'},calls=[],ordered=new EngineKernel(60,64,options);options.resourceOrder='explicit';
 for(const id of ['c','a','b'])ordered.use({id,phase:'simulate',rateHz:60,reads:['state'],writes:['state'],context:'none',run:()=>{calls.push(id);}});
 ordered.run(0,undefined);assert.deepEqual(calls,['a','b','c']);assert.equal(ordered.scheduler.resourceOrder,'id');assert.deepEqual(ordered.scheduler.plan(0).map(b=>b.modules.map(m=>m.id)),[['a'],['b'],['c']]);
 const strict=new EngineKernel();for(const id of ['a','b'])strict.use({id,phase:'simulate',rateHz:60,reads:[],writes:['state'],run:()=>{}});assert.throws(()=>strict.run(0,{}),/Ambiguous resource hazard/);
 const explicit=new EngineKernel(60,64,{resourceOrder:'id'}),reverse=[];explicit.use({id:'a',after:['z'],phase:'simulate',rateHz:60,reads:[],writes:['state'],context:'none',run:()=>{reverse.push('a');}});explicit.use({id:'z',phase:'simulate',rateHz:60,reads:[],writes:['state'],context:'none',run:()=>{reverse.push('z');}});explicit.run(0,undefined);assert.deepEqual(reverse,['z','a']);
 assert.throws(()=>new EngineKernel(60,64,{resourceOrder:'random'}),/ordering policy/);
});

test('large cadence cycles and executable plans use bounded due-pattern caches, preserving exact ticks and old programs',()=>{
 const periods=[2,3,5,7,11,17,19,23,31],product=periods.reduce((a,b)=>a*b,1),kernel=new EngineKernel(),calls=[];
 for(const period of [...periods].reverse())kernel.use({id:'m:'+String(period).padStart(2,'0'),phase:'simulate',rateHz:60/period,reads:[],writes:[],context:'none',run:(_c,f)=>{calls.push({period,tick:f.tick,delta:f.deltaSeconds});}});
 const program=kernel.compile(),schedule=kernel.scheduler.compile();assert.equal(program.cycleTicks,0);assert.equal(schedule.cycleTicks,0);assert.equal(program.diagnostics.precomputedPlans,0);
 const inverse=(n,p)=>{for(let i=1;i<p;i++)if(n*i%p===1)return i;throw Error('No modular inverse');};
 const tickFor=mask=>periods.reduce((sum,p,i)=>{const n=product/p;return(sum+((mask>>i)&1?0:n*inverse(n%p,p)))%product;},0);
 for(let mask=0;mask<512;mask++){const tick=tickFor(mask);calls.length=0;program.run(tick,undefined);assert.deepEqual(calls.map(c=>c.period),periods.filter(p=>tick%p===0));for(const call of calls){assert.equal(call.tick,tick);assert.equal(call.delta,1/(60/call.period));}}
 assert.equal(program.diagnostics.cachedPatterns,256);assert.equal(schedule.diagnostics.cachedPatterns,256);assert.equal(program.diagnostics.patternCapacity,256);
 for(const mask of [0,511,17,400]){const tick=tickFor(mask);calls.length=0;program.run(tick,undefined);assert.deepEqual(calls.map(c=>c.period),periods.filter(p=>tick%p===0));}
 kernel.use({id:'m:00',phase:'simulate',rateHz:60,reads:[],writes:[],context:'none',run:()=>{calls.push({period:1});}});calls.length=0;program.run(0,undefined);assert.equal(calls.length,9);calls.length=0;kernel.run(0,undefined);assert.equal(calls.length,10);
 const huge=new EngineKernel(),ticks=[];huge.use({id:'rare',phase:'simulate',rateHz:60/(2**40),reads:[],writes:[],context:'none',run:(_c,f)=>{ticks.push(f.tick);}});for(const tick of [0,1,2**40,Number.MAX_SAFE_INTEGER])huge.run(tick,undefined);assert.deepEqual(ticks,[0,2**40]);assert.equal(huge.compile().cycleTicks,0);
});
