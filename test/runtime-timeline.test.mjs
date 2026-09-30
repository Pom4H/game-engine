import test from 'node:test';
import assert from 'node:assert/strict';
import {RuntimeTimeline} from '../dist/core/runtime-timeline.js';
import {CpuProfiler} from '../dist/core/profiling.js';
const input=(name,at=1)=>({owner:'test',kind:'cpu',name,at});
test('disabled trace retains nothing',()=>{const t=new RuntimeTimeline();assert.equal(t.begin(input('a')),0);assert.deepEqual(t.snapshot(),[]);assert.equal(t.diagnostics.records,0);});
test('open traces cannot overrun the hard budget; late ends cannot corrupt reused slots',()=>{const t=new RuntimeTimeline({enabled:true,capacity:2}),a=t.begin(input('a')),b=t.begin(input('b')),c=t.begin(input('c'));t.end(a,9);assert.deepEqual(t.snapshot().map(e=>[e.id,e.end]),[[b,null],[c,null]]);assert.equal(t.diagnostics.dropped,1);});
test('causal nesting uses the same measured CPU boundaries and records failure',()=>{let at=0;const t=new RuntimeTimeline({enabled:true}),p=new CpuProfiler({enabled:true,now:()=>at,timeline:t});assert.throws(()=>p.measure('outer',()=>{at=1;p.measure('inner',()=>{at=3;});at=4;throw Error('fail');}));const [a,b]=t.snapshot();assert.deepEqual([a.start,a.end,b.start,b.end,b.cause,a.failed],[0,4,1,3,a.id,true]);assert.equal(p.inspect().scopes.find(s=>s.id==='outer').selfTotalMs,2);});
test('bounded metadata and chronology are validated; clearing keeps IDs monotonic',()=>{const t=new RuntimeTimeline({enabled:true});const first=t.begin(input('a'));assert.throws(()=>t.end(first,0));assert.throws(()=>t.event({...input('x'),data:{nested:{}}}));t.clear();assert.equal(t.event(input('b')),first+1);assert.equal(t.snapshot().length,1);});
