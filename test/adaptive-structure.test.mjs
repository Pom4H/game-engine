import test from 'node:test';
import assert from 'node:assert/strict';
import {Scene,StructuralBody,material} from '../dist/index.js';

const steel=material('steel').mechanical;

function bar(iterations=8,failureStrain=.8){
  return new StructuralBody({
    nodes:[
      {position:[-.5,0,0],mass:2},
      {position:[.5,0,0],mass:2},
    ],
    constraints:[{
      kind:'distance',a:0,b:1,areaM2:3e-4,
      material:{...steel,yieldStressPa:8e6,failureStrain},
    }],
    iterations,
    sleepDelay:2,
  });
}

test('rigid activation transfers one mass and preserves the rigid linear momentum field',()=>{
  const body=bar();
  body.activateFromRigid([0,0,0],[3,-2,1],[0,.8,0]);
  assert.deepEqual([...body.linearMomentum()].map(x=>Math.round(x*1e9)/1e9),[12,-8,4]);
  assert.equal(body.totalMass,4);
  assert.equal(body.stats.mode,'active');
});

test('distributed contact impulse preserves total linear impulse',()=>{
  const body=bar(),before=body.linearMomentum(),J=[17,-5,3];
  body.activateFromRigid([0,0,0],[0,0,0],[0,0,0]);
  body.applyImpulse([.45,0,0],J,.3);
  const after=body.linearMomentum();
  for(let i=0;i<3;i++)assert.ok(Math.abs((after[i]-before[i])-J[i])<1e-10);
});

test('XPBD distance projection does not drift the centre of mass',()=>{
  const body=bar();
  body.position[3]=1.1;
  const before=(body.position[0]*body.mass[0]+body.position[3]*body.mass[1])/body.totalMass;
  body.activateFromRigid([0,0,0],[0,0,0],[0,0,0]);
  body.step(1/120,[0,0,0]);
  const after=(body.position[0]*body.mass[0]+body.position[3]*body.mass[1])/body.totalMass;
  assert.ok(Math.abs(after-before)<1e-10,{before,after});
  assert.ok(body.plasticWorkJ>0);
});

test('plastic return mapping is once per physical step, not once per solver iteration',()=>{
  const a=bar(4),b=bar(16);
  a.position[3]=b.position[3]=1.12;
  a.activateFromRigid([0,0,0],[0,0,0],[0,0,0]);
  b.activateFromRigid([0,0,0],[0,0,0],[0,0,0]);
  a.step(1/120,[0,0,0]);b.step(1/120,[0,0,0]);
  assert.ok(a.plasticWorkJ>0);
  assert.ok(Math.abs(a.plasticWorkJ-b.plasticWorkJ)<1e-9,{a:a.plasticWorkJ,b:b.plasticWorkJ});
});

test('failure is derived from predicted strain and survives bake',()=>{
  const body=bar(8,.05);
  body.position[3]=1.25;
  body.activateFromRigid([0,0,0],[0,0,0],[0,0,0]);
  body.step(1/120,[0,0,0]);
  assert.equal(body.broken[0],1);
  const before=[...body.position],baked=body.bake();
  assert.equal(body.stats.mode,'dormant');
  assert.deepEqual([...baked.positions],before);
  assert.equal(baked.broken[0],1);
  assert.ok(body.velocity.every(value=>value===0));
});

test('tetrahedral XPBD volume constraint resists local collapse',()=>{
  const body=new StructuralBody({
    nodes:[
      {position:[0,0,0],mass:1},
      {position:[1,0,0],mass:1},
      {position:[0,1,0],mass:1},
      {position:[0,0,1],mass:1},
    ],
    constraints:[{kind:'volume',a:0,b:1,c:2,d:3,compliance:0,yieldRatio:.5,breakRatio:.95,plasticity:0}],
    iterations:12,sleepDelay:2,
  });
  const volume=()=>{
    const p=body.position;
    const ax=p[3]-p[0],ay=p[4]-p[1],az=p[5]-p[2];
    const bx=p[6]-p[0],by=p[7]-p[1],bz=p[8]-p[2];
    const cx=p[9]-p[0],cy=p[10]-p[1],cz=p[11]-p[2];
    return (ax*(by*cz-bz*cy)-ay*(bx*cz-bz*cx)+az*(bx*cy-by*cx))/6;
  };
  const rest=volume();body.position[11]=.2;const collapsed=volume();
  body.activateFromRigid([0,0,0],[0,0,0],[0,0,0]);
  body.step(1/120,[0,0,0]);
  assert.ok(Math.abs(volume()-rest)<Math.abs(collapsed-rest),{rest,collapsed,after:volume()});
});

const panel={
  kind:'triangle-mesh',
  positions:[.98,-.42,-.72,.98,.42,-.72,.98,.42,.72,.98,-.42,.72,.55,-.42,-.72,.55,.42,-.72,.55,.42,.72,.55,-.42,.72],
  normals:[1,0,0,1,0,0,1,0,0,1,0,0,-1,0,0,-1,0,0,-1,0,0,-1,0,0],
  indices:[0,1,2,0,2,3,4,6,5,4,7,6],
};

test('reduced plastic deformation spends the authoritative contact energy instead of post-processing it twice',()=>{
  const scene=new Scene({
    version:1,gravity:[0,0,0],ground:-100,
    entities:[
      {id:'car',position:[-1.35,.55,0],material:{kind:'steel'},body:{mass:1200,velocity:[12,0,0],restitution:.2,friction:.4,collisionSize:[2,1,1.5]}},
      {id:'skin',position:[-1.35,.55,0],mesh:panel,material:{kind:'steel'}},
      {id:'wall',position:[0,.55,0],mesh:{kind:'box',size:[.22,1.7,2.2]},material:{kind:'default'},body:{mass:0,restitution:0,friction:.8}},
    ],
    deformation:{bodies:[{bodyId:'car',visualIds:['skin'],skinThicknessM:.0009,radiusM:.55,maxDentM:.65,minEnergyJ:20}]},
  });
  for(let i=0;i<12&&scene.deformation.inspect().plasticWorkJ===0;i++)scene.step(1/120);
  const info=scene.deformation.inspect(),contacts=scene.physics.contacts.filter(contact=>contact.a==='car'||contact.b==='car');
  assert.ok(info.plasticWorkJ>0,info);
  assert.ok(contacts.some(contact=>contact.mode==='penetrate'),contacts);
  const available=contacts.reduce((sum,contact)=>sum+contact.normalEnergy,0);
  assert.ok(info.plasticWorkJ<=available+1e-6,{plasticWorkJ:info.plasticWorkJ,available});
});
