import test from 'node:test';
import assert from 'node:assert/strict';
import {JellyWaves,createCastleJelly,baseSpec,duration,phaseSpeedMps,dispersion} from '../tools/castle-jelly/scene.mjs';

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
 assert(state.waterEnergy>0);
 assert(state.longPhaseSpeedMps<state.shortPhaseSpeedMps);
 assert(state.visibleCrestCells>0, 'water displacement must be visible in the actual video');
 assert(state.maximumM-state.minimumM>.012, 'rendered water cannot be flat');
 assert(state.obstacleCells>0);
 const mesh=play.scene.entities.get('water-wave-mesh')?.mesh;
 assert(mesh?.kind==='triangle-mesh');
 assert(mesh.positions.length>20000);
});


test('capillary-gravity dispersion makes short wavelength phase velocity exceed long wavelength',()=>{
 assert(dispersion.capillaryFlexM4S2>0);
 assert(phaseSpeedMps(.48)>phaseSpeedMps(2.4)*1.3);
 assert.throws(()=>phaseSpeedMps(0));
});

test('actual field integration preserves wavelength-dependent phase speeds',()=>{
 const N=128,D=.12,LEFT=-(N-1)*D/2;
 function measuredSpeed(periods){
   const wave=new JellyWaves();
   wave.solid.fill(0); // Isolate dispersion from geometric scattering.
   const k=periods*2*Math.PI/(N*D);
   const row=38,x=64,center=row*N+x;
   for(let z=0;z<116;z++)for(let xx=0;xx<N;xx++)wave.height[z*N+xx]=.016*Math.cos(k*(LEFT+xx*D));
   const start=wave.height[center];
   for(let step=0;step<3;step++)wave.step(1/60);
   const ratio=Math.max(-1,Math.min(1,wave.height[center]/start));
   return Math.acos(ratio)/(.05*k);
 }
 const long=measuredSpeed(6),short=measuredSpeed(28);
 assert(Number.isFinite(long)&&Number.isFinite(short));
 assert(short>long*1.12,JSON.stringify({short,long}));
});
