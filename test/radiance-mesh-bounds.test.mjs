import test from 'node:test';
import assert from 'node:assert/strict';
import {Scene} from '../dist/scene/scene.js';
import {freezePrimitive} from '../dist/procedural/mesh.js';
import {buildSceneRadianceProbe} from '../dist/render/radiance.js';

const mesh=positions=>({kind:'triangle-mesh',positions,normals:positions.map((_,i)=>i%3===1?1:0),indices:Array.from({length:positions.length/3},(_,i)=>i)});
function fixture(positions){
 const scene=new Scene({version:1,entities:[{id:'mesh',position:[17,8,23],mesh:freezePrimitive(mesh([...positions]),true),material:{color:[.3,.5,.7,1],metalness:.4,roughness:.27,emissive:[.01,.03,.02]}}]});
 const entity=scene.entities.get('mesh'),frozen=entity.mesh,mutable=mesh([...positions]);
 return {scene,entity,frozen,mutable};
}
test('cached immutable mesh radiance matches the original vertex scan at full precision',()=>{
 const positions=[];for(let n=0;n<300;n++)positions.push(1e6+Math.sin(n*.13)*7,Math.cos(n*.71)*5,-1e6+Math.sin(n*.37)*9);
 const {scene,entity,frozen,mutable}=fixture(positions);
 for(let n=0;n<120;n++){
  entity.scale=[.012+n*.0013,1+(n%11)*.17,.015+(n%9)*.0019];
  const origin=[entity.position[0]+20+n*.1,entity.position[1]+3,entity.position[2]-15];
  entity.mesh=mutable;const scanned=buildSceneRadianceProbe(scene,origin,128,true);assert.ok(scanned.proxies.length>0);
  entity.mesh=frozen;assert.deepEqual(buildSceneRadianceProbe(scene,origin,128,true),scanned);
 }
});
test('mutable nested geometry and replacement positions never inherit stale bounds',()=>{
 const {scene,entity,mutable}=fixture([-1,-1,-1,1,-1,1,0,1,0]);
 entity.mesh=Object.freeze(mutable);const before=buildSceneRadianceProbe(scene);
 mutable.positions[0]=-8;const changed=buildSceneRadianceProbe(scene);assert.notDeepEqual(changed,before);
 entity.mesh=freezePrimitive(mesh([...mutable.positions]),true);assert.deepEqual(buildSceneRadianceProbe(scene),changed);
 const first=entity.mesh;
 entity.mesh={...first,positions:[...first.positions]};entity.mesh.positions[0]=-14;
 const replaced=buildSceneRadianceProbe(scene);assert.notDeepEqual(replaced,changed);
 entity.mesh=freezePrimitive(mesh([...entity.mesh.positions]),true);assert.deepEqual(buildSceneRadianceProbe(scene),replaced);
 entity.scale=[0,2,-3];const cached=buildSceneRadianceProbe(scene);entity.mesh=mesh([...entity.mesh.positions]);assert.deepEqual(buildSceneRadianceProbe(scene),cached);
});
