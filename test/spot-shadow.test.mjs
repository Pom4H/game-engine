import test from 'node:test';
import assert from 'node:assert/strict';
import {Scene} from '../dist/scene/scene.js';
import {selectSpotShadows,SPOT_SHADOW_LIMIT} from '../dist/render/spot-shadow.js';
import {buildLightGrid,LIGHT_SOURCE_FLOATS} from '../dist/render/light-grid.js';
const lamp=(id,x=0)=>({id,position:[x,1,0],light:{kind:'point',intensity:10,range:20,castShadow:true,emission:{axis:[0,0,1],innerAngle:.1,outerAngle:.55}}});
const project=(matrix,p)=>[0,1,2,3].map(row=>matrix[row]*p[0]+matrix[row+4]*p[1]+matrix[row+8]*p[2]+matrix[row+12]);

test('spot shadow selection is bounded, rejects aggregate/point/wide sources, and retains left/right slots',()=>{
 const a=lamp('left',-.6),b=lamp('right',.6),far=lamp('far',60),aggregate=lamp('aggregate');aggregate.light.castShadow=false;
 const point=lamp('point');delete point.light.emission;
 const wide=lamp('wide');wide.light.emission.outerAngle=2;
 const first=selectSpotShadows([a,b,far,aggregate,point,wide],[0,2,0]);assert.equal(first.length,SPOT_SHADOW_LIMIT);
 const next=selectSpotShadows([b,a,far],[2,2,0],first);
 for(const original of first)assert.equal(next.find(s=>s.source.id===original.source.id).slot,original.slot);
 assert.deepEqual(selectSpotShadows([far],[0,0,0]),[]);assert.equal(selectSpotShadows([],[0,0,0],first).length,0);
});

test('each spot projection looks along the light, covers near/far and remains finite for vertical beams',()=>{
 for(const axis of [[0,0,1],[0,1,0],[0,-1,0],[1,0,0]]){
  const source=lamp('beam');source.light.emission.axis=axis;
  const [{matrix}]=selectSpotShadows([source],[0,0,0]);assert.ok([...matrix].every(Number.isFinite));
  for(const distance of [.08,1,19.9]){
   const p=source.position.map((v,i)=>v+axis[i]*distance),clip=project(matrix,p);
   assert.ok(Math.abs(clip[0]/clip[3])<1e-4&&Math.abs(clip[1]/clip[3])<1e-4);
   assert.ok(clip[2]/clip[3]>=-1e-5&&clip[2]/clip[3]<=1.00001);
  }
  const behind=project(matrix,source.position.map((v,i)=>v-axis[i]));assert.ok(behind[3]<0);
 }
});

test('shadow slots follow source identities through independent light-grid ranking and clear after lights disappear',()=>{
 const a=lamp('dim'),b=lamp('bright',1);b.light.intensity=100;
 const grid=buildLightGrid([a,b],[0,0,0],new Map([[a,0],[b,1]]));
 assert.equal(grid.lights[4+19],2);assert.equal(grid.lights[4+LIGHT_SOURCE_FLOATS+19],1);
 const cleared=buildLightGrid([a,b],[0,0,0]);assert.equal(cleared.lights[4+19],0);assert.equal(cleared.lights[4+LIGHT_SOURCE_FLOATS+19],0);
});

test('spot shadow opt-in is validated and does not change a light or install physics',()=>{
 const source=lamp('beam'),scene=new Scene({version:1,entities:[{...source,renderOnly:true}]});
 assert.equal(scene.entities.get('beam').light.castShadow,true);assert.equal(scene.physics.bodies.size,0);
 for(const light of [{...source.light,castShadow:'yes'},{...source.light,emission:undefined},{...source.light,emission:{...source.light.emission,outerAngle:2}}])assert.throws(()=>new Scene({version:1,entities:[{id:'bad',light}]}),/castShadow/);
});
