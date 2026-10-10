import test from 'node:test';
import assert from 'node:assert/strict';
import {CodexActivityAdapter} from '../dist/observability/adapters/codex.js';
import {ActivityJournal} from '../dist/observability/activity.js';
import {projectOfficeAgents} from '../dist/observability/office.js';

const event=(method,params)=>({jsonrpc:'2.0',method,params});
test('Codex app-server notification lifecycle projects real parent and child threads',()=>{
 const adapter=new CodexActivityAdapter(),journal=new ActivityJournal();
 const deliver=(method,params,at)=>journal.ingestMany(adapter.push(event(method,params),at));
 deliver('thread/started',{thread:{id:'root-01'}},1000);
 deliver('turn/started',{threadId:'root-01',turn:{id:'turn-1',status:'inProgress'}},1100);
 deliver('item/started',{threadId:'root-01',turnId:'turn-1',item:{
  id:'collab-1',type:'collabAgentToolCall',receiverThreadIds:['child-01'],tool:'spawnAgent'}},1200);
 deliver('thread/started',{thread:{id:'child-01'}},1250);
 deliver('turn/started',{threadId:'child-01',turn:{id:'child-turn-1'}},1350);
 deliver('item/started',{threadId:'child-01',turnId:'child-turn-1',
  item:{id:'cmd-1',type:'commandExecution',command:'do-not-leak-command --secret=password'}},1600);
 deliver('item/completed',{threadId:'child-01',turnId:'child-turn-1',
  item:{id:'cmd-1',type:'commandExecution',command:'do-not-leak-command --secret=password',status:'completed',exitCode:0}},2000);
 deliver('thread/tokenUsage/updated',{threadId:'child-01',tokenUsage:{totalTokenUsage:{totalTokens:120}}},2100);
 deliver('thread/tokenUsage/updated',{threadId:'child-01',tokenUsage:{totalTokenUsage:{totalTokens:120}}},2200);
 deliver('thread/tokenUsage/updated',{threadId:'child-01',tokenUsage:{totalTokenUsage:{totalTokens:157}}},2300);
 deliver('turn/completed',{threadId:'child-01',turn:{id:'child-turn-1',status:'completed'}},2450);
 const facts=journal.snapshot();
 const children=facts.filter(f=>f.actor.id==='child-01');
 assert.equal(children.filter(f=>f.kind==='agent.started').length,1,'exactly one observed subagent');
 assert.equal(children.find(f=>f.kind==='agent.started')?.causeId,
  facts.find(f=>f.kind==='agent.tool.started'&&f.actor.id==='root-01')?.id,
  'subagent is causally linked to explicitly observed collaboration');
 assert.equal(children.filter(f=>f.kind==='agent.tool.started').length,1);
 const complete=children.find(f=>f.kind==='agent.tool.completed');
 assert.equal(complete?.causeId,children.find(f=>f.kind==='agent.tool.started')?.id);
 assert.equal(children.filter(f=>f.kind==='agent.usage.updated').length,2,'duplicate cumulative usage is not charged twice');
 const states=projectOfficeAgents([{id:'child-01',name:'Observed Codex'}],facts,2500);
 assert.equal(states[0].phase,'done');assert.equal(states[0].tokens,157);
 assert.equal(facts.some(f=>JSON.stringify(f).includes('password')),false,'commands and other private payloads stay outside the projection');
 assert.equal(journal.lineage(children[0].id).unresolvedCauseId,undefined);
});
test('Codex errors, incomplete events and unsupported reasoning are not invented',()=>{
 const adapter=new CodexActivityAdapter(),journal=new ActivityJournal();
 const publish=(method,params,at)=>journal.ingestMany(adapter.push(event(method,params),at));
 publish('turn/started',{threadId:'root',turn:{id:'turn2'}},1000);
 publish('item/started',{threadId:'root',turnId:'turn2',item:{id:'cmd2',type:'commandExecution',command:'private'}},1200);
 publish('item/completed',{threadId:'root',turnId:'turn2',item:{id:'cmd2',type:'commandExecution',exitCode:2,status:'failed'}},1400);
 publish('item/started',{threadId:'root',turnId:'turn2',item:{id:'reason1',type:'reasoning',text:'hidden'}} ,1500);
 publish('turn/completed',{threadId:'root',turn:{id:'turn2',status:'failed'}},1700);
 assert.equal(journal.snapshot().filter(f=>f.kind==='agent.tool.failed').length,1);
 assert.equal(projectOfficeAgents([{id:'root',name:'Root'}],journal.snapshot(),1600)[0].phase,'blocked');
 assert.equal(journal.snapshot().some(f=>JSON.stringify(f).includes('hidden')),false);
 assert.equal(projectOfficeAgents([{id:'root',name:'Root'}],journal.snapshot(),2000)[0].phase,'blocked');
 assert.deepEqual(adapter.push(event('item/completed',{threadId:'root',item:{type:'agentMessage',id:'x'}}),2200),[]);
 assert.deepEqual(adapter.push({method:'item/started',params:{item:{id:'none',type:'commandExecution'}}},2300),[],
 'missing thread id is not guessed');
 assert.throws(()=>adapter.push(event('turn/started',{threadId:'root'}),Number.NaN),/receipt time/);
});
