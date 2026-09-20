import test from 'node:test';
import assert from 'node:assert/strict';
import {AdaptiveStructuralController,M3_PARAMETRIC_PROFILE,Scene,StructuralBody,StructuralStaticContactSolver,applyStructuralSkin,bindStructuralSkin,material,passengerStructuralDefinition} from '../dist/index.js';

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

test('moving rigid translation can sleep structurally without being mistaken for internal motion',()=>{
  const mechanical={...steel,yieldStressPa:1e9,failureStrain:.9,plasticity:0};
  const body=new StructuralBody({
    nodes:[
      {position:[-1,-.5,-.5],mass:1},{position:[1,-.5,-.5],mass:1},
      {position:[0,1,-.5],mass:1},{position:[0,0,1],mass:1},
    ],
    constraints:[
      {kind:'distance',a:0,b:1,areaM2:1e-3,material:mechanical},
      {kind:'distance',a:0,b:2,areaM2:1e-3,material:mechanical},
      {kind:'distance',a:0,b:3,areaM2:1e-3,material:mechanical},
      {kind:'distance',a:1,b:2,areaM2:1e-3,material:mechanical},
      {kind:'distance',a:1,b:3,areaM2:1e-3,material:mechanical},
      {kind:'distance',a:2,b:3,areaM2:1e-3,material:mechanical},
      {kind:'volume',a:0,b:1,c:2,d:3,compliance:0,yieldRatio:.5,breakRatio:.95,plasticity:0},
    ],
    sleepDelay:.02,sleepSpeed:.01,internalDamping:12,iterations:8,
  });
  const linear=[20,1,-3],center=[0,0,-.125];
  body.activateFromRigid(center,linear,[0,0,0]);
  for(let i=0;i<4&&body.stats.mode==='active';i++)body.step(1/120,[0,0,0]);
  assert.equal(body.stats.mode,'dormant');
  const baked=body.takeBakedState();
  assert.ok(baked);
  for(let i=0;i<3;i++)assert.ok(Math.abs(baked.linearVelocity[i]-linear[i])<1e-10,JSON.stringify({actual:baked.linearVelocity,linear}));
});

test('manual structural bake preserves the current nodal linear and angular momentum exactly at the LOD boundary',()=>{
  const mechanical={...steel,yieldStressPa:1e9,failureStrain:.9,plasticity:0};
  const body=new StructuralBody({
    nodes:[
      {position:[-1,-.5,-.5],mass:1},{position:[1,-.5,-.5],mass:1},
      {position:[0,1,-.5],mass:1},{position:[0,0,1],mass:1},
    ],
    constraints:[
      {kind:'distance',a:0,b:1,areaM2:1e-3,material:mechanical},
      {kind:'distance',a:0,b:2,areaM2:1e-3,material:mechanical},
      {kind:'distance',a:0,b:3,areaM2:1e-3,material:mechanical},
      {kind:'distance',a:1,b:2,areaM2:1e-3,material:mechanical},
      {kind:'distance',a:1,b:3,areaM2:1e-3,material:mechanical},
      {kind:'distance',a:2,b:3,areaM2:1e-3,material:mechanical},
      {kind:'volume',a:0,b:1,c:2,d:3,compliance:0,yieldRatio:.5,breakRatio:.95,plasticity:0},
    ],
    sleepDelay:10,sleepSpeed:.001,internalDamping:12,iterations:8,
  });
  const centerOfMass=positions=>[
    (positions[0]+positions[3]+positions[6]+positions[9])/4,
    (positions[1]+positions[4]+positions[7]+positions[10])/4,
    (positions[2]+positions[5]+positions[8]+positions[11])/4,
  ];
  const nodalMomentum=()=>{
    const center=centerOfMass(body.position),P=[0,0,0],L=[0,0,0];
    for(let i=0;i<4;i++){
      const j=i*3,x=body.position[j]-center[0],y=body.position[j+1]-center[1],z=body.position[j+2]-center[2];
      const vx=body.velocity[j],vy=body.velocity[j+1],vz=body.velocity[j+2];
      P[0]+=vx;P[1]+=vy;P[2]+=vz;
      L[0]+=y*vz-z*vy;L[1]+=z*vx-x*vz;L[2]+=x*vy-y*vx;
    }
    return{center,P,L};
  };
  const rigidMomentum=baked=>{
    const {positions,centerOfMass:center,linearVelocity:v,angularVelocity:w}=baked,P=v.map(value=>value*4),L=[0,0,0];
    for(let i=0;i<4;i++){
      const j=i*3,x=positions[j]-center[0],y=positions[j+1]-center[1],z=positions[j+2]-center[2];
      const vx=v[0]+w[1]*z-w[2]*y,vy=v[1]+w[2]*x-w[0]*z,vz=v[2]+w[0]*y-w[1]*x;
      L[0]+=y*vz-z*vy;L[1]+=z*vx-x*vz;L[2]+=x*vy-y*vx;
    }
    return{P,L};
  };
  const initialCenter=centerOfMass(body.position);
  body.activateFromRigid(initialCenter,[20,1,-3],[.4,-.25,.3]);
  body.step(1/120,[0,0,0]);
  const before=nodalMomentum(),baked=body.bake(),after=rigidMomentum(baked);
  for(let i=0;i<3;i++){
    assert.ok(Math.abs(after.P[i]-before.P[i])<1e-10,JSON.stringify({before,after}));
    assert.ok(Math.abs(after.L[i]-before.L[i])<1e-9,JSON.stringify({before,after,omega:baked.angularVelocity}));
  }
});

test('render skin is a sparse binding over the structural cage, not a second physics mesh',()=>{
  const nodeRest=new Float64Array([0,0,0,1,0,0]);
  const binding=bindStructuralSkin([0,0,0,.5,0,0,1,0,0],nodeRest,2);
  const nodes=new Float64Array([0,1,0,1,0,0]),out=new Float64Array(9);
  applyStructuralSkin(binding,nodeRest,nodes,out);
  assert.deepEqual([...out],[0,1,0,.5,.5,0,1,0,0]);
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

test('adaptive structural LOD ignores small contacts, promotes severe impacts and returns one rigid handoff',()=>{
  const body=new StructuralBody({
    nodes:[{position:[-.5,0,0],mass:2},{position:[.5,0,0],mass:2}],
    constraints:[{kind:'distance',a:0,b:1,areaM2:3e-4,material:{...steel,yieldStressPa:1e9,failureStrain:.9,plasticity:0}}],
    sleepDelay:.02,sleepSpeed:.01,internalDamping:20,
  });
  const adaptive=new AdaptiveStructuralController(body,4,{specificEnergyJkg:100,minimumEnergyJ:500,impulseRadiusM:.4});
  const rigid={mass:4,centerOfMass:[0,0,0],linearVelocity:[8,0,0],angularVelocity:[0,0,0]};
  assert.equal(adaptive.thresholdJ,500);
  assert.equal(adaptive.activate(rigid,{point:[.5,0,0],impulse:[1,0,0],normalEnergyJ:499}),false);
  assert.equal(adaptive.mode,'reduced');
  assert.equal(adaptive.stats.rejectedContacts,1);

  assert.equal(adaptive.activate(rigid,{point:[.5,0,0],impulse:[0,0,0],normalEnergyJ:500}),true);
  assert.equal(adaptive.mode,'structural');
  assert.equal(adaptive.activate(rigid,{point:[.5,0,0],impulse:[0,0,0],normalEnergyJ:900}),false,'active mass must not be promoted twice');

  let handoff;
  for(let i=0;i<4&&!handoff;i++)handoff=adaptive.step(1/120,[0,0,0]);
  assert.ok(handoff);
  assert.equal(adaptive.mode,'reduced');
  assert.equal(adaptive.stats.activations,1);
  assert.ok(Math.abs(handoff.linearVelocity[0]-8)<1e-10,handoff);
  assert.equal(adaptive.step(1/120,[0,0,0]),undefined,'reduced tier must not keep simulating hidden structural mass');
});

test('adaptive structural controller rejects a second mass model',()=>{
  const body=bar();
  assert.throws(()=>new AdaptiveStructuralController(body,body.totalMass+1),/exactly the reduced rigid mass/);
});

test('M3 structural cage performs a real 90 km/h wall contact without a shrinking rigid box',()=>{
  const definition=passengerStructuralDefinition(M3_PARAMETRIC_PROFILE,1700,material('steel').mechanical);
  assert.equal(definition.nodes.length,28);
  assert.ok(definition.collisionTriangles.length>=50);
  const body=new StructuralBody({...definition,sleepDelay:2}),wall=new StructuralStaticContactSolver([
    {id:'wall',center:[0,1,0],half:[.20,1.5,2.2]},
  ],definition.collisionTriangles);
  body.translate([-3.0,0,0]);
  const center=body.centerOfMass(),initialXs=Array.from({length:body.nodeCount},(_,i)=>body.position[i*3]),initialFront=Math.max(...initialXs),initialRear=Math.min(...initialXs),initialSpan=initialFront-initialRear;
  body.activateFromRigid(center,[25,0,0],[0,0,0]);
  for(let tick=0;tick<28;tick++)body.step(1/120,[0,0,0],structure=>wall.project(structure));
  const finalFront=Math.max(...Array.from({length:body.nodeCount},(_,i)=>body.position[i*3]));
  assert.ok(wall.stats.contacts>0,wall.stats);
  assert.ok(body.plasticWorkJ>0,{plasticWorkJ:body.plasticWorkJ,contacts:wall.stats});
  assert.ok(body.broken.some(Boolean)||body.plasticWorkJ>100,{plasticWorkJ:body.plasticWorkJ,broken:[...body.broken]});
  assert.ok(finalFront<=-.20+1e-6,{initialFront,finalFront,wall:wall.stats});
  assert.ok(body.position.every(Number.isFinite));
  const rear=Math.min(...Array.from({length:body.nodeCount},(_,i)=>body.position[i*3])),finalSpan=finalFront-rear;
  assert.ok(finalSpan<initialSpan-.08,{initialRear,initialFront,initialSpan,rear,finalFront,finalSpan});
});

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
