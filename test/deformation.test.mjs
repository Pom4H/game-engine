import test from 'node:test';
import assert from 'node:assert/strict';
import {Scene,validateScene} from '../dist/index.js';

const panel={
  kind:'triangle-mesh',
  positions:[
    .98,-.42,-.72,  .98,.42,-.72,  .98,.42,.72,  .98,-.42,.72,
    .55,-.42,-.72,  .55,.42,-.72,  .55,.42,.72,  .55,-.42,.72,
  ],
  normals:[
    1,0,0, 1,0,0, 1,0,0, 1,0,0,
    -1,0,0,-1,0,0,-1,0,0,-1,0,0,
  ],
  indices:[0,1,2,0,2,3,4,6,5,4,7,6],
};

function spec(speed=10,minEnergyJ=20){
 return{
  version:1,gravity:[0,0,0],ground:-100,
  entities:[
   {id:'car',position:[-2,.55,0],material:{kind:'steel'},body:{mass:1200,velocity:[speed,0,0],restitution:0,friction:.4,collisionSize:[2,1,1.5]}},
   {id:'skin',position:[-2,.55,0],mesh:panel,material:{kind:'steel',treatment:'painted'}},
   {id:'wall',position:[0,.55,0],mesh:{kind:'box',size:[.22,1.7,2.2]},material:{kind:'default'},body:{mass:0,restitution:0,friction:.8}},
  ],
  deformation:{bodies:[{bodyId:'car',visualIds:['skin'],skinThicknessM:.0009,radiusM:.55,maxDentM:.65,minEnergyJ}]},
 };
}
function run(input=spec()){
 const scene=new Scene(input),before=[...scene.entities.get('skin').mesh.positions];
 for(let i=0;i<50;i++)scene.step(1/120);
 const skin=scene.entities.get('skin'),car=scene.entities.get('car');
 return{scene,before,after:[...skin.mesh.positions],dents:scene.deformation.dents('car'),car};
}

test('plastic contact creates a persistent local dent and shrinks the contacted collision side',()=>{
 const {before,after,dents,car}=run();
 assert.ok(dents.length>=1,JSON.stringify(dents));
 assert.ok(dents.some(d=>d.depth>.005));
 assert.notDeepEqual(after,before);
 assert.ok(car.body.collisionHalf[0]<car.body.shape.half[0]);
 assert.ok(car.body.collisionOffsetLocal[0]<0,'positive-X nose crush must shift collision center rearward');
 const deformed=[...after],depth=car.body.shape.half[0]-car.body.collisionHalf[0];
 for(let i=0;i<120;i++)car.body.velocity=[0,0,0];
 assert.ok(depth>0&&deformed.some((value,index)=>Math.abs(value-before[index])>1e-4));
});

test('deformation is deterministic for equal contact history',()=>{
 const a=run(),b=run();
 assert.deepEqual(a.dents,b.dents);
 assert.deepEqual(a.after,b.after);
 assert.deepEqual(a.car.body.collisionHalf,b.car.body.collisionHalf);
 assert.deepEqual(a.car.body.collisionOffsetLocal,b.car.body.collisionOffsetLocal);
});

test('high deformation threshold leaves elastic contacts visually unchanged',()=>{
 const {before,after,dents,car}=run(spec(5,1_000_000));
 assert.deepEqual(dents,[]);
 assert.deepEqual(after,before);
 assert.deepEqual(car.body.collisionHalf,[1,.5,.75]);
 assert.deepEqual(car.body.collisionOffsetLocal,[0,0,0]);
});

test('deformation authoring validates body-only collision envelopes and visual ownership',()=>{
 assert.throws(()=>validateScene({version:1,entities:[
  {id:'root',material:{kind:'steel'},body:{mass:100,velocity:[1,0,0]}},
  {id:'skin',mesh:panel},
 ],deformation:{bodies:[{bodyId:'root',visualIds:['skin']}]}}),/collisionSize/);
 assert.throws(()=>validateScene({version:1,entities:[
  {id:'root',material:{kind:'steel'},body:{mass:100,collisionSize:[2,1,1]}},
  {id:'skin',mesh:{kind:'box'}},
 ],deformation:{bodies:[{bodyId:'root',visualIds:['skin']}]}}),/triangle mesh/);
});
