import test from 'node:test';
import assert from 'node:assert/strict';
import {VehicleCompiler,compileVehicle,vehiclePart,PICKUP_CANOPY_VEHICLE_DEFINITION} from '@rom4/game-engine/vehicles';
import {RoadWheelCompiler} from '@rom4/game-engine/vehicles/wheels';
import {freezeVehicleMesh} from '../dist/vehicles/geometry.js';
import {M3_VEHICLE_DEFINITION} from '../dist/vehicles/m3.js';
import {detailedRoadWheelMeshes} from '../dist/vehicles/passenger-wheel.js';
import {legacyVehicle,geometryHash,importFootprint} from '../tools/vehicle-domain-harness.mjs';

const definitions=[M3_VEHICLE_DEFINITION,PICKUP_CANOPY_VEHICLE_DEFINITION];
for(const base of definitions) {
  test(`${base.family}: byte-identical geometry through the new domain API`,()=>{
    const expected=legacyVehicle(base),compiler=new VehicleCompiler(),actual=compiler.compile(base);
    assert.deepEqual(actual,expected);
    assert.equal(geometryHash(actual),geometryHash(expected));
    assert.equal(compiler.diagnostics.wheelBuilds,2);
    for(const side of ['left','right']) for(const part of ['rim','tire']) {
      assert.equal(vehiclePart(actual,`wheels.front.${side}.${part}`).mesh,vehiclePart(actual,`wheels.rear.${side}.${part}`).mesh);
    }
    assert.equal(new Set(actual.parts.map(p=>p.mesh)).size,6);
  });
  test(`${base.family}: rim edit preserves body/glass/openings and equals a fresh compile`,()=>{
    const compiler=new VehicleCompiler(),before=compiler.compile(base),hash=geometryHash(before);
    const next={...base,wheel:{...base.wheel,spokes:base.wheel.spokes+2}};
    const after=compiler.compile(next);
    assert.equal(before.body,after.body);
    assert.equal(vehiclePart(before,'glass').mesh,vehiclePart(after,'glass').mesh);
    assert.notEqual(vehiclePart(before,'wheels.front.left.rim').mesh,vehiclePart(after,'wheels.front.left.rim').mesh);
    assert.equal(geometryHash(after),geometryHash(legacyVehicle(next)));
    assert.equal(geometryHash(before),hash,'An edit must not mutate an earlier result');
    assert.equal(compiler.diagnostics.bodyBuilds,1);
    assert.equal(compiler.diagnostics.glassBuilds,1);
    assert.equal(compiler.diagnostics.wheelBuilds,4);
  });
  test(`${base.family}: radius changes invalidate body and move wheel mounts`,()=>{
    const compiler=new VehicleCompiler(),before=compiler.compile(base),next=structuredClone(base);
    const dims=next.family==='three-box'?next.body.dimensions:next.dimensions;
    dims.wheelRadius+=.01;
    const after=compiler.compile(next);
    assert.notEqual(before.body,after.body);
    assert.equal(vehiclePart(after,'wheels.front.left.tire').position[1],dims.wheelRadius);
    assert.equal(geometryHash(after),geometryHash(legacyVehicle(next)));
    assert.equal(compiler.diagnostics.bodyBuilds,2);
    assert.equal(compiler.diagnostics.wheelBuilds,4);
  });
  test(`${base.family}: body edits keep wheel geometry`,()=>{
    const compiler=new VehicleCompiler(),before=compiler.compile(base),next=structuredClone(base);
    if(next.family==='three-box') next.body.hoodCrown+=.003;
    else next.body.canopy=false;
    const after=compiler.compile(next);
    assert.notEqual(before.body,after.body);
    assert.equal(vehiclePart(before,'wheels.front.left.rim').mesh,vehiclePart(after,'wheels.front.left.rim').mesh);
    assert.equal(compiler.diagnostics.wheelBuilds,2);
    assert.equal(geometryHash(after),geometryHash(legacyVehicle(next)));
  });
  test(`${base.family}: value keys survive mutable definitions; metadata is not geometry`,()=>{
    const compiler=new VehicleCompiler(),mutable=structuredClone(base),before=compiler.compile(mutable),oldHash=geometryHash(before);
    const same=compiler.compile({...structuredClone(base),id:'another-copy',reference:{sourceBytes:1}});
    assert.equal(before.body,same.body);
    assert.equal(compiler.diagnostics.bodyBuilds,1);
    assert.equal(compiler.diagnostics.wheelBuilds,2);
    mutable.wheel.spokes++;
    assert.equal(geometryHash(compiler.compile(mutable)),geometryHash(legacyVehicle(mutable)));
    assert.equal(geometryHash(before),oldHash);
    assert.deepEqual(before.definition,base,'Compiled definition must be a snapshot, not a mutable alias');
    assert.equal(compiler.diagnostics.wheelBuilds,4);
  });
}

test('wheel compiler uses complete value keys and preserves left/right orientation',()=>{
  const compiler=new RoadWheelCompiler(),spec={radius:.346,width:.30,rimRatio:.8,spokes:10,split:.016,dish:.032};
  const left=compiler.compile(spec,-1),again=compiler.compile({...spec},-1),right=compiler.compile(spec,1);
  assert.equal(left,again);
  assert.deepEqual(left,detailedRoadWheelMeshes(spec,-1));
  assert.deepEqual(right,detailedRoadWheelMeshes(spec,1));
  assert.notDeepEqual(left.rim,right.rim);
  assert.equal(compiler.diagnostics.wheelBuilds,2);
  for(let spokes=3;spokes<24;spokes++) compiler.compile({...spec,spokes},-1);
  assert.equal(compiler.diagnostics.residentWheelSides,2);
  assert.throws(()=>{left.rim.positions[0]=999;},TypeError);
  compiler.clear();
  assert.deepEqual(compiler.diagnostics,{wheelBuilds:0,wheelCacheHits:0,residentWheelSides:0});
});

test('invalid edits fail before rebuilding; cached output stays usable',()=>{
  const compiler=new VehicleCompiler(),base=PICKUP_CANOPY_VEHICLE_DEFINITION;
  const current=compiler.compile(base),diagnostics=compiler.diagnostics;
  for(const wheel of [{spokes:0},{spokes:2.5},{spokes:257},{rimRatio:1},{dish:-1},{split:NaN},{width:Infinity}]) {
    assert.throws(()=>compiler.compile({...base,wheel:{...base.wheel,...wheel}}),RangeError);
    assert.deepEqual(compiler.diagnostics,diagnostics);
  }
  assert.throws(()=>compiler.compile({...base,family:'unknown'}),TypeError);
  assert.throws(()=>compiler.compile({...base,body:{...base.body,hoodHeight:NaN}}),RangeError);
  assert.equal(compiler.compile(base).body,current.body);
  assert.throws(()=>vehiclePart(current,'wheels.front.left.door'),TypeError);
  assert.throws(()=>{current.body.positions[0]=999;},TypeError);
  assert.throws(()=>{current.parts[0].position[0]=999;},TypeError);
  compiler.clear();
  assert.equal(compiler.diagnostics.bodyBuilds,0);
  assert.equal(compiler.diagnostics.residentWheelSides,0);
  assert.equal(geometryHash(compiler.compile(base)),geometryHash(current));
});

test('domain entry points do not pull renderer, physics, audio or packed model assets',async()=>{
  const vehicles=await importFootprint('dist/vehicles/index.js');
  for(const file of vehicles.files) assert.doesNotMatch(file.replaceAll('\\','/'),/\/(render|physics|audio|runtime)\/|m3-fbx|m3-shell/);
  const wheels=await importFootprint('dist/vehicles/wheels.js');
  for(const file of wheels.files) assert.doesNotMatch(file.replaceAll('\\','/'),/pickup|m3-|framework|assembly/);
  assert.ok(vehicles.modules>wheels.modules);
});

test('legacy stateless API stays deterministic and retains no cross-call cache',()=>{
  const a=compileVehicle(PICKUP_CANOPY_VEHICLE_DEFINITION),b=compileVehicle(PICKUP_CANOPY_VEHICLE_DEFINITION);
  assert.notEqual(a.body,b.body);
  assert.equal(geometryHash(a),geometryHash(b));
});

// Protect every geometry channel, including optional vertex colours; a shallow
// mesh freeze alone would allow edits to leak between shared axle instances.
test('compiler-owned geometry freezes every numeric channel without serializing it',()=>{
  const mesh={kind:'triangle-mesh',positions:[0,0,0],normals:[0,1,0],indices:[0],colors:[1,1,1,1],
    toJSON(){throw new Error('Authoring ownership must not serialize renderer keys');}};
  freezeVehicleMesh(mesh);
  assert.ok(Object.isFrozen(mesh));
  for(const key of ['positions','normals','indices','colors']) {
    assert.ok(Object.isFrozen(mesh[key]));
    assert.throws(()=>{mesh[key][0]=2;},TypeError);
    assert.throws(()=>{mesh[key]=[];},TypeError);
  }
});
