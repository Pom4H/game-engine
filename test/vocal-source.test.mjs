import test from 'node:test';
import assert from 'node:assert/strict';
import {PressureDrivenVocalFolds,CompliantVelopharyngealValve} from '../dist/index.js';

test('vocal folds decay without lung pressure and self-oscillate when pressure and adduction are present',()=>{
  const fs=48000,folds=new PressureDrivenVocalFolds(fs),silent=[],voiced=[];
  for(let i=0;i<fs*.08;i++)silent.push(folds.step({adduction:.9,tensionHz:120,lungPressurePa:0}).flowM3S);
  for(let i=0;i<fs*.30;i++)voiced.push(folds.step({adduction:.92,tensionHz:120,lungPressurePa:850}).flowM3S);
  const std=a=>{const m=a.reduce((s,v)=>s+v,0)/a.length;return Math.sqrt(a.reduce((s,v)=>s+(v-m)**2,0)/a.length);};
  assert.ok(std(silent)<1e-8);
  assert.ok(std(voiced.slice(-Math.floor(fs*.12)))>1e-6);
  assert.ok(folds.maxGapM>0);
  assert.ok(folds.maxFlowM3S>0);
});

test('vocal fold tension controls oscillation rate rather than an authored source phase',()=>{
  const estimate=tension=>{
    const fs=48000,folds=new PressureDrivenVocalFolds(fs),flow=[];
    for(let i=0;i<fs*.45;i++)flow.push(folds.step({adduction:.94,tensionHz:tension,lungPressurePa:900}).flowM3S);
    const tail=flow.slice(Math.floor(fs*.20)),mean=tail.reduce((a,b)=>a+b,0)/tail.length;
    let crossings=0,prev=tail[0]-mean;
    for(let i=1;i<tail.length;i++){const next=tail[i]-mean;if(prev<=0&&next>0)crossings++;prev=next;}
    return crossings/.25;
  };
  const low=estimate(105),high=estimate(170);
  assert.ok(low>55&&low<220);
  assert.ok(high>low*1.2);
});

test('soft palate valve changes nasal opening smoothly and pressure can deflect it',()=>{
  const fs=48000,valve=new CompliantVelopharyngealValve(fs);
  let a=0;for(let i=0;i<fs*.04;i++)a=valve.step({muscleOpen:0,pressureDeltaPa:0});
  const closed=a;
  let previous=a,maxJump=0;for(let i=0;i<fs*.08;i++){a=valve.step({muscleOpen:1,pressureDeltaPa:180});maxJump=Math.max(maxJump,Math.abs(a-previous));previous=a;}
  assert.ok(a>closed+.5);
  assert.ok(maxJump<.01);
  assert.ok(valve.maxPressureDeflectionCm2>0);
});
