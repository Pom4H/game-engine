import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {Scene} from '../dist/scene/scene.js';

const sceneSpec=()=>({
  version:1,seed:7,gravity:[0,-9.81,0],ground:-100,
  environment:{temperatureC:-2.4,humidity:.82,precipitation:'frequent',snowfall:'light',
    sunlight:.48,groundMoisture:.74,wind:[3,0,4],clock:{hoursPerSecond:.01}},
  entities:[
    {id:'road',position:[0,-.1,0],mesh:{kind:'box',size:[12,.2,9]},body:{},
      material:{kind:'asphalt',ageYears:12,finish:'weathered'},
      environmental:{surfaceUse:'road',snowDepthM:.08,waterDepthM:.003}},
    {id:'sidewalk',position:[0,-.1,11],mesh:{kind:'box',size:[8,.2,5]},body:{},
      material:{kind:'concrete',ageYears:20,finish:'rough'},
      environmental:{surfaceUse:'sidewalk',snowDepthM:.04,iceDepthM:.002}},
    {id:'curb',position:[9,-.1,1],mesh:{kind:'box',size:[1.5,.2,8]},body:{},
      material:{kind:'concrete',ageYears:5},
      environmental:{surfaceUse:'curb',snowDepthM:.11,waterDepthM:.001}},
  ],
});
function fingerprint(){
  const scene=new Scene(sceneSpec());
  const hash=createHash('sha256');
  const capture=tick=>{
    const data=[...scene.surfaces.surfaces].map(([id,summary])=>{
      const field=scene.surfaces.field(id);
      return [id,summary,field.cells,field.deformation.cells];
    });
    hash.update(JSON.stringify([tick,scene.environment,data]));
  };
  capture(0);
  for(let tick=1;tick<=120;tick++){
    if(tick===8||tick===36){
      assert.equal(scene.surfaces.applyContactWork({
        sourceId:'rolling-wheel',surfaceId:'road',x:1.6,z:1.1,radiusM:.72,
        durationSeconds:.1,speedMps:9,slipSpeedMps:2.5,normalLoadN:3700,frictionCoefficient:.85,
      }),true);
    }
    scene.step(1/60);
    if([1,2,8,16,36,60,120].includes(tick))capture(tick);
  }
  return hash.digest('hex');
}
test('surface phase evolution has a stable golden physical replay across 120 ticks',()=>{
  const a=fingerprint(),b=fingerprint();
  assert.equal(a,b,'surface evolution must be deterministic');
  // Captured before the hoist, covering spatial traffic, snow, water, ice,
  // prewarm initialization and 120 fixed ticks. No physical drift permitted.
  assert.equal(a,'947c2e68442e3042c23629e8269b4a77446f54a78d702cfdb8fe924178f99380');
  console.log('SURFACE_GOLDEN_SHA256='+a);
});


test('surface revisions mark authoritative weather and contact mutations for GPU uploads',()=>{
  const scene=new Scene(sceneSpec());
  const field=scene.surfaces.field('road');
  assert.ok(field);
  const before=field.revision;
  scene.step(1/60);
  assert.equal(field.revision,before,'no 30Hz surface tick at simulation tick 1');
  scene.step(1/60);
  assert.equal(field.revision,before+1,'one physical surface step invalidates texture exactly once');
  const observed=field.revision;
  assert.equal(scene.surfaces.applyContactWork({
    sourceId:'test-wheel',surfaceId:'road',x:0,z:0,radiusM:.7,
    durationSeconds:.03,speedMps:12,slipSpeedMps:2,normalLoadN:3600,frictionCoefficient:.7,
  }),true);
  assert.equal(field.revision,observed+1,'contact invalidates its field before rendering');
});
