import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';
import {CausalAuthority} from '../dist/network/index.js';

const scope=(domain,id)=>({domain,id});
const proposal=(grant,proposalId,payload,overrides={})=>({
 proposalId,scope:grant.scope,ownerId:grant.ownerId,epoch:grant.epoch,baseRevision:grant.revision,
 observedTick:10,action:'apply',payload,...overrides,
});

test('authority commit is the only mutation gate and revisions fence concurrent worker results',()=>{
 let tick=10,time=1,state=0,applies=0;const clock={get tick(){return tick;},get time(){return time;}};
 const authority=new CausalAuthority(clock,16,32),grant=authority.claim(scope('physics','region:41'),'gpu:worker-a');
 const a=proposal(grant,'p:a',3),b=proposal(grant,'p:b',4);
 assert.equal(state,0,'creating a worker result cannot mutate authority');
 const adapter={validate:value=>value>0,apply:value=>{applies++;state+=value;}};
 const accepted=authority.commit(a,adapter);assert.equal(accepted.decision,'accept');assert.equal(state,3);assert.equal(applies,1);assert.equal(accepted.grant.revision,1);
 assert.equal(authority.commit(b,adapter).decision,'stale-revision','second result based on the old state must not commit');assert.equal(state,3);assert.equal(applies,1);
 assert.equal(authority.commit(a,adapter).decision,'duplicate');assert.equal(state,3);
});

test('handoff increments epoch and makes every old CPU/GPU/NPU result uncommittable',()=>{
 let tick=10;const authority=new CausalAuthority({get tick(){return tick;},get time(){return tick/60;}});
 const old=authority.claim(scope('agents','city:ams'),'npu:0'),late=proposal(old,'npu:late',{intent:'take_bus'});
 const current=authority.handoff(old,'cpu:fallback');assert.equal(current.epoch,old.epoch+1);assert.equal(current.revision,old.revision);
 let applied=false;const adapter={validate:()=>true,apply:()=>{applied=true;}};
 assert.equal(authority.commit(late,adapter).decision,'stale-epoch');assert.equal(applied,false);
 const fresh=proposal(current,'cpu:fresh',{intent:'walk'});assert.equal(authority.commit(fresh,adapter).decision,'accept');assert.equal(applied,true);
});

test('scopes commit independently and invariant rejection never reaches apply',()=>{
 let tick=10;const authority=new CausalAuthority({get tick(){return tick;},get time(){return 2;}});
 const physics=authority.claim(scope('physics','car:1'),'cpu:p'),economy=authority.claim(scope('economics','city:1'),'npu:e');
 let car=0,money=100;
 assert.equal(authority.commit(proposal(physics,'car:move',2),{validate:()=>true,apply:v=>{car+=v;}}).decision,'accept');
 assert.equal(authority.grant(economy.scope).revision,0,'unrelated scope revision must not change');
 const rejected=authority.commit(proposal(economy,'economy:bad',-500),{validate:v=>money+v>=0,apply:v=>{money+=v;}});
 assert.equal(rejected.decision,'invariant-rejected');assert.equal(money,100);
 const accepted=authority.commit(proposal(economy,'economy:ok',-20),{validate:v=>money+v>=0,apply:v=>{money+=v;}});
 assert.equal(accepted.decision,'accept');assert.equal(money,80);assert.equal(car,2);
});

test('proposal deadlines use authority clock and ledger is bounded causal evidence',()=>{
 let tick=10;const authority=new CausalAuthority({get tick(){return tick;},get time(){return tick/10;}},8,4);
 let grant=authority.claim(scope('world','tile:0'),'worker:a');
 const adapter={validate:()=>true,apply:()=>{}};
 assert.equal(authority.commit(proposal(grant,'future',1,{observedTick:11}),adapter).decision,'future-tick');
 assert.equal(authority.commit(proposal(grant,'expired',1,{validThroughTick:10}),adapter).decision,'accept');grant=authority.grant(grant.scope);
 tick=12;assert.equal(authority.commit(proposal(grant,'too-late',1,{observedTick:10,validThroughTick:11}),adapter).decision,'expired');
 for(let i=0;i<5;i++){grant=authority.grant(grant.scope);authority.commit(proposal(grant,'p:'+i,i,{observedTick:tick,evidence:['worker:result:'+i]}),adapter);}
 const ledger=authority.ledger();assert.equal(ledger.length,4);assert.ok(ledger[0].sequence>1);assert.equal(ledger.at(-1).kind,'commit');
 assert.equal(authority.inspect().ledgerRecords,4);
});


test('authority core does not depend on execution placement or Meshwork',()=>{
 const source=readFileSync(resolve(process.cwd(),'src/network/causal-authority.ts'),'utf8');
 assert.doesNotMatch(source,/from\s+['"][^'"]*(meshwork|execution)/i);
});
