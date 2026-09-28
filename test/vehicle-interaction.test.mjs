import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DoorHinge,ElasticPlasticPanelResponse,FourCornerSuspension,M3InteractionRig,
  M3_REFERENCE_PROVENANCE,M3_VEHICLE_DEFINITION,Scene,StructuralBody,generateM3Vehicle,m3PartBody,m3PartMaterial,
  material,renderAudio,thermalLinearScale,
} from '../dist/index.js';

test('cold steel contracts the stress-free XPBD rest geometry without creating plastic work',()=>{
  const steel=material('steel').mechanical,body=new StructuralBody({
    nodes:[{position:[-2.4,0,0],mass:1},{position:[2.4,0,0],mass:1}],
    constraints:[{kind:'distance',a:0,b:1,areaM2:1e-3,material:steel}],
  });
  const scale=thermalLinearScale('steel',-15,20);
  assert.ok(Math.abs(scale-.9995765)<1e-10,scale);
  body.setThermalScale(scale);
  assert.equal(body.stats.mode,'dormant');
  const length=body.position[3]-body.position[0];
  assert.ok(Math.abs(length-4.8*scale)<1e-9,{length,scale});
  assert.equal(body.plasticWorkJ,0);
});

test('thin steel panel returns after sub-yield hand tap but retains a dent after enough energy',()=>{
  const panel=new ElasticPlasticPanelResponse(),point=[0,1,0],normal=[0,1,0];
  const light=panel.impact({point,normal,energyJ:2,radiusM:.18,thicknessM:.0008,material:'steel'});
  assert.equal(light.plasticEnergyJ,0);
  assert.equal(panel.maxPermanentDepthM,0);
  assert.ok(panel.maxElasticDepthM>0);
  for(let i=0;i<360;i++)panel.step(1/240);
  assert.ok(panel.maxElasticDepthM<1e-4,panel.maxElasticDepthM);
  const hard=panel.impact({point,normal,energyJ:160,radiusM:.22,thicknessM:.0008,material:'steel'});
  assert.ok(hard.plasticEnergyJ>0,hard);
  assert.ok(panel.maxPermanentDepthM>.0002,panel.maxPermanentDepthM);
});

test('glass hand tap remains elastic, finite at 120 Hz, and produces no plastic dent',()=>{
  const panel=new ElasticPlasticPanelResponse();
  const result=panel.impact({point:[0,1,0],normal:[0,0,1],energyJ:.7,radiusM:.08,thicknessM:.004,material:'glass'});
  assert.equal(result.plasticEnergyJ,0);
  assert.equal(panel.maxPermanentDepthM,0);
  for(let i=0;i<300;i++)panel.step(1/120);
  assert.ok(Number.isFinite(panel.maxElasticDepthM),panel.maxElasticDepthM);
  assert.ok(panel.maxElasticDepthM<1e-4,panel.maxElasticDepthM);
});

test('four-corner suspension rolls under alternating left/right hood loads and emits damper events',()=>{
  const suspension=new FourCornerSuspension(1700,2.837,1.574);
  let maxRoll=0;
  for(let tick=0;tick<180;tick++){
    const phase=Math.floor(tick/30)%2===0?-1:1;
    suspension.applyLoad([1.15,0,phase*.55],1_900);
    suspension.step(1/120);
    maxRoll=Math.max(maxRoll,Math.abs(suspension.pose.roll));
  }
  assert.ok(maxRoll>.002,{maxRoll});
  assert.ok(suspension.drainEvents().length>0);
});

test('door hinge distinguishes gentle latch from a hard slam',()=>{
  const gentle=new DoorHinge(),hard=new DoorHinge();
  for(let i=0;i<100;i++){gentle.drive(1.0,18);gentle.step(1/120);}
  for(let i=0;i<160;i++){gentle.drive(0,5);gentle.step(1/120);}
  const gentleEvents=gentle.drainEvents().filter(event=>event.mechanism==='door-latch');
  for(let i=0;i<100;i++){hard.drive(1.0,28);hard.step(1/120);}
  hard.addAngularImpulse(-18);
  for(let i=0;i<160;i++)hard.step(1/120);
  const hardEvents=hard.drainEvents().filter(event=>event.mechanism==='door-latch');
  assert.ok(hardEvents.length>0);
  assert.ok(hardEvents.at(-1).energy>(gentleEvents.at(-1)?.energy??0),{gentle:gentleEvents,hard:hardEvents});
});

test('M3 interaction rig combines thermal contraction, reversible flex, plastic dent and suspension motion',()=>{
  const rig=new M3InteractionRig();
  rig.setTemperatureC(-15);
  assert.ok(rig.state.thermalScale<1);
  const before=rig.state.panelPermanentDepthM;
  rig.impact({time:0,point:[1.2,.95,-.72],normal:[0,1,0],energyJ:2.5,radiusM:.18,thicknessM:.0008,effectiveMassKg:2});
  for(let i=0;i<240;i++)rig.step(1/240);
  assert.equal(rig.state.panelPermanentDepthM,before);
  rig.impact({time:1.1,point:[-.2,1.42,0],normal:[0,1,0],energyJ:180,radiusM:.24,thicknessM:.00075,effectiveMassKg:38});
  for(let i=0;i<100;i++){rig.applyBodyLoad([-.2,0,-.45],i%24<12?1_600:300);rig.step(1/120);}
  assert.ok(rig.state.panelPermanentDepthM>0,rig.state);
  assert.ok(Math.abs(rig.state.suspension.roll)>1e-5||Math.abs(rig.state.suspension.heave)>1e-5,rig.state.suspension);
  assert.ok(rig.shellPositions().every(Number.isFinite));
});

test('human-scale loads dent panels and move suspension without plastically crushing the crash cage',()=>{
  const rig=new M3InteractionRig(1700);
  const baseline=rig.state.structuralPlasticWorkJ;
  for(let tick=0;tick<720;tick++){
    const phase=(tick%86)/86,landing=Math.exp(-(((phase-.12)/.11)**2));
    rig.applyBodyLoad([tick%172<86?1.15:-.05,0,tick%172<86?-.32:.12],760+3_200*landing);
    if(tick%86===10)rig.impact({time:tick/120,point:[.4,1.2,-.7],normal:[0,1,0],energyJ:175,radiusM:.24,thicknessM:.00075,effectiveMassKg:52});
    rig.step(1/120);
  }
  assert.equal(rig.state.structuralPlasticWorkJ,baseline);
  assert.ok(rig.state.panelPermanentDepthM>0,rig.state);
  assert.ok(rig.shellPositions().every(Number.isFinite));
});

test('mechanism audio is deterministic and non-silent',()=>{
  const events=[
    {type:'mechanism',id:1,time:.1,point:[0,0,0],mechanism:'door-latch',energy:9,speed:1.8,size:1.1},
    {type:'mechanism',id:2,time:.5,point:[0,0,0],mechanism:'suspension',energy:2,speed:.18,size:.55},
  ];
  const a=renderAudio(events,1,16000),b=renderAudio(events,1,16000);
  assert.deepEqual(a.left,b.left);
  assert.ok(a.left.some(sample=>Math.abs(sample)>.001));
});


test('M3 render assembly preserves original FBX parts while keeping semantic engine materials',()=>{
  const m3=generateM3Vehicle(),byId=new Map(m3.parts.map(part=>[part.id,part]));
  assert.equal(M3_VEHICLE_DEFINITION.reference.triangles,9798,'reference metadata must preserve the source FBX triangle count');
  assert.ok(m3.generatedTriangles>M3_VEHICLE_DEFINITION.reference.triangles,'engine-owned render details may add topology without mutating the source reference');
  const body=byId.get('body');
  assert.equal(body.mesh.indices.length/3,m3.bodyTriangles,'physical M3 shell must remain the compact source topology');
  assert.equal(body.renderMesh?.kind,'triangle-mesh');
  assert.ok(body.renderMesh.indices.length>body.mesh.indices.length*16,'hero render topology should refine independently of the physical shell');
  const originalFbxIds=[
    'body','windshield-front','windshield-rear','window-front-left','window-front-right',
    'mirror-left','mirror-right','plastic-trim','exhaust','rim-front-left','tire-front-left',
    'rim-rear-right','tire-rear-right','day-lights','rear-lights',
  ];
  assert.ok(originalFbxIds.every(id=>byId.get(id)?.mesh.kind==='triangle-mesh'),'original FBX wheels/lights/trim must never fall back to primitive stand-ins');
  for(const id of originalFbxIds)assert.ok(byId.has(id),`missing original FBX-derived M3 part: ${id}`);
  for(const id of ['windshield-front','windshield-rear','window-front-left','window-front-right']){
    assert.equal(byId.has('interior-'+id),false,`interior-${id} must not be an opaque coplanar duplicate of glazing`);
  }
  const grilleInlays=m3.parts.filter(part=>part.id.startsWith('grille-inlay-'));
  assert.equal(grilleInlays.length,12,'two FBX kidney openings should receive six recessed vertical inlays each');
  assert.ok(grilleInlays.every(part=>part.mesh.kind==='box'&&part.position[0]<2.40),'grille inlays must stay within the source fascia envelope');

  assert.equal(byId.get('body').material.kind,'steel');
  const heroPaint=m3PartMaterial(byId.get('body'),[.2,.2,.2,1],false);
  assert.ok(heroPaint.clearcoat>.7&&heroPaint.clearcoatRoughness<.12,'hero paint should retain a strong generic dielectric clearcoat layer');
  assert.equal(byId.get('windshield-front').material.kind,'glass');
  assert.equal(byId.get('mirror-left').material.kind,'mirror');
  assert.equal(byId.get('plastic-trim').material.kind,'plastic');
  assert.equal([...byId.keys()].some(id=>id.startsWith('kidney-')||id.startsWith('lower-intake')),false,'packed FBX plastic-trim must be the single source of front fascia geometry');
  assert.equal(byId.get('rim-front-left').material.kind,'aluminum');
  assert.equal(byId.get('tire-front-left').material.kind,'rubber');

  const window=byId.get('window-front-right'),tire=byId.get('tire-front-right');
  const parkedWindow=m3PartBody(window,false),movingWindow=m3PartBody(window,true);
  assert.equal(parkedWindow.mass,0,'parked glazing must stay mounted/static');
  assert.equal(movingWindow.motion,'kinematic','moving glazing must publish contact velocity for fracture');
  assert.ok(parkedWindow.collisionSize[2]<=.005,'side glazing collision thickness must be physical rather than its curved mesh AABB');
  assert.equal(m3PartBody(tire,true),undefined,'tyres share vehicle/wheel physics rather than adding duplicate rigid mass');
  assert.equal(m3PartMaterial(window,[.1,.2,.3,1],false).kind,'glass');
  assert.ok(m3PartMaterial(window,[.1,.2,.3,1],false).color[3]<.98,'automotive glazing should enter the transparent render path');

  assert.ok(M3_REFERENCE_PROVENANCE.highFidelity.totalPackedPayloadBytes<M3_REFERENCE_PROVENANCE.sourceBytes);
  assert.ok(M3_REFERENCE_PROVENANCE.highFidelity.totalPackedPayloadBytes<130_000);
});

test('split M3 glazing has local geometry around its own origin for contact and fracture',()=>{
  const m3=generateM3Vehicle(),windows=m3.parts.filter(part=>part.role==='glass');
  assert.equal(windows.length,8);
  for(const part of windows){
    const mesh=part.mesh;
    assert.equal(mesh.kind,'triangle-mesh');
    const xs=[],ys=[],zs=[];for(let i=0;i<mesh.positions.length;i+=3){xs.push(mesh.positions[i]);ys.push(mesh.positions[i+1]);zs.push(mesh.positions[i+2]);}
    const center=[(Math.min(...xs)+Math.max(...xs))/2,(Math.min(...ys)+Math.max(...ys))/2,(Math.min(...zs)+Math.max(...zs))/2];
    assert.ok(Math.hypot(...center)<1e-5,`${part.id} mesh should be local to part origin, got ${center}`);
    assert.ok(Math.hypot(...part.position)>.5,`${part.id} should retain its vehicle-local mounting origin`);
  }
});


test('an imported M3 side window fractures through the normal Scene contact pipeline',()=>{
  const m3=generateM3Vehicle(),window=m3.parts.find(part=>part.id==='window-front-left');
  assert.ok(window);
  const id='m3-window-front-left',position=[...window.position],scene=new Scene({
    version:1,gravity:[0,0,0],ground:-100,
    entities:[
      {id,position,mesh:window.mesh,material:m3PartMaterial(window),body:m3PartBody(window,false)},
      {id:'impactor',position:[position[0],position[1],position[2]-.42],mesh:{kind:'sphere',radius:.06},material:{kind:'steel'},body:{mass:2,velocity:[0,0,8]}},
    ],
  });
  const events=[];for(let i=0;i<18;i++){scene.step(1/60);events.push(...scene.drainEvents());}
  assert.equal(scene.entities.has(id),false,'window should be removed after brittle failure');
  const fracture=events.find(event=>event.type==='fracture'&&event.entity===id);
  assert.ok(fracture,'FBX-derived glazing must reach the shared material fracture system');
  assert.ok(fracture.thickness<=.0055,fracture);
  assert.ok([...scene.entities.keys()].some(key=>key.startsWith(id+':shard:')),'fracture should create engine-owned debris');
});
