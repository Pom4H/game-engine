import test from 'node:test';
import assert from 'node:assert/strict';
import {Scene} from '../dist/index.js';
import {hillyTerrainMesh} from '../dist/procedural/terrain.js';
import {tyreRadialStiffness,tyreContactPatchLength,loadedTyreState} from '../dist/vehicles/tyre.js';
import {detailedOffroadWheelMeshes} from '../dist/vehicles/offroad-wheel.js';
import offroadSpec from '../tools/offroad/scene.mjs';

test('lower tyre pressure softens carcass and grows the physical contact patch',()=>{
 const high={pressurePa:240000,referencePressurePa:240000,radialStiffnessNPerM:180000,maxDeflectionM:.09},low={...high,pressurePa:120000};
 assert.ok(tyreRadialStiffness(low)<tyreRadialStiffness(high));
 const a=loadedTyreState(high,.49,5600),b=loadedTyreState(low,.49,5600);
 assert.ok(b.deflectionM>a.deflectionM,{high:a,low:b});
 assert.ok(b.contactPatchLengthM>a.contactPatchLengthM,{high:a,low:b});
 assert.equal(b.contactPatchLengthM,tyreContactPatchLength(.49,b.deflectionM));
});

test('offroad wheel projection has real lugs and a flattened loaded carcass',()=>{
 const wheel=detailedOffroadWheelMeshes({radius:.49,width:.37,rimRatio:.61,spokes:8,split:0,dish:.03,treadBlocks:40,treadDepthM:.032,deflectionM:.055,sidewallBulge:.1},1);
 assert.ok(wheel.tire.indices.length/3>1400,wheel.tire.indices.length/3);
 let minY=Infinity,maxY=-Infinity;for(let i=1;i<wheel.tire.positions.length;i+=3){minY=Math.min(minY,wheel.tire.positions[i]);maxY=Math.max(maxY,wheel.tire.positions[i]);}
 assert.ok(minY>-.49&&maxY>.49,{minY,maxY});
});

test('hilly terrain is irregular triangulated geometry rather than a flat shader plane',()=>{
 const mesh=hillyTerrainMesh({size:[40,28],segments:[32,22],amplitudeM:1.4,seed:7,irregularity:.3});
 let lo=Infinity,hi=-Infinity;for(let i=1;i<mesh.positions.length;i+=3){lo=Math.min(lo,mesh.positions[i]);hi=Math.max(hi,mesh.positions[i]);}
 assert.ok(hi-lo>1.5,{lo,hi});
 assert.equal(mesh.indices.length,32*22*6);
});

test('logical assembly wheel can transfer muddy water to its owning body',()=>{
 const scene=new Scene({version:1,ground:-5,entities:[
  {id:'road',position:[0,-.05,0],mesh:{kind:'box',size:[12,.1,5]},material:{kind:'default',finish:'rough',ageYears:80},environmental:{surfaceUse:'road',waterDepthM:.012},body:{}},
  {id:'car',position:[0,.7,0],mesh:{kind:'box',size:[2,1,1]},material:{kind:'steel'},body:{mass:1200,velocity:[4,0,0]}},
 ]});
 for(let i=1;i<=12;i++)scene.contacts.step(.05,i*.05,[],[{id:'car:front-left',bodyId:'car',position:[0,.01,0],velocity:[4,0,0],grounded:true,radius:.45,angularSpeed:9,normalLoadN:3200}]);
 const state=scene.surfaces.body('car');
 assert.ok(state&&state.roadDirt>.01,state);
 assert.ok(state&&state.wetness>0,state);
 assert.ok(scene.contacts.sprayEmitted>0,scene.contacts.inspect());
});


test('offroad demo runs the same cause chain from tyre load to muddy body state',()=>{
 const scene=new Scene(offroadSpec);
 const startX=scene.entities.get('offroad').position[0];
 for(let i=0;i<120;i++)scene.step(1/60);
 const car=scene.entities.get('offroad'),state=scene.surfaces.body('offroad');
 assert.ok(car.position[0]>startX+.5,{startX,x:car.position[0]});
 assert.ok(scene.contacts.sprayEmitted>0,scene.contacts.inspect());
 assert.ok(state&&state.roadDirt>0,state);
 assert.ok(state&&state.wetness>0,state);
});
