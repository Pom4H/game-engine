import test from 'node:test';
import assert from 'node:assert/strict';
import {Scene} from '../dist/index.js';
import {hillyTerrainMesh,hillyTerrainHeight,polygonSurfaceGrid} from '../dist/procedural/terrain.js';
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


test('terrain corridor cuts and fills one continuous mesh to the authored offroad profile',()=>{
 const options={size:[40,20],segments:[40,20],amplitudeM:2,seed:11,corridors:[{points:[[-15,.2,0],[0,1.1,0],[15,.4,0]],halfWidthM:3,shoulderM:4}]};
 assert.ok(Math.abs(hillyTerrainHeight(options,-15,0)-.2)<1e-9);
 assert.ok(Math.abs(hillyTerrainHeight(options,0,0)-1.1)<1e-9);
 const edge=hillyTerrainHeight(options,0,8),natural=hillyTerrainHeight({...options,corridors:[]},0,8);
 assert.ok(Math.abs(edge-natural)<1e-9,{edge,natural});
});

test('mud patch is dense clipped geometry rather than a rectangular slab',()=>{
 const shape=[[-4,-2],[-1,-2.5],[4,-1.7],[3.4,2.2],[-2,2.5],[-4,1]];
 const mesh=polygonSurfaceGrid(shape,.2);
 assert.ok(mesh.indices.length/3>500,mesh.indices.length/3);
 let minX=Infinity,maxX=-Infinity,minZ=Infinity,maxZ=-Infinity;
 for(let i=0;i<mesh.positions.length;i+=3){minX=Math.min(minX,mesh.positions[i]);maxX=Math.max(maxX,mesh.positions[i]);minZ=Math.min(minZ,mesh.positions[i+2]);maxZ=Math.max(maxZ,mesh.positions[i+2]);}
 assert.ok(maxX-minX>7&&maxZ-minZ>3,{minX,maxX,minZ,maxZ});
});

test('offroad demo owns real water volume and a deformable non-rectangular mud projection',()=>{
 const scene=new Scene(offroadSpec),mud=scene.entities.get('track-mud'),water=scene.entities.get('water-sheet');
 assert.equal(scene.fluids.size,1);
 assert.equal(mud.mesh.kind,'polygon-prism');
 assert.equal(mud.renderMesh.kind,'triangle-mesh');
 assert.ok(mud.renderMesh.indices.length/3>1000,mud.renderMesh.indices.length/3);
 assert.equal(water.material.kind,'glass');
});


test('vehicle visual children are render-only projections of the authoritative assembly',()=>{
 const scene=new Scene(offroadSpec),car=scene.entities.get('offroad'),glass=scene.entities.get('offroad-glass'),tyre=scene.entities.get('offroad-front-left-tyre'),rim=scene.entities.get('offroad-front-left-rim');
 assert.ok(car?.body&&glass&&tyre&&rim);
 assert.equal(glass.body,undefined);assert.equal(tyre.body,undefined);assert.equal(rim.body,undefined);
 assert.equal(glass.material.kind,'glass');assert.equal(tyre.material.kind,'rubber');assert.equal(rim.material.kind,'aluminum');
 const before=[...rim.rotation];for(let i=0;i<60;i++)scene.step(1/60);
 assert.notDeepEqual(rim.rotation,before,'rim spin must project from the physical wheel');
 assert.ok(Math.hypot(tyre.position[0]-car.position[0],tyre.position[2]-car.position[2])>.5);
});
