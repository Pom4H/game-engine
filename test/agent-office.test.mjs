import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {ActivityJournal,validateActivityFact,ACTIVITY_FACT_SCHEMA} from '../dist/observability/activity.js';
import {AgentOffice,projectOfficeAgents} from '../dist/observability/office.js';
import {startServer} from '../tools/agent-office/server.mjs';

const agents=[{id:'research',name:'Research'},{id:'builder',name:'Build'}];
const make=(id,atMs,actor,kind,extra={})=>({schema:ACTIVITY_FACT_SCHEMA,id,atMs,actor:{domain:'agent',id:actor},kind,origin:'demo',...extra});
const data=[
  make('e1',1000,'research','agent.started',{label:'Research'}),
  make('e2',2000,'research','agent.task.started',{causeId:'e1',target:{domain:'task',id:'investigate'},label:'Investigate'}),
  make('e3',3000,'research','agent.tool.started',{causeId:'e2',target:{domain:'tool',id:'search'},label:'Search'}),
  make('e4',4000,'research','agent.tool.completed',{causeId:'e3',usage:{tokens:320,costUsd:.0025}}),
  make('e5',5000,'research','agent.task.completed',{causeId:'e4'}),
  make('e6',2500,'builder','agent.started',{label:'Build'}),
];

test('one causal contract accepts economic domains without pretending to simulate them',()=>{
  const fact=validateActivityFact({schema:ACTIVITY_FACT_SCHEMA,id:'trade:42',atMs:2000,actor:{domain:'factory',id:'iron-works'},target:{domain:'warehouse',id:'depot'},kind:'economy.trade.settled',origin:'observed',usage:{costUsd:17.25}});
  assert.equal(fact.kind,'economy.trade.settled');
  assert.ok(Object.isFrozen(fact));
  assert.ok(Object.isFrozen(fact.actor));
  assert.throws(()=>validateActivityFact({...fact,atMs:NaN}),/atMs/);
  assert.throws(()=>validateActivityFact({...fact,origin:undefined}),/origin/);
  assert.throws(()=>validateActivityFact({...fact,extra:'untrusted'}),/extra/);
});

test('bounded journal sorts streams and preserves causal ancestry',()=>{
  const journal=new ActivityJournal(16);
  journal.ingestMany(data.slice().reverse());
  assert.deepEqual(journal.snapshot().map(f=>f.id),['e1','e2','e6','e3','e4','e5']);
  assert.deepEqual(journal.lineage('e5').chain.map(f=>f.id),['e5','e4','e3','e2','e1']);
  const before=journal.snapshot();
  assert.throws(()=>journal.ingestMany([make('new',6000,'builder','agent.started'),{broken:true}]));
  assert.deepEqual(journal.snapshot(),before,'batch error committed a partial event');
  assert.throws(()=>journal.ingest(data[0]),/Duplicate/);
  for(let i=7;i<29;i++)journal.ingest(make('e'+i,6000+i,'builder','agent.tool.completed'));
  assert.equal(journal.stats.retained,16);
  assert.equal(journal.stats.dropped,12);
  assert.equal(journal.lineage('e5').unresolvedCauseId,'e5','evicted event is never invented');
});

test('state and token attribution are deterministic at every cursor',()=>{
  const journal=new ActivityJournal();journal.ingestMany(data);
  const atStart=projectOfficeAgents(agents,journal.snapshot(),1500);
  assert.equal(atStart[0].phase,'idle');
  assert.equal(atStart[1].phase,'offline');
  assert.equal(projectOfficeAgents(agents,journal.snapshot(),3100)[0].phase,'tool');
  const end=projectOfficeAgents(agents,journal.snapshot(),6000);
  assert.equal(end[0].phase,'done');
  assert.equal(end[0].tokens,320);
  assert.equal(end[0].costUsd,.0025);
  assert.deepEqual(projectOfficeAgents(agents,journal.snapshot(),6000),end);
});

test('actual Scene geometry, visual-only actors, and backward seek parity',()=>{
  const journal=new ActivityJournal();journal.ingestMany(data);
  const office=new AgentOffice(agents);
  assert.ok(office.scene.entities.size>20);
  assert.ok([...office.scene.entities.keys()].some(id=>id.startsWith('batch:')),'static scenery is batched');
  assert.ok(office.scene.entities.size<250,'toy LOD must avoid hundreds of physical character parts');
  assert.equal(office.style,'toy-brick-v1');
  assert.deepEqual(office.agentPosition('research')?.length,3);
  assert.equal(office.agentPosition('not-present'),undefined);
  assert.equal(office.scene.physics.bodies.size,0,'telemetry never invents physical bodies');
  assert.ok(office.scene.renderMoverIds().has('office:agent:0:arm:right'));
  const start=office.project(journal.snapshot(),1000);
  const marker=office.scene.entities.get('office:status:0');
  const arm=office.scene.entities.get('office:agent:0:arm:right');
  const first=[...arm.rotation],firstColor=[...marker.material.color];
  const end=office.project(journal.snapshot(),6000);
  const last=[...arm.rotation],lastColor=[...marker.material.color];
  assert.notDeepEqual(first,last,'toy arm pose changes only from observed phase');
  assert.notDeepEqual(firstColor,lastColor,'office lights reflect observed status, not invented activity');
  assert.equal(start[0].phase,'idle');
  assert.equal(end[0].phase,'done');
  office.project(journal.snapshot(),1000);
  assert.deepEqual(arm.rotation,first,'backward seek does not accumulate transforms');
  assert.deepEqual(marker.material.color,firstColor,'backward seek restores previous status light');
  assert.equal(office.scene.tick,0,'visual replay never advances authoritative physics ticks');
  assert.throws(()=>new AgentOffice(Array.from({length:9},(_,i)=>({id:String(i),name:'Agent '+i}))),/at most 8/);
});

test('demo fixture is explicitly synthetic and all supplied causal links resolve',async()=>{
  const raw=JSON.parse(await readFile(new URL('../examples/agent-office/replay.json',import.meta.url),'utf8'));
  const journal=new ActivityJournal();journal.ingestMany(raw.events);
  assert.ok(raw.events.length>=12);
  assert.ok(raw.events.every(e=>e.origin==='demo'));
  assert.ok(raw.events.some(e=>e.causeId));
  assert.ok(raw.events.every(e=>!e.causeId||journal.has(e.causeId)));
});

test('loopback live server validates facts without executing agent work',async()=>{
  const server=await startServer({port:0,mode:'live',token:'proof-token'});
  const url='http://127.0.0.1:'+server.address().port;
  try{
    const before=await (await fetch(url+'/api/snapshot')).json();
    assert.equal(before.events.length,0);
    const fact={...make('live.1',1800000000000,'builder','agent.started'),origin:'observed'};
    const denied=await fetch(url+'/api/events',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(fact)});
    assert.equal(denied.status,401);
    const accepted=await fetch(url+'/api/events',{method:'POST',headers:{authorization:'Bearer proof-token','content-type':'application/json'},body:JSON.stringify(fact)});
    assert.equal(accepted.status,202);
    const after=await (await fetch(url+'/api/snapshot')).json();
    assert.equal(after.mode,'live');assert.equal(after.events.length,1);
    const duplicate=await fetch(url+'/api/events',{method:'POST',headers:{authorization:'Bearer proof-token','content-type':'application/json'},body:JSON.stringify(fact)});
    assert.equal(duplicate.status,400);
    assert.equal((await fetch(url+'/package.json')).status,404);
  }finally{await new Promise((resolve,reject)=>server.close(err=>err?reject(err):resolve()));}
});
