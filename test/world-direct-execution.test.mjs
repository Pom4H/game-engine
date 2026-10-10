import test from 'node:test';
import assert from 'node:assert/strict';
import {Scene} from '../dist/scene/scene.js';
import {compileDirectScenePlan} from '../dist/scene/modules.js';

const spec=()=>({version:1,seed:29,ground:-100,gravity:[0,-9.81,0],entities:[
  {id:'floor',position:[0,-.1,0],mesh:{kind:'box',size:[20,.2,20]},body:{},material:{kind:'concrete'}},
  ...Array.from({length:12},(_,i)=>({id:`ball-${i}`,position:[i*.75,2+(i%3)*.5,0],mesh:{kind:'sphere',radius:.25},body:{mass:1,motion:'dynamic',velocity:[.1,0,0]},material:{kind:'steel'}}))
]});

test('direct program uses the exact selected kernel schedules and keeps state/event parity',()=>{
  for(const profile of ['detailed','active','aggregate','dormant']){
    const direct=new Scene(spec()),legacy=new Scene(spec());
    direct.setSimulationProfile(profile);
    legacy.setSimulationProfile(profile);
    assert.ok(compileDirectScenePlan(direct.kernel,direct.profile));
    for(let tick=0;tick<180;tick++){
      direct.step(1/60);
      legacy.step(1/60,profile);
      assert.deepEqual(direct.lastExecution,legacy.lastExecution,profile+' modules mismatch at '+tick);
      assert.deepEqual(direct.snapshot(),legacy.snapshot(),profile+' state mismatch at '+tick);
      assert.deepEqual(direct.drainEvents(),legacy.drainEvents(),profile+' events mismatch at '+tick);
    }
    assert.deepEqual(direct.physics.stats,legacy.physics.stats);
  }
});

test('third party modules force fallback without changing command semantics',()=>{
  const scene=new Scene(spec());
  scene.use({id:'extra',phase:'publish',rateHz:60,reads:[],writes:[],run:()=>[{type:'resource',key:'probe',value:42}]});
  assert.equal(compileDirectScenePlan(scene.kernel,scene.profile),undefined);
  scene.step(1/60);
  assert.ok(scene.lastExecution.includes('extra'));
  assert.equal(scene.resources.get('probe'),42);
});
