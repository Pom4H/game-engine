import test from 'node:test';
import assert from 'node:assert/strict';
import {Scene} from '../dist/scene/scene.js';
import {validateScene} from '../dist/scene/validate.js';
import {cameraOnRail} from '../dist/scene/camera-rail.js';
import {buildLightGrid,lightEmissionWeight,LIGHT_SOURCE_FLOATS} from '../dist/render/light-grid.js';
import scene,{camera,cameraRail,referenceEntities} from '../tools/arcade/reference.scene.mjs';
import {cobbledRoad,lanternEmission} from '../tools/arcade/street.mjs';

test('camera rail is continuous at the loop seam and deterministic across segment replays',()=>{
 const start=cameraOnRail(camera,cameraRail,0),loop=cameraOnRail(camera,cameraRail,90);
 assert.deepEqual(start,loop);
 const epsilon=.0001,a=cameraOnRail(camera,cameraRail,90-epsilon),b=cameraOnRail(camera,cameraRail,epsilon);
 for(let k=0;k<3;k++)assert.ok(Math.abs((start.position[k]-a.position[k])/epsilon-(b.position[k]-start.position[k])/epsilon)<.001);
 assert.notDeepEqual(cameraOnRail(camera,cameraRail,25).position,start.position);
 const spec={version:1,camera,cameraRail,entities:[]},one=new Scene(spec),two=new Scene(structuredClone(spec));
 for(let i=0;i<120;i++)one.step(1/60);
 for(let i=0;i<240;i++)two.step(1/120);
 for(let k=0;k<3;k++)assert.ok(Math.abs(one.camera.position[k]-two.camera.position[k])<1e-8);
 one.setCamera(camera);one.step();assert.deepEqual(one.camera,camera);
 assert.throws(()=>validateScene({...spec,cameraRail:{...cameraRail,durationSeconds:0}}),TypeError);
 assert.throws(()=>validateScene({...spec,cameraRail:{...cameraRail,keyframes:cameraRail.keyframes.slice(0,2)}}),TypeError);
});

test('lantern housing suppresses roof spill and casts four rib sectors without changing point lights',()=>{
 assert.equal(lightEmissionWeight(undefined,[0,1,0]),1);
 assert.equal(lightEmissionWeight(lanternEmission,[0,1,0]),0);
 assert.equal(lightEmissionWeight(lanternEmission,[0,-1,0]),1);
 const pane=lightEmissionWeight(lanternEmission,[1,0,0]),rib=lightEmissionWeight(lanternEmission,[1,0,1]);
 assert.ok(pane>.1&&rib<.001);
 assert.ok(Math.abs(pane-lightEmissionWeight(lanternEmission,[0,0,1]))<1e-8);
 const grid=buildLightGrid([{position:[0,3,0],light:{kind:'point',intensity:10,range:8,emission:lanternEmission}},{position:[1,3,0],light:{kind:'point',intensity:1,range:8}}],[0,2,0]);
 assert.equal(grid.lights.length,4+256*LIGHT_SOURCE_FLOATS);
 assert.deepEqual([...grid.lights.slice(12,15)],[0,-1,0]);
 assert.deepEqual([...grid.lights.slice(4+LIGHT_SOURCE_FLOATS+8,4+LIGHT_SOURCE_FLOATS+16)],[0,0,0,0,0,0,0,0]);
 assert.throws(()=>validateScene({version:1,entities:[{id:'bad',light:{kind:'point',emission:{...lanternEmission,axis:[0,0,0]}}}]}),TypeError);
 assert.equal(referenceEntities.filter(e=>/^street-lantern-\d+-light$/.test(e.id)).length,4);
 assert.ok(!referenceEntities.some(e=>e.id==='lamp-aureole'));
 assert.equal(scene.rendering.reflectionProbe.facesPerFrame,1);
});

test('cobbled streets have seeded relief, bevel normals and no overlapping legacy setts',()=>{
 const mesh=cobbledRoad(0,2,0,2,51);assert.deepEqual(mesh,cobbledRoad(0,2,0,2,51));
 assert.notDeepEqual(mesh.colors,cobbledRoad(0,2,0,2,52).colors);
 assert.equal(mesh.positions.length/3*4,mesh.colors.length);
 assert.ok(mesh.positions.every(Number.isFinite));
 assert.ok(mesh.normals.some((v,i)=>i%3===1&&v>0&&v<.99));
 for(let i=0;i<mesh.indices.length;i+=3){
  const [a,b,c]=mesh.indices.slice(i,i+3).map(n=>mesh.positions.slice(n*3,n*3+3)),u=b.map((v,k)=>v-a[k]),v=c.map((x,k)=>x-a[k]);
  const cross=[u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0]],normal=mesh.normals.slice(mesh.indices[i]*3,mesh.indices[i]*3+3);
  assert.ok(cross.reduce((sum,n,k)=>sum+n*normal[k],0)>0);
 }
 assert.ok(!referenceEntities.some(e=>/^sett-|^wet-patch-/.test(e.id)));
 assert.equal(referenceEntities.filter(e=>/^cobbled-.*-road$/.test(e.id)).length,2);
 validateScene(scene);
});
