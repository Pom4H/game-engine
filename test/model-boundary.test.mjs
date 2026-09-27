import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import * as locomotion from '../dist/animation/locomotion.js';
import {AnimationSystem} from '../dist/animation/system.js';
import {validateScene} from '../dist/scene/validate.js';
import {Scene} from '../dist/scene/scene.js';

const source=path=>readFile(new URL(`../src/${path}`,import.meta.url),'utf8');

test('locomotion model and application contract do not import the scene implementation',async()=>{
 for(const path of ['animation/locomotion.ts','animation/system.ts']){
  const text=await source(path);
  assert.doesNotMatch(text,/from\s*['"][^'"]*\/(?:scene|runtime|render|network)\//);
  assert.doesNotMatch(text,/\bRuntimeEntity\b/);
 }
 assert.equal('AnimationSystem' in locomotion,false,'no legacy runtime re-export from the model');
 const validation=await source('scene/validate.ts');
 assert.doesNotMatch(validation,/AnimationSystem/,'schema validation must not instantiate and populate a runtime system');
});

test('numeric gait is repeatable from explicit time, terrain and previous pose',()=>{
 const walker={id:'walker',root:[10,.2,-3],heading:.73,speed:.86,period:1.3};
 const terrain=p=>({height:.23+(p[0]-10)*.025,snowDepth:.05});
 const sample=()=>{
  const poses=[];let previous;
  for(let tick=0;tick<120;tick++){
   previous=locomotion.sampleWalker(walker,tick/60,terrain,previous);
   poses.push(previous);
  }
  return poses;
 };
 assert.deepEqual(sample(),sample());
 assert.deepEqual(walker.root,[10,.2,-3]);
});

test('animation applies to borrowed plain transforms without wrappers or a Scene',()=>{
 const entity={id:'body',position:[0,0,0],rotation:[0,0,0],scale:[1,1,1]};
 const position=entity.position,rotation=entity.rotation,scale=entity.scale;
 const targets=new Map([[entity.id,entity]]),animation=new AnimationSystem();
 animation.addVehicle({id:'vehicle',velocity:[2,0,0],parts:[{id:'body',origin:[-3,0,0]}]});
 animation.step(.5,targets);
 assert.strictEqual(targets.get('body'),entity);
 assert.strictEqual(entity.position,position);
 assert.strictEqual(entity.rotation,rotation);
 assert.strictEqual(entity.scale,scale);
 assert.deepEqual(entity.position,[-2,0,0]);
 animation.step(1,targets);
 assert.deepEqual(entity.position,[-1,0,0]);
});

test('authoring validation keeps actor ownership and required wheel radii without runtime state',()=>{
 const walker={id:'same',root:[0,0,0],speed:1};
 assert.throws(()=>validateScene({version:1,entities:[],animation:{walkers:[walker,walker]}}),/Duplicate animated actor/);
 const vehicle={id:'same',velocity:[1,0,0],parts:[{id:'body',origin:[0,0,0]}]};
 assert.throws(()=>validateScene({version:1,entities:[{id:'body'}],animation:{walkers:[walker],vehicles:[vehicle]}}),/Duplicate animated actor/);
 vehicle.id='vehicle';vehicle.parts[0].wheel=true;
 const input={version:1,entities:[{id:'body'}],animation:{vehicles:[vehicle]}};
 assert.throws(()=>validateScene(input),/radius/);
 vehicle.parts[0].radius=.3;
 const scene=validateScene(input);
 assert.deepEqual(scene,input);
 assert.notStrictEqual(scene,input);
});

test('surface state has one public entry rather than a legacy winter alias',()=>{
 assert.equal('winter' in Scene.prototype,false);
 const scene=new Scene({version:1,entities:[]});
 assert.ok(scene.surfaces);
});
