import test from 'node:test';
import assert from 'node:assert/strict';
import {SimulationInterestPlanner,LocationWorkScheduler} from '../dist/index.js';

const config={detailedRadius:10,activeRadius:100,aggregateRadius:500,hysteresis:5,downgradeTicks:10,maxSubjects:8,maxObservers:4};
test('simulation interest uses observer union, conservative radius and critical activity through downgrade hysteresis',()=>{
 const planner=new SimulationInterestPlanner(config),body={id:'body',x:0,z:0};
 const tier=(tick,x)=>planner.plan(tick,[body],[{x,z:0}])[0].tier;
 assert.equal(tier(0,10),'detailed');assert.equal(tier(1,16),'detailed');assert.equal(tier(10,16),'detailed');assert.equal(tier(11,15),'detailed');
 assert.equal(tier(12,16),'detailed');assert.equal(tier(22,16),'active');assert.equal(tier(23,0),'detailed');
 const union=new SimulationInterestPlanner(config),people=[{id:'right',x:10000,z:0,radius:0},{id:'middle',x:5000,z:0},{id:'left',x:10,z:0},{id:'large',x:150,z:0,radius:140},{id:'critical',x:-20000,z:0,critical:true}];
 const decisions=union.plan(0,people,[{x:0,z:0},{x:10000,z:0}]);
 assert.deepEqual(decisions.map(r=>[r.id,r.tier]),[['critical','detailed'],['large','detailed'],['left','detailed'],['middle','dormant'],['right','detailed']]);
 assert.deepEqual(new SimulationInterestPlanner(config).plan(0,[...people].reverse(),[{x:10000,z:0},{x:0,z:0}]),decisions);
 union.plan(1,people,[]);assert.equal(union.plan(11,people,[]).find(r=>r.id==='left').tier,'dormant');assert.equal(union.plan(12,people,[]).find(r=>r.id==='critical').tier,'detailed');
 union.plan(13,[],[]);assert.equal(union.tracked,0);
});

test('simulation interest validates before advancing its clock, bounds retained history and keeps full safe ticks',()=>{
 const planner=new SimulationInterestPlanner({...config,maxSubjects:1,maxObservers:1}),body={id:'a',x:0,z:0};
 planner.plan(10,[body],[]);
 assert.throws(()=>planner.plan(11,[body,{...body,id:'b'}],[]),/budget/);assert.throws(()=>planner.plan(11,[body],[{x:NaN,z:0}]),/observer/);
 assert.equal(planner.plan(10,[body],[])[0].tier,'dormant');assert.throws(()=>planner.plan(9,[],[]),/backwards/);
 assert.throws(()=>new SimulationInterestPlanner({...config,maxObservers:0}),/positive/);assert.throws(()=>new SimulationInterestPlanner({...config,activeRadius:1}),/radii/);
 assert.throws(()=>new SimulationInterestPlanner(config).plan(0,[body,body],[]),/unique/);assert.throws(()=>planner.plan(11,[{...body,radius:-1}],[]),/subject/);
 planner.forget('a');assert.equal(planner.tracked,0);assert.equal(planner.plan(2**40,[body],[{x:0,z:0}])[0].tier,'detailed');
 planner.plan(Number.MAX_SAFE_INTEGER,[body],[]);assert.equal(planner.tracked,1);assert.throws(()=>planner.plan(Number.MAX_SAFE_INTEGER+1,[],[]),/safe integer/);
});

test('location work gives old deferred districts a fair turn while respecting both hard budgets and promotion',()=>{
 const periods={detailed:1,active:6,aggregate:30,dormant:300},scheduler=new LocationWorkScheduler(periods,8),jobs=['a','b','c','d','e'].map(id=>({id,tier:'detailed',cost:2})),seen=new Set();
 for(let tick=0;tick<3;tick++){const plan=scheduler.plan(tick,jobs,{maxJobs:2,maxCost:4});assert.equal(plan.selected.length,2);assert.equal(plan.deferred.length,3);assert.equal(plan.cost,4);for(const item of plan.selected){seen.add(item.id);assert.equal(jobs.find(j=>j.id===item.id),item);}}
 assert.deepEqual([...seen].sort(),['a','b','c','d','e']);
 assert.equal(scheduler.plan(3,jobs,{maxJobs:10,maxCost:1}).selected.length,0);
 scheduler.plan(4,[],{maxJobs:0,maxCost:0});assert.equal(scheduler.tracked,0);
 const cold=new LocationWorkScheduler(periods),job={id:'cold',tier:'dormant',cost:1},budget={maxJobs:1,maxCost:1};
 assert.equal(cold.plan(0,[job],budget).selected.length,1);assert.equal(cold.plan(1,[job],budget).selected.length,0);assert.equal(cold.plan(2,[{...job,tier:'detailed'}],budget).selected.length,1);
 assert.throws(()=>cold.plan(1,[],budget),/backwards/);assert.throws(()=>cold.plan(3,[job,job],budget),/unique/);assert.equal(cold.plan(2,[],budget).cost,0);
 assert.equal(cold.plan(2**40,[job],budget).selected.length,1);assert.equal(cold.plan(Number.MAX_SAFE_INTEGER,[job],budget).selected.length,1);
});
