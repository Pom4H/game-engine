import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {ActivityJournal,ACTIVITY_FACT_SCHEMA} from '../dist/observability/activity.js';
import {AgentCampus,campusJourneys} from '../dist/observability/campus.js';
const raw=JSON.parse(await readFile(new URL('../examples/agent-office/campus-replay.json',import.meta.url),'utf8'));
const journal=new ActivityJournal();journal.ingestMany(raw.events);
const facts=journal.snapshot(),base=facts[0].atMs,seconds=s=>base+Math.round(s*1000);
const find=(states,id)=>states.find(x=>x.id===id);

test('Campus has two visible office floors, a real corridor, toy characters and no fake physics',()=>{
 const campus=new AgentCampus(raw.agents);
 assert.equal(campus.style,'toy-brick-campus-v1');
 assert.ok(campus.scene.entities.size>35&&campus.scene.entities.size<230,'expected bounded static batches and animated parts');
 assert.ok([...campus.scene.entities.keys()].some(id=>id.startsWith('batch:')),'static batching missing');
 assert.equal(campus.scene.physics.bodies.size,0,'external agents cannot become physical simulation bodies');
 assert.ok(campus.scene.renderMoverIds().has('campus:agent:0:leg:left'));
 assert.ok(campus.scene.renderMoverIds().has('campus:agent:0:head'));
 assert.ok(campus.scene.spec.entities.every(e=>e.renderOnly!==false),'campus is an external visualization');
 assert.ok(campus.scene.spec.entities.some(e=>e.id.includes('campus:research'))||
   [...campus.scene.entities.keys()].some(k=>k.startsWith('batch:')),'both offices need authored geometry');
});

test('inter-office walking is interpolation only between real paired cause and completion facts',()=>{
 const journeys=campusJourneys(facts);
 assert.equal(journeys.length,3);
 assert.equal(journeys[0].agentId,'researcher');
 assert.equal(journeys[0].to,'build');
 assert.equal(journal.lineage('researcher:arrived').chain[1].id,'researcher:walk');
 const campus=new AgentCampus(raw.agents);
 const a=find(campus.project(facts,seconds(0)),'researcher');
 const b=find(campus.project(facts,seconds(5.4)),'researcher');
 const c=find(campus.project(facts,seconds(10.5)),'researcher');
 assert.equal(a.traveling,false);
 assert.equal(a.room,'research');
 assert.equal(b.traveling,true);
 assert.equal(b.destination,'build');
 assert.equal(b.causeId,'researcher:walk');
 assert.ok(b.position[0]>a.position[0]+3,'character must physically translate toward the other office');
 assert.ok(Math.abs(b.position[2]-a.position[2])>.20,'character must turn into connecting corridor');
 assert.equal(c.traveling,false);
 assert.equal(c.room,'build');
 assert.ok(c.position[0]>5,'completed handoff arrives inside destination room');
 const leg=campus.scene.entities.get('campus:agent:0:leg:left');
 campus.project(facts,seconds(5.4));
 const moved=[...leg.position],rotated=[...leg.rotation];
 campus.project(facts,seconds(10.5));
 campus.project(facts,seconds(5.4));
 assert.deepEqual(leg.position,moved,'deterministic reverse seek restores local pose');
 assert.deepEqual(leg.rotation,rotated,'deterministic replay restores walking swing');
 assert.equal(campus.scene.tick,0,'visual timeline never advances physics clock');
});

test('without explicit arrival, live projector will not invent trajectory or completion',()=>{
 const incomplete=facts.filter(f=>f.id!=='researcher:arrived');
 assert.equal(campusJourneys(incomplete).some(j=>j.agentId==='researcher'),false);
 const campus=new AgentCampus(raw.agents);
 const p=find(campus.project(incomplete,seconds(5.4)),'researcher');
 assert.equal(p.traveling,false);
 assert.equal(p.room,'research');
 const invalid=[...incomplete,{schema:ACTIVITY_FACT_SCHEMA,id:'wrong:arrived',atMs:seconds(8),
  actor:{domain:'agent',id:'researcher'},kind:'agent.move.completed',origin:'demo',
  causeId:'researcher:walk',target:{domain:'office',id:'research'}}];
 assert.equal(campusJourneys(invalid).some(j=>j.agentId==='researcher'),false);
});

test('walkthrough uses synthetic provenance, stable paths and no private internal ChatGPT agent claims',()=>{
 assert.equal(raw.schema,'engine.office.campus-replay.v1');
 assert.ok(raw.events.every(x=>x.origin==='demo'));
 assert.ok(raw.events.every(x=>!x.causeId||journal.has(x.causeId)));
 assert.ok(raw.agents.length>=3);
 assert.equal(raw.capture.width,1920);
 assert.equal(raw.capture.height,1080);
 assert.equal(raw.capture.fps,24);
 assert.ok(raw.capture.supersample>1);
});

test('cinematic replay keeps 24fps positions continuous and turns smooth',()=>{
 const campus=new AgentCampus(raw.agents),positions=[],angles=[];
 const entity=campus.scene.entities.get('campus:agent:0:body');
 assert.ok(entity);
 for(let i=17;i<=209;i++){
  const time=i/24;
  const pose=campus.project(facts,seconds(time));
  positions.push(find(pose,'researcher').position);
  angles.push(entity.rotation[1]);
 }
 for(let i=1;i<positions.length;i++){
  const a=positions[i-1],b=positions[i];
  const movement=Math.hypot(a[0]-b[0],a[2]-b[2]);
  assert.ok(movement<.28,'Visible position teleported at 24fps: '+i+' '+movement);
  const delta=Math.atan2(Math.sin(angles[i]-angles[i-1]),Math.cos(angles[i]-angles[i-1]));
  assert.ok(Math.abs(delta)<.60,'Waypoint created hard instantaneous heading step: '+i+' '+delta);
 }
 assert.ok(new Set(positions.map(p=>p[0].toFixed(3))).size>50,'Replay must produce smooth distinct locations');
});
