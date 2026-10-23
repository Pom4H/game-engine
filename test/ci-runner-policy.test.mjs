import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {join} from 'node:path';

// Our GPU/physics visual evidence must come from the named Windows self-hosted
// worker. A hosted Apple job can introduce a different WebGPU backend and
// invalidates same-device performance comparisons.
const dir='.github/workflows';
const protectedWorkflows=[
  'fps-gpu.yml','fps-physics.yml','fps-material-ab.yml','city-benchmark.yml',
  'fps-windows-triple-ab.yml','quality-gates.yml',
  'offroad-demo.yml','character-creator.yml','meshwork-gpu.yml',
];
const files=readdirSync(dir).filter(file=>/\.ya?ml$/.test(file));
const load=file=>readFileSync(join(dir,file),'utf8');

test('no Actions workflow schedules Apple/macOS machines',()=>{
  assert.ok(files.length>=protectedWorkflows.length);
  for(const file of files){
    const source=load(file);
    assert.doesNotMatch(source,/^\s*runs-on:\s*.*\b(?:macos[-,\s\]]|apple[-,\s\]])/im,file);
  }
});

test('performance and rendering CI use only our Windows self-hosted worker',()=>{
  for(const file of protectedWorkflows){
    assert.ok(files.includes(file),file+' is missing');
    const runners=[...load(file).matchAll(/^\s*runs-on:\s*(.+)$/gm)].map(match=>match[1]);
    assert.ok(runners.length>0,file+' must declare a runner');
    for(const runner of runners){
      assert.match(runner,/\bself-hosted\b/i,file+': '+runner);
      assert.match(runner,/\bWindows\b/i,file+': '+runner);
      assert.doesNotMatch(runner,/ubuntu-|macos-/i,file+': '+runner);
    }
  }
});

test('every workflow runs on our self-hosted runners, never GitHub-hosted',()=>{
  for(const file of files){
    const source=load(file);
    // Include all jobs (even manual and reusable workflows), not only
    // performance benchmarks. Bolid is a separate repository and exempt.
    const runnerValues=[...source.matchAll(/^\s*runs-on:\s*(.+)$/gm)]
      .map(match=>match[1].trim()).filter(value=>!value.startsWith('#'));
    for(const runner of runnerValues){
      assert.match(runner,/\bself-hosted\b/i,file+': '+runner);
      assert.doesNotMatch(runner,/\b(?:ubuntu-|windows-|macos-|ubuntu-latest|windows-latest|macos-latest)\b/i,file+': '+runner);
    }
  }
});
