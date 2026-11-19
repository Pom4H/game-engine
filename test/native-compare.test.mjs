import test from 'node:test';
import assert from 'node:assert/strict';
import {summarize,cameraAt,restoreScene,assertComparisonAPI} from '../tools/native/compare/common.mjs';
import {comparePixels,aggregate} from '../tools/native/compare/analyze.mjs';

test('frame statistics keep stalls and use nearest-rank tails and slowest-one-percent mean',()=>{
 const s=summarize(Array.from({length:200},(_,i)=>({intervalMs:i===199?1000:i===198?500:10,gpuMs:null})));
 assert.equal(s.interval.p95,10);assert.equal(s.interval.p99,10);assert.equal(s.interval.max,1000);assert.equal(s.framesOver50ms,2);
 assert.equal(s.onePercentLowFPS,1000/750);assert.equal(s.averageFPS,1000/(3480/200));assert.equal(s.gpu,null);
 assert.throws(()=>summarize([]),RangeError);assert.throws(()=>summarize([{intervalMs:NaN}]),RangeError);
});
test('aggregation pools frame intervals instead of averaging FPS values',()=>{
 const a=[{intervalMs:10}],b=[{intervalMs:100},{intervalMs:100}];
 const r=aggregate({runs:[{moving:false,samples:a,summary:summarize(a)},{moving:false,samples:b,summary:summarize(b)}]},false);
 assert.equal(r.averageFPS,1000/70);assert.equal(r.interval.samples,3);assert.equal(r.repetitions,2);
});
test('pixel metrics include changed RGB pixels, ignore alpha, and do not conceal one-code errors',()=>{
 const a=Uint8Array.from([0,128,255,0,30,40,50,255]),b=Uint8Array.from([1,128,255,255,30,42,50,0]);
 const {metrics,diff}=comparePixels(a,b,2,1);assert.equal(metrics.changedPixels,2);assert.equal(metrics.changedChannels,2);assert.equal(metrics.maxError,2);assert.equal(metrics.mae,.5);assert.equal(metrics.channelsAbove2,0);assert.deepEqual([...diff],[255,0,0,255,0,255,0,255]);
 assert.equal(comparePixels(a,a,2,1).metrics.psnrDb,null);assert.throws(()=>comparePixels(a,b,3,1),RangeError);
});
test('camera path is periodic, preserves eye-target direction and does not mutate input',()=>{
 const base={position:[3,4,5],target:[6,8,10],fov:55},before=structuredClone(base),a=cameraAt(base,14,true,180),b=cameraAt(base,194,true,180);
 for(let i=0;i<3;i++){assert.ok(Math.abs(a.position[i]-b.position[i])<1e-12);assert.ok(Math.abs((a.target[i]-a.position[i])-(base.target[i]-base.position[i]))<1e-12);}
 assert.deepEqual(base,before);assert.deepEqual(cameraAt(base,50,false),base);
});
test('recorded scene preserves shared meshes, surface data and moving render partition',()=>{
 class Scene{constructor(spec){this.spec=spec;this.entities=new Map(spec.entities.map(e=>[e.id,e]));}setVisualTransform(id,p,r,s){this.mover=[id,p,r,s];}}
 const mesh={type:'box'},surface={roughness:.4},packet={spec:{seed:29},primitives:[mesh],entities:[{id:'a',mesh:0,renderMesh:0,position:[1,2,3],rotation:[0,0,0],scale:[1,1,1],material:{color:[1,0,0]}}],camera:{position:[1,2,3]},environment:{hour:8},time:12,tick:60,surfaces:{a:surface},movers:['a']};
 const scene=restoreScene(packet,Scene),a=scene.entities.get('a');assert.equal(a.mesh,a.renderMesh);assert.equal(a.mesh,mesh);assert.equal(a.material.surface,surface);assert.deepEqual(scene.mover,['a',a.position,a.rotation,a.scale]);assert.equal(scene.time,12);assert.equal(scene.tick,60);assert.ok(Object.isFrozen(a.material));
});
test('old engine is rejected before running an incompatible benchmark',()=>{
 assert.throws(()=>assertComparisonAPI(class{},class{}),/ENGINE_ROOT/);
});
