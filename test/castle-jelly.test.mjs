import test from 'node:test';
import assert from 'node:assert/strict';
import {JellyWaves,createCastleJelly,baseSpec,duration} from '../tools/castle-jelly/scene.mjs';

test('Castle Jelly scene contains independently authored geometry',()=>{
 const ids=new Set(baseSpec.entities.map(e=>e.id));
 assert.equal(ids.size,baseSpec.entities.length);
 for(const part of ['castle-keep','island-meadow','falls-left-0','boat-hull','tank-deep-water'])assert(ids.has(part),part);
 assert(duration>=6);
});

test('a numerical wave propagates around the solid island without height inside rock',()=>{
 const wave=new JellyWaves();
 wave.inject(0,3.25,1,.4);
 for(let k=0;k<180;k++)wave.step(1/60);
 assert(wave.energy()>1e-8,'the wave must retain measurable energy');
 let solidCount=0,nonzero=0;
 for(let i=0;i<wave.solid.length;i++){
  if(wave.solid[i]){solidCount++;assert.equal(wave.height[i],0);}
  else if(Math.abs(wave.height[i])>1e-10)nonzero++;
 }
 assert(solidCount>300);
 assert(nonzero>500,'physical propagation must occupy many cells');
 const mesh=wave.surface();
 assert(mesh.indices.length>10000);
 assert(mesh.positions.every(Number.isFinite));
 assert(mesh.normals.every(Number.isFinite));
});

test('scene produces wave mesh from the canonical simulation state',()=>{
 const play=createCastleJelly();
 const before=play.waves.energy();
 const state=play.step(.75);
 assert(state.tick===45);
 assert(state.waterEnergy>before);
 assert(state.obstacleCells>0);
 const mesh=play.scene.entities.get('water-wave-mesh')?.mesh;
 assert(mesh?.kind==='triangle-mesh');
 assert(mesh.positions.length>20000);
});
