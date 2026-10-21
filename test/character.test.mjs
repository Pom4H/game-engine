import test from 'node:test';
import assert from 'node:assert/strict';
import {CHARACTER_PRESETS,DEFAULT_CHARACTER_SPEC,characterSpec,compileCharacter} from '../dist/characters/character.js';
import {sampleCharacterPose} from '../dist/characters/pose.js';
import {bindHumanoid,humanoidMeasurements,sampleWalker} from '../dist/animation/locomotion.js';
import {compose,V3} from '../dist/math.js';
import {primitiveMesh} from '../dist/procedural/mesh.js';
import {Scene} from '../dist/scene/scene.js';

const near=(actual,expected,tolerance=1e-7)=>assert.ok(Math.abs(actual-expected)<=tolerance,`${actual} != ${expected}`);
function meshBounds(entity){
 const mesh=entity.renderMesh??entity.mesh,m=compose(entity.position??[0,0,0],entity.rotation??[0,0,0],entity.scale??[1,1,1]),lo=[Infinity,Infinity,Infinity],hi=[-Infinity,-Infinity,-Infinity];
 const positions=mesh.kind==='triangle-mesh'?mesh.positions:Array.from(primitiveMesh(mesh).vertices).filter((_,i)=>i%6<3);
 for(let i=0;i<positions.length;i+=3)for(let axis=0;axis<3;axis++){
  const value=m[axis]*positions[i]+m[axis+4]*positions[i+1]+m[axis+8]*positions[i+2]+m[axis+12];lo[axis]=Math.min(lo[axis],value);hi[axis]=Math.max(hi[axis],value);
 }
 return{lo,hi};
}
const characterBounds=compiled=>compiled.entities.reduce((bounds,entity)=>{const next=meshBounds(entity);for(let i=0;i<3;i++){bounds.lo[i]=Math.min(bounds.lo[i],next.lo[i]);bounds.hi[i]=Math.max(bounds.hi[i],next.hi[i]);}return bounds;},{lo:[Infinity,Infinity,Infinity],hi:[-Infinity,-Infinity,-Infinity]});

test('character recipe validates typed finite data before geometry allocation and imports without coercion',()=>{
 assert.deepEqual(characterSpec(JSON.parse(JSON.stringify(DEFAULT_CHARACTER_SPEC))),DEFAULT_CHARACTER_SPEC);
 assert.equal(characterSpec({colors:{top:'#ABCDEF'}}).colors.top,'#abcdef');
 for(const input of [null,[],true,'skeptic',{version:2},{version:null},{id:null},{id:'<script>'},{id:'x'.repeat(65)},{seed:NaN},{seed:Infinity},{seed:-1},{seed:2.5},{seed:4294967296},{body:[]},{body:{height:'1.8'}},{body:{height:0}},{body:{height:Infinity}},{body:{shoulders:.69}},{body:{legs:1.31}},{body:{build:-.01}},{body:{height:2.051}},{outfit:{top:'coat'}},{outfit:{scarf:'false'}},{colors:{top:'#fff'}},{colors:{skin:'red'}},{expression:'happy'},{hairStyle:'mohawk'},{other:true},JSON.parse('{"__proto__":{"polluted":true}}'),Object.create({id:'inherited'})])assert.throws(()=>characterSpec(input),JSON.stringify(input));
 assert.equal({}.polluted,undefined);
 const source=structuredClone(DEFAULT_CHARACTER_SPEC),normalized=characterSpec(source);source.body.height=2;normalized.colors.top='#ffffff';
 assert.equal(normalized.body.height,DEFAULT_CHARACTER_SPEC.body.height);assert.equal(DEFAULT_CHARACTER_SPEC.colors.top,'#856044');
});

test('recipe roundtrip generates exactly the same independent geometry and stable part bindings',()=>{
 const first=compileCharacter(),again=compileCharacter(JSON.parse(JSON.stringify(first.spec)));
 assert.deepEqual(again,first);
 assert.notEqual(first.entities[0].mesh.positions,again.entities[0].mesh.positions);
 const variant=compileCharacter({...first.spec,seed:first.spec.seed+1});
 assert.deepEqual(variant.entities.map(entity=>entity.id),first.entities.map(entity=>entity.id));
 assert.deepEqual(variant.walker.bindings,first.walker.bindings);
 assert.notDeepEqual(variant.entities.find(entity=>entity.id==='skeptic:top').mesh.positions,first.entities.find(entity=>entity.id==='skeptic:top').mesh.positions);
 assert.equal(new Set(first.entities.map(entity=>entity.id)).size,first.entities.length);
 assert.equal(new Set(first.walker.bindings.map(binding=>binding.entity)).size,first.entities.length);
});

test('height is the measured sole-to-crown extent for each hairstyle and extreme body proportions',()=>{
 for(const hairStyle of ['swept','short','none'])for(const shape of [
  {height:1.5,shoulders:.7,hips:.7,torso:.7,arms:.7,legs:.7,build:0},
  {height:2.05,shoulders:1.3,hips:1.3,torso:1.3,arms:1.3,legs:1.3,build:1},
  {height:1.81,shoulders:.88,hips:1.14,torso:.71,arms:1.27,legs:1.23,build:.36},
 ]){
  const compiled=compileCharacter({body:shape,hairStyle}),bounds=characterBounds(compiled);
  near(bounds.lo[1],0);near(bounds.hi[1],shape.height,2e-6);near(compiled.metrics.height,shape.height);
  for(const side of ['left','right'])near(meshBounds(compiled.entities.find(entity=>entity.id===compiled.spec.id+':'+side+'-sole')).lo[1],0);
 }
});

test('authored garment meshes remain closed with outward winding, finite normals and bounded index budgets',()=>{
 for(const preset of CHARACTER_PRESETS){
  const compiled=compileCharacter(preset.spec);
  assert.ok(compiled.metrics.triangles<100000,`${preset.id} triangle budget`);
  assert.ok(compiled.metrics.entityCount<100,`${preset.id} entity budget`);
  for(const entity of compiled.entities){
   assert.ok(entity.renderOnly);assert.equal(entity.body,undefined);
   if(!entity.id.startsWith(preset.spec.id+':'))continue;
   const {positions,normals,indices}=entity.mesh;assert.equal(entity.mesh.kind,'triangle-mesh');
   assert.equal(positions.length,normals.length);assert.ok(positions.every(Number.isFinite));assert.ok(normals.every(Number.isFinite));assert.ok(indices.every(i=>Number.isInteger(i)&&i>=0&&i<positions.length/3));
   let volume=0;
   for(let i=0;i<indices.length;i+=3){const [a,b,c]=indices.slice(i,i+3).map(k=>positions.slice(k*3,k*3+3));volume+=V3.dot(a,V3.cross(b,c))/6;}
   assert.ok(volume>0,`${entity.id}: closed positive volume ${volume}`);
   for(let i=0;i<normals.length;i+=3){const length=Math.hypot(...normals.slice(i,i+3));near(length,1,1e-6);}
  }
  const actual=compiled.entities.reduce((n,e)=>n+primitiveMesh(e.renderMesh??e.mesh).indices.length/3,0);assert.equal(compiled.metrics.triangles,actual);
 }
});

test('meshes, neutral pose and walking IK share the same physical dimensions',()=>{
 for(const preset of CHARACTER_PRESETS){
  const compiled=compileCharacter(preset.spec),walker=compiled.walker,dimensions=humanoidMeasurements(walker.proportions,walker.heightScale),initial=bindHumanoid(sampleWalker(walker,0),walker.bindings);
  for(const transform of initial){const entity=compiled.entities.find(e=>e.id===transform.entity);assert.deepEqual(entity.position,transform.position);assert.deepEqual(entity.scale,transform.scale);assert.deepEqual(entity.rotation,transform.rotation);}
  for(const heading of [0,.78,-1.3])for(const t of [0,.17,.51,1.29,2.41]){
   const pose=sampleWalker({...walker,heading,speed:.86},t),j=pose.joints,transforms=bindHumanoid(pose,walker.bindings);
   for(const side of ['left','right']){
    near(V3.length(V3.sub(j[side+'Hip'],j[side+'Knee'])),dimensions.thigh);near(V3.length(V3.sub(j[side+'Knee'],j[side+'Ankle'])),dimensions.shin);
    near(V3.length(V3.sub(j[side+'Shoulder'],j[side+'Elbow'])),dimensions.upperArm);near(V3.length(V3.sub(j[side+'Elbow'],j[side+'Hand'])),dimensions.forearm);
    const foot=pose.feet.find(f=>f.id===walker.id+':'+side);
    if(foot.grounded){const sole=compiled.entities.find(e=>e.id===walker.id+':'+side+'-sole'),transform=transforms.find(tr=>tr.entity===sole.id);near(meshBounds({...sole,...transform}).lo[1],foot.position[1]);}
   }
  }
 }
});

test('outfit choices change real meshes and silhouette while preserving identity and bound body ownership',()=>{
 const versions=CHARACTER_PRESETS.map(p=>compileCharacter(p.spec));
 assert.notEqual(versions[0].metrics.triangles,versions[1].metrics.triangles);assert.notEqual(versions[1].metrics.triangles,versions[2].metrics.triangles);
 assert.ok(versions[0].entities.some(e=>e.id.endsWith(':hood')));assert.ok(versions[0].entities.some(e=>e.id.endsWith(':scarf-tail')));
 assert.ok(versions[1].entities.some(e=>e.id.endsWith(':left-cargo-pocket')));
 assert.ok(!versions[2].entities.some(e=>e.id.endsWith(':zipper-teeth')));assert.ok(!versions[2].entities.some(e=>e.id.endsWith(':left-boot-collar')));
 const skinny=compileCharacter({body:{build:0}}),broad=compileCharacter({body:{build:1}}),top=c=>c.entities.find(e=>e.id===c.spec.id+':top');
 const slim=meshBounds(top(skinny)),wide=meshBounds(top(broad));assert.ok(wide.hi[2]-wide.lo[2]>slim.hi[2]-slim.lo[2]);
 assert.equal(skinny.walker.heightScale,broad.walker.heightScale);assert.deepEqual(skinny.walker.proportions,broad.walker.proportions);
});

test('hands follow forearm orientation at the wrist and stay inside their cuffs in all preview poses',()=>{
 const projectedBounds=(entity,transform,origin,axis)=>{
  const matrix=compose(transform.position,transform.rotation,transform.scale),p=entity.mesh.positions;let lo=Infinity,hi=-Infinity;
  for(let i=0;i<p.length;i+=3){const world=[0,1,2].map(k=>matrix[k]*p[i]+matrix[k+4]*p[i+1]+matrix[k+8]*p[i+2]+matrix[k+12]),along=V3.dot(V3.sub(world,origin),axis);lo=Math.min(lo,along);hi=Math.max(hi,along);}
  return[lo,hi];
 };
 for(const preset of CHARACTER_PRESETS){
  const compiled=compileCharacter(preset.spec),h=compiled.walker.heightScale;
  for(const mode of ['idle','walk','reach','t-pose'])for(const heading of [0,.73,-1.4]){
   const pose=sampleCharacterPose({...compiled.walker,heading},mode,.37),transforms=new Map(bindHumanoid(pose,compiled.walker.bindings).map(t=>[t.entity,t]));
   for(const side of ['left','right']){
    const hand=compiled.entities.find(e=>e.id===compiled.spec.id+':'+side+'-hand'),cuff=compiled.entities.find(e=>e.id===compiled.spec.id+':'+side+'-sleeve-cuff'),transform=transforms.get(hand.id),wrist=pose.joints[side+'Hand'],elbow=pose.joints[side+'Elbow'],outward=V3.normalize(V3.sub(wrist,elbow)),matrix=compose(transform.position,transform.rotation,transform.scale),palmUp=V3.normalize([matrix[4],matrix[5],matrix[6]]);
    assert.deepEqual(transform.position,wrist);near(V3.dot(palmUp,outward),-1,1e-7);
    assert.deepEqual(transform.scale,[h,h,h]);
    const palmRange=projectedBounds(hand,transform,wrist,outward),cuffRange=projectedBounds(cuff,transforms.get(cuff.id),wrist,outward),overlap=Math.min(palmRange[1],cuffRange[1])-Math.max(palmRange[0],cuffRange[0]);
    assert.ok(overlap>.02*h,`${preset.id} ${mode} ${side}: cuff overlap ${overlap}`);
    assert.ok(palmRange[1]>.14*h,`${preset.id} ${mode} ${side}: fingers continue outward`);
   }
  }
 }
});

test('parka encloses upper trousers through the complete walk cycle and keeps a finished hem',()=>{
 const slices=mesh=>{
  const p=mesh.positions,triangles=[];
  for(let i=0;i<mesh.indices.length;i+=3){
   const a=mesh.indices[i]*3,b=mesh.indices[i+1]*3,c=mesh.indices[i+2]*3,by=p[b+1]-p[a+1],bz=p[b+2]-p[a+2],cy=p[c+1]-p[a+1],cz=p[c+2]-p[a+2],det=by*cz-bz*cy;
   if(Math.abs(det)<1e-12)continue;
   triangles.push({x:p[a],y:p[a+1],z:p[a+2],bx:p[b]-p[a],cx:p[c]-p[a],by,bz,cy,cz,det,ymin:Math.min(p[a+1],p[b+1],p[c+1]),ymax:Math.max(p[a+1],p[b+1],p[c+1]),zmin:Math.min(p[a+2],p[b+2],p[c+2]),zmax:Math.max(p[a+2],p[b+2],p[c+2])});
  }
  return(y,z)=>{let lo=Infinity,hi=-Infinity;
   for(const t of triangles){
    if(y<t.ymin-1e-7||y>t.ymax+1e-7||z<t.zmin-1e-7||z>t.zmax+1e-7)continue;
    const dy=y-t.y,dz=z-t.z,u=(dy*t.cz-dz*t.cy)/t.det,v=(t.by*dz-t.bz*dy)/t.det;
    if(u< -1e-7||v< -1e-7||u+v>1+1e-7)continue;
    const x=t.x+u*t.bx+v*t.cx;lo=Math.min(lo,x);hi=Math.max(hi,x);
   }return[lo,hi];
  };
 };
 for(const recipe of [{},{seed:931,body:{hips:1.3,legs:.7,build:1},outfit:{bottom:'cargo'}},{seed:91,body:{hips:.7,legs:1.3,build:0}}]){
  const compiled=compileCharacter(recipe),top=compiled.entities.find(e=>e.id.endsWith(':top')).mesh,bounds=slices(top),hem=Math.min(...top.positions.filter((_,i)=>i%3===1)),trousers=compiled.entities.filter(e=>/:(waist|(?:left|right)-(thigh|denim-seam|cargo-pocket|cargo-flap))$/.test(e.id));
  const moments=[['idle',0],['reach',0],['t-pose',0],['walk',.34],['walk',.65],['walk',1],...Array.from({length:25},(_,i)=>['walk',i*1.3/24])];
  for(const [mode,time] of moments){
   const pose=sampleCharacterPose(compiled.walker,mode,time),transforms=new Map(bindHumanoid(pose,compiled.walker.bindings).map(t=>[t.entity,t]));let covered=0;
   for(const entity of trousers){const tr=transforms.get(entity.id),m=compose(tr.position,tr.rotation,tr.scale),p=entity.mesh.positions;
    for(let i=0;i<p.length;i+=3){
     const point=[0,1,2].map(k=>(m[k]*p[i]+m[k+4]*p[i+1]+m[k+8]*p[i+2]+m[k+12]-pose.joints.pelvis[k])/compiled.walker.heightScale);
     if(point[1]<hem+.004||point[1]>.13)continue;
     const [lo,hi]=bounds(point[1],point[2]);covered++;
     assert.ok(point[0]>=lo+.0005&&point[0]<=hi-.0005,`${entity.id} ${mode} at ${time.toFixed(3)}: trousers ${point} must be inside coat [${lo},${hi}]`);
    }
   }
   assert.ok(covered>300,'the check must include real upper trouser surfaces');
  }
 }
});

test('exported scene recipe rehydrates into the existing animation system without a second update loop',()=>{
 const compiled=compileCharacter(CHARACTER_PRESETS[1].spec),walker={...compiled.walker,root:[3,.25,-2],speed:.75,heading:.55};
 const exported=JSON.parse(JSON.stringify({version:1,seed:compiled.spec.seed,ground:.25,gravity:[0,-9.81,0],entities:compiled.entities,animation:{walkers:[walker]}}));
 const scene=new Scene(exported);
 for(let i=0;i<12;i++)scene.step(1/60);
 const pose=scene.animation.pose(walker.id);assert.ok(pose);assert.ok(pose.position[0]>3);assert.equal(scene.entities.size,compiled.entities.length);
 for(const transform of bindHumanoid(pose,walker.bindings)){const entity=scene.entities.get(transform.entity);assert.deepEqual(entity.position,transform.position);assert.deepEqual(entity.rotation,transform.rotation);assert.deepEqual(entity.scale,transform.scale);assert.equal(entity.body,undefined);}
});
