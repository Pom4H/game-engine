import {test,expect} from 'bun:test';
import {createOfficeActors} from '../../../../thegame/src/game/office-dynamic-assets.ts';
import {createOfficeUrban} from '../../../../thegame/src/game/office-urban-assets.ts';
import {createOfficeScenery} from '../../../../thegame/src/game/office-scenery-assets.ts';
import {createOfficeRoads} from '../../../../thegame/src/game/office-road-assets.ts';
import {createOfficeTerrainAssets} from '../../../../thegame/src/game/office-terrain-assets.ts';
import {Scene,type RuntimeEntity} from '../../../src/scene/scene.ts';
import {CanonicalWorldLayer} from '../client/canonical-world-view.ts';
import type {CanonicalBinding,CanonicalEntity,CanonicalFrame,CanonicalGeometry} from '../client/canonical-types.ts';
// These verification fixtures use the actual adjacent The Game generators and
// palettes. The production Engine client has no runtime dependency on that repo.
import {generateBuilding,buildingPoint} from '../../../../thegame/src/game/buildings/plan.ts';
import {Terrain,weatherAt,airAt} from '../../../../thegame/src/game/biomes.ts';
import {worldEnvironment} from '../../../../thegame/src/game/render/world-environment.ts';
import {humanoidStyle} from '../../../../thegame/src/game/humanoid-style.ts';
import {transportRig} from '../../../../thegame/src/game/transport/rig.ts';
import {renderModel} from '../../../src/render/frame.ts';
import {buildingRecipe} from '../../../../thegame/src/game/scenery-records.ts';

function fixture():CanonicalFrame{
 const seed=29,plan=generateBuilding({id:'source-parcel',x:104,y:1.4,z:232,w:34,l:26,h:19.8,yaw:.71},seed,undefined,'office'),binding:CanonicalBinding={worldId:'thegame:29:13',buildingId:plan.id,epoch:100,origin:[plan.x,plan.y,plan.z],yaw:plan.yaw,floorHeight:3.3,floorCount:plan.levels.length,officeFloor:2,width:plan.width,depth:plan.depth,core:plan.core!,layoutStatus:'unbound'},terrain=new Terrain(seed),startX=96,startZ=224;
 const geometry:CanonicalGeometry={building:plan,nearbyBuildings:[generateBuilding({id:'source-neighbor',x:160,z:232,w:16,l:18,h:9.9},seed)],roads:[{id:'source-curved',kind:'residential',width:8,samples:[[104,0,210],[110,.2,211],[116,.3,215]]}],urban:{boxes:[{id:'source-sidewalk',kind:'sidewalk',x:104,y:.12,z:210,w:16,h:.2,l:1.5,color:[.61,.61,.56],material:13,solid:true}],props:[],lots:[],junctions:[]},trees:[],chunks:[{id:'0:1',cx:0,cz:1,buildings:[],props:[]}],terrain:{step:8,startX,startZ,width:3,depth:3,heights:Array.from({length:9},(_,i)=>terrain.heightVertex(startX/8+i%3,startZ/8+Math.floor(i/3)))}};
 const visitor=person(binding,'player:canonical'),street=person(binding,'resident:street',0,30,20),rig=transportRig('sedan'),vehicle:CanonicalEntity={id:'vehicle:canonical',kind:'vehicle',type:'sedan',x:130,y:.6,z:210,yaw:.4,vx:4,vy:0,vz:1,phase:12,animation:'drive'},minute=720;
 return{source:'thegame',schema:'thegame-office/1',seed,revision:13,epoch:100,tick:600,time:10,worldMinute:minute,binding,entities:[visitor,street,vehicle],lifts:[{id:plan.id,floor:2,target:2,elevation:6.6,door:1,velocity:0,phase:'idle'}],humanoidStyles:{[visitor.id]:humanoidStyle(visitor.id),[street.id]:humanoidStyle(street.id)},vehicleSpecs:{sedan:{kind:rig.kind,width:rig.width,length:rig.length,height:rig.height,floor:rig.floor,roof:rig.roof,wheels:rig.wheels}},environment:worldEnvironment(seed,minute,plan.x,plan.z),weather:weatherAt(seed,minute,plan.x,plan.z),air:airAt(seed,minute,plan.x,plan.z,6.6),geometry};
}

test('source terrain replaces the grey fallback, follows floors and visibility, and rejects mismatched authority heights',()=>{
 const f=fixture(),s=scene(),factory=(host:Scene)=>createOfficeTerrainAssets(host,()=>({width:1,height:1,data:Uint8Array.from([80,100,90,255])}),(_,size)=>({texture:{url:'/test-source-map.png',sizeM:size,projection:'terrain-map'},dispose(){}})),layer=new CanonicalWorldLayer(s,{mode:'office'});s.add({id:'native:desk',mesh:{kind:'box'},renderOnly:true});layer.update(f);expect(entities(s,'canonical:terrain:').length).toBeGreaterThan(0);
 layer.setTerrainFactory(factory);expect(layer.inspectTerrain()?.available).toBe(false);f.geometry={...f.geometry!,terrainScene:{version:1,hub:{n:64,size:768,zonesRle:[4096,1]}},roadScene:{version:1,specs:[{id:'road',kind:'surface',width:8,points:[[88,0,210],[144,.3,215]]}],piers:[]}};layer.update(f);
 const before=layer.inspectTerrain()!,original=entities(s,'canonical:terrain-source:'),shapes=original.map(e=>e.mesh),ys=original.map(e=>e.position[1]);expect(before.available).toBe(true);expect(before.outerCells).toBeGreaterThan(0);expect(entities(s,'canonical:terrain:')).toHaveLength(0);expect(layer.diagnostics.terrainPatches).toBe(before.cells);
 layer.update({...f,time:f.time+.1});expect(layer.inspectTerrain()).toEqual(before);layer.setActiveFloor(3);expect(layer.inspectTerrain()?.geometryBuilds).toBe(before.geometryBuilds);expect(original.map(e=>e.mesh)).toEqual(shapes);original.forEach((e,i)=>expect(e.position[1]).toBeCloseTo(ys[i]!-3.3,9));
 layer.setCityVisible(false);expect(entities(s,'canonical:terrain-source:')).toHaveLength(0);expect(layer.diagnostics.terrainPatches).toBe(0);layer.setCityVisible(true);expect(entities(s,'canonical:terrain-source:').length).toBeGreaterThan(0);
 const bad=structuredClone(f.geometry);bad.terrain.heights[0]!+=1;layer.update({...f,geometry:bad});expect(layer.inspectTerrain()?.available).toBe(false);expect(layer.inspectTerrain()?.heightMismatches).toBe(1);expect(entities(s,'canonical:terrain-source:')).toHaveLength(0);expect(entities(s,'canonical:terrain:').length).toBeGreaterThan(0);
 layer.update({...f,geometry:undefined,seed:30,epoch:200,binding:{...f.binding,worldId:'thegame:30:13',epoch:200}});expect(entities(s,'canonical:terrain-source:')).toHaveLength(0);expect(layer.inspectTerrain()?.available).toBe(false);expect(s.physics.stats.steps).toBe(0);expect(s.physics.bodies.size).toBe(0);layer.dispose();layer.dispose();expect([...s.entities.keys()]).toEqual(['native:desk']);
});

test('source roads replace fallback strips after loading and follow floor, visibility, legacy geometry and disposal',()=>{
 const f=fixture(),s=scene(),layer=new CanonicalWorldLayer(s,{mode:'office'});s.add({id:'native:desk',mesh:{kind:'box'},renderOnly:true});layer.update(f);expect(entities(s,'canonical:road:').length).toBeGreaterThan(0);
 layer.setRoadFactory(createOfficeRoads);expect(layer.inspectRoads()?.available).toBe(false);expect(entities(s,'canonical:road:').length).toBeGreaterThan(0);
 f.geometry={...f.geometry!,roadScene:{version:1,specs:[{id:'original',kind:'surface',width:8,points:[[88,0,210],[144,.3,215]]}],piers:[]}};layer.update(f);
 const first=layer.inspectRoads()!,original=entities(s,'canonical:road-source:'),shapes=original.map(e=>e.mesh),ys=original.map(e=>e.position[1]);expect(first.available).toBe(true);expect(first.meshes).toBe(original.length);expect(first.roads).toBe(1);expect(first.meshes).toBeGreaterThan(0);expect(entities(s,'canonical:road:')).toHaveLength(0);
 layer.update({...f,time:f.time+.2});expect(layer.inspectRoads()).toEqual(first);layer.setActiveFloor(3);expect(layer.inspectRoads()?.geometryBuilds).toBe(first.geometryBuilds);expect(original.map(e=>e.mesh)).toEqual(shapes);original.forEach((e,i)=>expect(e.position[1]).toBeCloseTo(ys[i]!-3.3,10));
 layer.setCityVisible(false);expect(entities(s,'canonical:road-source:')).toHaveLength(0);expect(layer.inspectRoads()?.cachedCells).toBe(0);layer.setCityVisible(true);expect(entities(s,'canonical:road-source:').length).toBeGreaterThan(0);
 const legacy={...f.geometry};delete legacy.roadScene;layer.update({...f,geometry:legacy});expect(entities(s,'canonical:road-source:')).toHaveLength(0);expect(entities(s,'canonical:road:').length).toBeGreaterThan(0);expect(layer.inspectRoads()?.available).toBe(false);
 expect(s.physics.stats.steps).toBe(0);expect(s.physics.bodies.size).toBe(0);layer.dispose();layer.dispose();expect([...s.entities.keys()]).toEqual(['native:desk']);
});

test('original streets replace approximate urban geometry and follow floor, visibility and disposal in the host Scene',()=>{
 const f=fixture(),s=scene(),layer=new CanonicalWorldLayer(s,{mode:'office',actorFactory:createOfficeActors,urbanFactory:createOfficeUrban});s.add({id:'native:desk',mesh:{kind:'box'},renderOnly:true});layer.update(f);
 const first=layer.inspectUrban(),original=entities(s,'canonical:urban-source:');expect(first.records).toBe(1);expect(first.meshes).toBe(original.length);expect(original.length).toBeGreaterThan(0);expect(entities(s,'canonical:urban:')).toHaveLength(0);const y=original[0]!.position[1];
 layer.update({...f,time:10.1,geometry:undefined});expect(layer.inspectUrban().geometryBuilds).toBe(first.geometryBuilds);expect(layer.hasActor(f.entities[0]!.id)).toBe(true);layer.setActiveFloor(3);expect(entities(s,'canonical:urban-source:')[0]!.position[1]).toBeCloseTo(y-f.binding.floorHeight,6);
 layer.setCityVisible(false);expect(layer.inspectUrban().meshes).toBe(0);expect(entities(s,'canonical:urban-source:')).toHaveLength(0);layer.setCityVisible(true);expect(layer.inspectUrban().meshes).toBe(first.meshes);expect(s.physics.stats.steps).toBe(0);expect(s.physics.bodies.size).toBe(0);layer.dispose();expect([...s.entities.keys()]).toEqual(['native:desk']);
});
function person(b:CanonicalBinding,id:string,floor=b.officeFloor,x=1,z=-2):CanonicalEntity{const c=Math.cos(b.yaw),s=Math.sin(b.yaw);return{id,kind:id.startsWith('player:')?'player':'pedestrian',x:b.origin[0]+c*x+s*z,y:b.origin[1]+floor*b.floorHeight,z:b.origin[2]-s*x+c*z,yaw:.9,vx:1,vy:0,vz:.4,phase:1.2,animation:'walk',extra:{alive:true,name:'Настоящий посетитель'}};}

test('presented remote NPC selects original upper rooms and lift visuals through the actual Office world layer',()=>{
 const f=fixture(),p=generateBuilding({id:'resident-home',x:160,y:1.4,z:232,w:28,l:24,h:26.4,yaw:.31},29,undefined,'apartments'),feet=buildingPoint(p,{x:0,z:0},9.94),resident:CanonicalEntity={...f.entities[0]!,id:'resident:at-home',kind:'pedestrian',...feet};
 f.entities=[resident];f.geometry!.nearbyBuildings=[];f.geometry!.sceneryScene={version:1,key:'upper-room-source',seed:29,revision:f.revision,buildings:[buildingRecipe({id:p.id,x:p.x,y:p.y,z:p.z,w:p.width,l:p.depth,h:p.height,yaw:p.yaw},p.kind)],urban:{boxes:[],props:[],lots:[]},trees:[]};f.lifts=[{id:p.id,floor:3,target:4,elevation:9.9,door:.4,velocity:2.2,phase:'moving'}];
 const s=scene(),layer=new CanonicalWorldLayer(s,{mode:'office',sceneryFactory:createOfficeScenery});layer.setSubject(resident.id);layer.update(f);
 const local=layer.toLocal([feet.x,feet.y,feet.z]);s.setCamera({position:[local[0],local[1]+1.65,local[2]],target:[local[0],local[1]+1,local[2]+3]});layer.updateInteriors();
 const first=layer.inspectScenery()!.interiors!,parts=entities(s,'canonical:interior-source:');expect(first.selection).toEqual([{id:p.id,levels:[3],litLevel:3}]);expect(first.lifts).toBe(1);expect(parts.length).toBeGreaterThan(30);expect(entities(s,'canonical:lift-source:').length).toBeGreaterThan(10);
 for(const world of [[feet.x,feet.y,feet.z],[-23,7,91]] as [number,number,number][]){const round=layer.toWorld(layer.toLocal(world));round.forEach((v,i)=>expect(v).toBeCloseTo(world[i]!,9));}
 layer.update({...f,time:f.time+.1,geometry:undefined});expect(layer.inspectScenery()!.interiors!.geometryBuilds).toBe(first.geometryBuilds);
 const before=parts.map(e=>({e,y:e.position[1],mesh:e.mesh}));layer.setActiveFloor(3);for(const part of before){expect(s.entities.get(part.e.id)).toBe(part.e);expect(part.e.mesh).toBe(part.mesh);expect(part.e.position[1]-part.y).toBeCloseTo(-3.3,4);}
 layer.setCityVisible(false);expect(entities(s,'canonical:interior-source:').length).toBe(0);expect(entities(s,'canonical:lift-source:').length).toBe(0);layer.setCityVisible(true);expect(layer.inspectScenery()!.interiors!.selection).toEqual(first.selection);
 expect(s.physics.stats.steps).toBe(0);expect(s.physics.bodies.size).toBe(0);layer.dispose();expect(s.entities.size).toBe(0);
});
test('source scenery replaces approximate neighbors while preserving the native Office cutaway, actors and floor alignment',()=>{
 const f=fixture(),s=scene(),layer=new CanonicalWorldLayer(s,{mode:'office',actorFactory:createOfficeActors,urbanFactory:createOfficeUrban,sceneryFactory:createOfficeScenery});s.add({id:'native:desk',mesh:{kind:'box'},renderOnly:true});layer.update(f);
 const first=layer.inspectScenery()!,parts=entities(s,'canonical:scenery-source:');expect(first.buildings).toBe(1);expect(parts.length).toBeGreaterThan(3);expect(entities(s,'canonical:city:')).toHaveLength(0);expect(entities(s,'canonical:facade:').length).toBeGreaterThan(0);expect(layer.hasActor(f.entities[0]!.id)).toBe(true);const y=parts[0]!.position[1];
 layer.update({...f,time:10.1,geometry:undefined});expect(layer.inspectScenery()!.geometryBuilds).toBe(first.geometryBuilds);layer.setActiveFloor(3);expect(entities(s,'canonical:scenery-source:')[0]!.position[1]).toBeCloseTo(y-f.binding.floorHeight,6);layer.setCityVisible(false);expect(layer.inspectScenery()!.meshes).toBe(0);expect(entities(s,'canonical:scenery-source:')).toHaveLength(0);layer.setCityVisible(true);expect(layer.inspectScenery()!.meshes).toBe(first.meshes);expect(s.physics.stats.steps).toBe(0);expect(s.physics.bodies.size).toBe(0);layer.dispose();expect([...s.entities.keys()]).toEqual(['native:desk']);
});
const scene=()=>new Scene({version:1,entities:[],ground:-100});
const entities=(s:Scene,prefix:string)=>[...s.entities.values()].filter(e=>e.id.includes(prefix));
const pose=(s:Scene)=>entities(s,'canonical:original:').map(e=>({id:e.id,position:e.position,rotation:e.rotation,scale:e.scale}));
const vertex=(e:RuntimeEntity,index:number)=>{if(e.mesh?.kind!=='triangle-mesh')throw new Error('Expected canonical mesh');return[e.position[0]+e.mesh.positions[index*3]!*e.scale[0],e.position[1]+e.mesh.positions[index*3+1]!*e.scale[1],e.position[2]+e.mesh.positions[index*3+2]!*e.scale[2]];};
const absolute=(b:CanonicalBinding,p:readonly number[],floor=b.officeFloor)=>{const c=Math.cos(b.yaw),s=Math.sin(b.yaw);return[b.origin[0]+c*p[0]!+s*p[2]!,b.origin[1]+floor*b.floorHeight+p[1]!,b.origin[2]-s*p[0]!+c*p[2]!];};

test('camera ignores only the subject vehicle during boarding and seating, then restores it after exit',()=>{
 const f=fixture(),car=f.entities.find(e=>e.kind==='vehicle')!,rider=f.entities[0]!,other:CanonicalEntity={...car,id:'vehicle:camera-neighbor',x:car.x+6};f.entities.push(other);Object.assign(rider,{x:car.x,y:car.y,z:car.z,animation:'drive',extra:{seat:car.id,seatId:'driver',seatRole:'driver'}});
 const s=scene(),layer=new CanonicalWorldLayer(s,{mode:'game',actorFactory:createOfficeActors});layer.setSubject(rider.id);layer.update(f);layer.update({...f,time:f.time+.1});
 const own=entities(s,'custom:'+car.id+':'),neighbor=entities(s,'custom:'+other.id+':');expect(own.length).toBeGreaterThan(0);expect(neighbor.length).toBeGreaterThan(0);expect(own.every(e=>layer.ignoreCameraMesh(e.id))).toBe(true);expect(neighbor.some(e=>layer.ignoreCameraMesh(e.id))).toBe(false);
 rider.extra={boarding:{vehicleId:car.id}};layer.update({...f,time:f.time+.2});expect(own.every(e=>layer.ignoreCameraMesh(e.id))).toBe(true);
 rider.extra={};layer.update({...f,time:f.time+.3});
 const part=own[0]!,m=renderModel(part);if(part.mesh?.kind!=='triangle-mesh')throw Error('Expected original vehicle triangles');const raw=part.mesh.positions,near:[number,number,number]=[0,0,0];for(let i=0;i<3;i++)near[i]=m[12+i]!+m[i]!*raw[0]!+m[4+i]!*raw[1]!+m[8+i]!*raw[2]!;
 layer.prepareCamera(near,.38);expect(own.every(e=>layer.ignoreCameraMesh(e.id))).toBe(true);expect(neighbor.some(e=>layer.ignoreCameraMesh(e.id))).toBe(false);expect(layer.ignoreCameraMesh('batch:canonical:city:wall')).toBe(false);
 // A free near plane alone can still put the eye inside the subject's head.
 // Probe 80 cm above an actual highest vehicle vertex: all old .38 m probes
 // clear, but the exited subject still needs one metre of viewing space.
 let top:[number,number,number]=[0,-Infinity,0];for(const e of own){if(e.mesh?.kind!=='triangle-mesh')continue;const model=renderModel(e);for(let i=0;i<e.mesh.positions.length;i+=3){const [x,y,z]=e.mesh.positions.slice(i,i+3),p:[number,number,number]=[model[12]!+model[0]!*x!+model[4]!*y!+model[8]!*z!,model[13]!+model[1]!*x!+model[5]!*y!+model[9]!*z!,model[14]!+model[2]!*x!+model[6]!*y!+model[10]!*z!];if(p[1]>top[1])top=p;}}
 layer.prepareCamera([top[0],top[1]+.8,top[2]],.38);expect(own.every(e=>layer.ignoreCameraMesh(e.id))).toBe(true);expect(neighbor.some(e=>layer.ignoreCameraMesh(e.id))).toBe(false);
 layer.prepareCamera([1000,1000,1000],.38);expect(own.some(e=>layer.ignoreCameraMesh(e.id))).toBe(false);
 rider.extra={seat:car.id};layer.update({...f,time:f.time+.4});layer.setSubject('other-body');expect(own.some(e=>layer.ignoreCameraMesh(e.id))).toBe(false);
 layer.setSubject(rider.id);layer.update({...f,time:f.time+.5});rider.extra={};layer.update({...f,time:f.time+.6,epoch:f.epoch+1,binding:{...f.binding,epoch:f.binding.epoch+1}});expect(own.some(e=>layer.ignoreCameraMesh(e.id))).toBe(false);layer.dispose();
});
test('canonical projection consumes the actual generated facade, actor palette and vehicle rig',()=>{
 const frame=fixture(),s=scene(),layer=new CanonicalWorldLayer(s,{mode:'office',actorFactory:createOfficeActors});layer.update(frame);
 expect(layer.diagnostics).toMatchObject({source:'thegame',actors:2,traffic:1,chunks:1,cityVisible:true,presentedTime:10});expect(layer.diagnostics.facade).toBeGreaterThan(0);
 const facade=entities(s,'canonical:facade:');expect(facade.every(e=>e.renderOnly&&e.material.color[3]>0&&e.material.color[3]<1)).toBe(true);
 expect(layer.diagnostics.assets).toBe('ready');expect(layer.diagnostics.assetMeshes).toBeGreaterThan(20);
 expect(entities(s,'canonical:actor:')).toHaveLength(0);expect(entities(s,'canonical:vehicle:')).toHaveLength(0);expect(entities(s,'canonical:original:').every(e=>e.mesh?.kind==='triangle-mesh')).toBe(true);
 expect(layer.markers()[0]).toMatchObject({id:'player:canonical',name:'Настоящий посетитель'});expect(layer.markers()[0]!.position[0]).toBeCloseTo(1,6);expect(layer.markers()[0]!.position[2]).toBeCloseTo(-2,6);expect([...s.entities.values()].every(e=>e.renderOnly)).toBe(true);layer.dispose();expect(s.entities.size).toBe(0);
});

test('canonical render time follows each presented authority frame without advancing local physics',()=>{
 const frame=fixture(),s=scene(),layer=new CanonicalWorldLayer(s,{mode:'office',actorFactory:createOfficeActors});layer.update(frame);expect(s.time).toBe(10);expect(s.tick).toBe(0);expect(s.physics.stats.steps).toBe(0);
 layer.update({...frame,time:10.125,geometry:undefined});expect(s.time).toBe(10.125);expect(layer.diagnostics.presentedTime).toBe(10.125);
 layer.update({...frame,time:2,geometry:undefined});expect(s.time).toBe(2);expect(s.tick).toBe(0);expect(s.physics.bodies.size).toBe(0);
 layer.update({...frame,time:NaN,geometry:undefined});expect(s.time).toBe(2);layer.dispose();
});

test('controlled pedestrian identity remains visible outside the Office despite the exterior detail budget',()=>{
 const frame=fixture(),controlled=person(frame.binding,'resident:controlled',0,120,0);frame.entities=Array.from({length:40},(_,i)=>person(frame.binding,'resident:near-office:'+i,0,30+i*.5,0));frame.entities.push(controlled);frame.humanoidStyles[controlled.id]=humanoidStyle(controlled.id);
 const s=scene(),layer=new CanonicalWorldLayer(s,{mode:'game',actorFactory:createOfficeActors});layer.setSubject(controlled.id);layer.update(frame);
 expect(layer.diagnostics.subjectVisible).toBe(true);expect(layer.diagnostics.assetMeshes).toBeGreaterThan(24);expect(layer.diagnostics.actors).toBe(24);expect(s.physics.bodies.size).toBe(0);layer.dispose();
});

test('first-person camera masking preserves the presented subject and restores previous NPC visibility on possession',()=>{
 const frame=fixture(),s=scene(),layer=new CanonicalWorldLayer(s,{mode:'game',actorFactory:createOfficeActors}),first=frame.entities.find(e=>e.kind==='pedestrian'||e.kind==='player')!;layer.setSubject(first.id);layer.update(frame);expect(layer.cameraSubjectHead()).not.toBeNull();const count=s.entities.size;layer.setFirstPerson(true);expect(layer.diagnostics.subjectPresent).toBe(true);expect(layer.diagnostics.subjectVisible).toBe(false);expect(layer.diagnostics.subjectFirstPerson).toBe(true);expect(layer.hasActor(first.id)).toBe(true);expect(s.entities.size).toBe(count);const suppressed=[...s.entities.values()].filter(e=>e.renderCameraVisible===false);expect(suppressed.length).toBeGreaterThan(20);expect(suppressed.length).toBe(layer.diagnostics.subjectSuppressedMeshes);for(const e of suppressed){expect(layer.isActorMesh(e.id)).toBe(true);expect(e.renderVisible).not.toBe(false);}
 layer.update({...frame,time:frame.time+.1});expect(layer.diagnostics.subjectVisible).toBe(false);layer.setSubject(null);expect(layer.diagnostics.subjectFirstPerson).toBe(false);for(const e of s.entities.values())if(layer.isActorMesh(e.id)){expect(e.renderVisible).not.toBe(false);expect(e.renderCameraVisible).not.toBe(false);}layer.setSubject(first.id);layer.update({...frame,entities:frame.entities.map(e=>e.id===first.id?{...e,extra:{...e.extra,seat:'vehicle:test'}}:e)});expect(layer.cameraSubjectHead()).toBeNull();expect(s.physics.bodies.size).toBe(0);expect(s.tick).toBe(0);layer.dispose();
});

test('controller terrain is clipped around its committed area and has real triangles below the remote body',()=>{
 const frame=fixture(),subject={...frame.entities[0]!,x:-345,y:.17,z:-66},g=frame.geometry!;g.key='controller:far';g.terrain={step:8,startX:-512,startZ:-256,width:49,depth:49,heights:Array(49*49).fill(0)};frame.view={kind:'controller',center:[-320,0,-64],geometryKey:g.key};frame.entities=[subject];
 const s=scene(),layer=new CanonicalWorldLayer(s,{mode:'game',actorFactory:createOfficeActors});layer.setSubject(subject.id);layer.update(frame);const floor=entities(s,'canonical:terrain:'),p=layer.toLocal([subject.x,0,subject.z]);
 expect(layer.diagnostics.terrainPatches).toBeGreaterThan(0);expect(floor.length).toBe(layer.diagnostics.terrainPatches);expect(layer.diagnostics.subjectVisible).toBe(true);
 expect(floor.some(e=>{if(e.mesh?.kind!=='triangle-mesh')return false;const xs=e.mesh.positions.filter((_,i)=>i%3===0).map(x=>x+e.position[0]),zs=e.mesh.positions.filter((_,i)=>i%3===2).map(z=>z+e.position[2]);return p[0]>=Math.min(...xs)&&p[0]<=Math.max(...xs)&&p[2]>=Math.min(...zs)&&p[2]<=Math.max(...zs)&&e.mesh.indices.length>0;})).toBe(true);
 expect(s.physics.bodies.size).toBe(0);layer.setCityVisible(false);expect(layer.diagnostics.terrainPatches).toBe(0);layer.dispose();
});

test('canonical terrain and curved roads use exact server samples rather than an independent grid',()=>{
 const frame=fixture(),s=scene(),layer=new CanonicalWorldLayer(s,{mode:'office',actorFactory:createOfficeActors});layer.update(frame);const terrain=entities(s,'canonical:terrain')[0]!,record=frame.geometry!.terrain;
 for(let i=0;i<9;i++){const p=absolute(frame.binding,vertex(terrain,i));expect(p[0]).toBeCloseTo(record.startX+i%3*8,4);expect(p[1]).toBeCloseTo(record.heights[i]!,4);expect(p[2]).toBeCloseTo(record.startZ+Math.floor(i/3)*8,4);}
 const road=entities(s,'canonical:road:source-curved:')[0]!;for(let i=0;i<3;i++){const a=absolute(frame.binding,vertex(road,i*2)),b=absolute(frame.binding,vertex(road,i*2+1)),sample=frame.geometry!.roads[0]!.samples[i]!;expect((a[0]!+b[0]!)/2).toBeCloseTo(sample[0],4);expect((a[1]!+b[1]!)/2).toBeCloseTo(sample[1]+.018,4);expect((a[2]!+b[2]!)/2).toBeCloseTo(sample[2],4);expect(Math.hypot(a[0]!-b[0]!,a[2]!-b[2]!)).toBeCloseTo(8,4);}
 expect(entities(s,'world:road')).toHaveLength(0);layer.dispose();
});

test('canonical hide-city hides the facade and retains the lift and visitor through repeated switches without leaks',()=>{
 const frame=fixture(),s=scene(),layer=new CanonicalWorldLayer(s,{mode:'office',actorFactory:createOfficeActors});s.add({id:'native:desk',mesh:{kind:'box'},renderOnly:true});layer.update(frame);const count=s.entities.size,facadeIds=entities(s,'canonical:facade:').map(e=>e.id),gate=s.entities.get('canonical:gate:2:1')!.position.slice();
 for(let i=0;i<8;i++){layer.setCityVisible(false);expect(layer.diagnostics).toMatchObject({chunks:0,actors:1,traffic:0,cityVisible:false});expect(entities(s,'canonical:terrain')).toHaveLength(0);expect(entities(s,'canonical:road:')).toHaveLength(0);expect(facadeIds.every(id=>!s.entities.has(id))).toBe(true);expect(layer.diagnostics.facade).toBe(0);expect(layer.markers().map(m=>m.id)).toEqual(['player:canonical']);expect(s.entities.get('canonical:gate:2:1')!.position).toEqual(gate);const hidden=s.entities.size;layer.update({...frame,geometry:undefined});expect(s.entities.size).toBe(hidden);layer.setCityVisible(true);expect(s.entities.size).toBe(count);}
 layer.dispose();expect(s.entities.size).toBe(1);expect(s.entities.has('native:desk')).toBe(true);expect(layer.diagnostics).toMatchObject({facade:0,chunks:0,actors:0,traffic:0});
});

test('floor changes keep retained canonical geometry aligned and hide other indoor actors',()=>{
 const frame=fixture(),s=scene(),layer=new CanonicalWorldLayer(s,{mode:'office',actorFactory:createOfficeActors});frame.entities.push(person(frame.binding,'player:upstairs',3));layer.update(frame);expect(layer.markers().map(m=>m.id)).toEqual(['player:canonical']);const local=layer.toLocal(frame.binding.origin);expect(local[1]).toBeCloseTo(-6.6,6);layer.setCityVisible(false);layer.setActiveFloor(3);expect(layer.toLocal(frame.binding.origin)[1]).toBeCloseTo(-9.9,6);expect(layer.markers().map(m=>m.id)).toEqual(['player:upstairs']);expect(s.entities.has('canonical:gate:2:1')).toBe(false);expect(s.entities.has('canonical:gate:3:1')).toBe(true);expect(layer.isOfficeFloor(3)).toBe(true);expect(layer.diagnostics.chunks).toBe(0);
 layer.setMode('game');expect(layer.diagnostics.actors).toBe(2);expect(entities(s,'canonical:facade:')).toHaveLength(0);expect(entities(s,'canonical:building:')).toHaveLength(0);layer.setCityVisible(true);expect(entities(s,'canonical:building:').length).toBeGreaterThan(0);layer.setMode('office');expect(layer.diagnostics.actors).toBe(2);layer.setActiveFloor(63);expect(layer.isOfficeFloor(frame.binding.floorCount-1)).toBe(true);layer.dispose();
});

test('canonical lift cabin and gates follow the supplied authority sample',()=>{
 const frame=fixture(),s=scene(),layer=new CanonicalWorldLayer(s,{mode:'office',actorFactory:createOfficeActors});layer.update(frame);const lift=frame.lifts[0]!,spec=frame.binding.core.lift!;expect(s.entities.get('canonical:gate:2:1')!.position[0]).toBeCloseTo(spec.x+1.05,6);expect(s.entities.get('canonical:cabin:floor')!.position[1]).toBeCloseTo(-.06,6);
 lift.elevation=8;lift.door=0;lift.phase='moving';frame.time=11;layer.update({...frame,geometry:undefined});expect(s.entities.get('canonical:cabin:floor')!.position[1]).toBeCloseTo(8-6.6-.06,6);expect(s.entities.get('canonical:gate:2:1')!.position[0]).toBeCloseTo(spec.x+.35,6);expect(layer.diagnostics.presentedTime).toBe(11);layer.dispose();
});

test('canonical world and building changes clear stale geometry until a new source snapshot arrives',()=>{
 const frame=fixture(),s=scene(),layer=new CanonicalWorldLayer(s,{mode:'office',actorFactory:createOfficeActors});layer.update(frame);const stale=entities(s,'canonical:facade:').map(e=>e.id),count=s.entities.size;layer.update(frame);expect(s.entities.size).toBe(count);const before=structuredClone(pose(s));layer.update(frame);expect(pose(s)).toEqual(before);
 const next={...frame,geometry:undefined,binding:{...frame.binding,buildingId:'another-source-parcel'},entities:[],lifts:[]};layer.update(next);expect(stale.every(id=>!s.entities.has(id))).toBe(true);expect(s.entities.size).toBe(0);layer.dispose();layer.update(frame);layer.setCityVisible(false);expect(s.entities.size).toBe(0);
});

test('canonical lighting, wind and city clock come from the full game environment sample',()=>{
 const frame=fixture(),s=scene(),layer=new CanonicalWorldLayer(s,{mode:'office',actorFactory:createOfficeActors});layer.update(frame);expect(s.environment.temperatureC).toBe(frame.air.temperatureC);expect(s.environment.humidity).toBe(frame.weather.humidity);expect(s.environment.groundMoisture).toBe(frame.weather.wetness);expect(s.environment.hour).toBe(12);expect(Math.hypot(s.environment.wind[0],s.environment.wind[2])).toBeCloseTo(Math.hypot(...frame.air.wind),6);const n=layer.diagnostics.lightingUpdates;layer.update({...frame,geometry:undefined,time:10.01});expect(layer.diagnostics.lightingUpdates).toBe(n);layer.dispose();
});

test('original model frame uniforms follow canonical rain, night, rotated wind and absolute floor height',()=>{
 const f=fixture(),s=scene(),layer=new CanonicalWorldLayer(s,{mode:'office',actorFactory:createOfficeActors});f.weather.rain=.63;f.environment.rain=.63;f.environment.snow=0;f.air.temperatureC=8;f.environment.visual.artificialLightIntensity=.311;layer.update(f);
 const r=s.spec.rendering!,weather=r.surfaceWeather!,c=Math.cos(f.binding.yaw),sn=Math.sin(f.binding.yaw);
 expect(r.facadeNight).toBe(.311);expect(weather.rain).toBe(.63);expect(weather.origin![1]).toBeCloseTo(f.binding.origin[1]+2*f.binding.floorHeight,8);expect(weather.groundWind![0]).toBeCloseTo(c*f.air.wind[0]-sn*f.air.wind[1],8);expect(weather.groundWind![1]).toBeCloseTo(sn*f.air.wind[0]+c*f.air.wind[1],8);expect(s.tick).toBe(0);expect(s.physics.bodies.size).toBe(0);layer.dispose();
});

test('exterior detail budget preserves every player on the office floor',()=>{
 const frame=fixture(),s=scene(),layer=new CanonicalWorldLayer(s,{mode:'office',actorFactory:createOfficeActors}),inside=Array.from({length:24},(_,i)=>person(frame.binding,`player:office:${i}`,2,(i%8-3.5)*.6,Math.floor(i/8)*.6)),outside=Array.from({length:30},(_,i)=>person(frame.binding,`resident:outside:${i}`,0,40+i*2,0));frame.entities=[...inside,...outside];layer.update(frame);expect(layer.diagnostics.actors).toBe(36);for(const player of inside)expect(layer.hasActor(player.id)).toBe(true);expect(layer.hasActor('resident:outside:11')).toBe(true);expect(layer.hasActor('resident:outside:12')).toBe(false);layer.setCityVisible(false);expect(layer.diagnostics.actors).toBe(24);expect(layer.markers().map(m=>m.id)).toEqual(inside.map(e=>e.id));layer.dispose();
});

test('large supplied terrain is clipped to exact 8 m vertices and bounded 64 m patches',()=>{
 const frame=fixture(),s=scene(),layer=new CanonicalWorldLayer(s,{mode:'office',actorFactory:createOfficeActors}),terrain=new Terrain(frame.seed),step=8,startX=Math.floor((frame.binding.origin[0]-192)/8)*8,startZ=Math.floor((frame.binding.origin[2]-192)/8)*8;frame.geometry!.terrain={step,startX,startZ,width:49,depth:49,heights:Array.from({length:49*49},(_,i)=>terrain.heightVertex(startX/8+i%49,startZ/8+Math.floor(i/49)))};layer.update(frame);const patches=entities(s,'canonical:terrain:');expect(patches.length).toBeGreaterThan(1);expect(patches.length).toBeLessThanOrEqual(16);
 for(const patch of patches){expect(patch.mesh!.kind).toBe('triangle-mesh');if(patch.mesh?.kind!=='triangle-mesh')continue;const points=Array.from({length:patch.mesh.positions.length/3},(_,i)=>absolute(frame.binding,vertex(patch,i))),xs=points.map(p=>p[0]!),zs=points.map(p=>p[2]!);expect(Math.max(...xs)-Math.min(...xs)).toBeLessThanOrEqual(64.001);expect(Math.max(...zs)-Math.min(...zs)).toBeLessThanOrEqual(64.001);for(const p of points){expect(Math.abs(p[0]!-frame.binding.origin[0])).toBeLessThanOrEqual(128.001);expect(Math.abs(p[2]!-frame.binding.origin[2])).toBeLessThanOrEqual(128.001);expect(p[1]).toBeCloseTo(terrain.sample(p[0]!,p[2]!).y,4);}}
 layer.dispose();
});

test('hidden city keeps canonical moonlight without recreating facade',()=>{const frame=fixture(),s=scene(),layer=new CanonicalWorldLayer(s,{mode:'office',actorFactory:createOfficeActors});layer.update(frame);layer.setCityVisible(false);frame.environment=worldEnvironment(frame.seed,0,104,232);layer.update(frame);const c=frame.environment.celestial!;expect(c.body).toBe('moon');expect(c.intensity).toBeGreaterThan(0);expect(s.spec.rendering!.sunIntensity).toBe(c.intensity);expect(s.spec.rendering!.sunColor).toEqual(c.color);expect(s.spec.rendering!.sunDirection![1]).toBeCloseTo(Math.sin(c.elevation),6);expect(layer.diagnostics.facade).toBe(0);layer.dispose();});

test('bound Office offsets actors and the real lift together while retaining the stair core with city hidden',()=>{
 const frame=fixture(),b=frame.binding,s=scene(),layer=new CanonicalWorldLayer(s,{mode:'office',actorFactory:createOfficeActors}),offset=2.6;
 b.layoutStatus='bound';b.geometryRevision=1;b.placement={worldId:b.worldId,buildingId:b.buildingId,offsetZ:offset,width:b.width-.2,depth:b.depth-b.core.depth-.2,entryWidth:2.2,floorHeight:b.floorHeight,firstFloor:2,floors:[{id:'floor-1',index:2}]};
 const stair={id:'authority-stair',role:'stair',x:0,y:6.7,z:-b.depth/2+1,w:2,h:.2,l:1,color:[.5,.5,.5] as [number,number,number],material:0,solid:true};frame.geometry!.officeCore=[{index:2,boxes:[stair]}];
 layer.update(frame);layer.setCityVisible(false);const actor=frame.entities[0]!,p=layer.toLocal([actor.x,actor.y,actor.z]);expect(p[0]).toBeCloseTo(1,6);expect(p[2]).toBeCloseTo(-2-offset,6);
 expect(s.entities.get('canonical:cabin:floor')!.position[2]).toBeCloseTo(b.core.lift!.z-offset,6);expect(s.entities.get('canonical:gate:2:1')!.position[2]).toBeCloseTo(b.core.lift!.doorZ-offset,6);
 expect(entities(s,'canonical:core:').length).toBeGreaterThan(0);expect(entities(s,'canonical:facade:')).toHaveLength(0);expect(Math.hypot(s.environment.wind[0],s.environment.wind[2])).toBeCloseTo(Math.hypot(...frame.air.wind),6);layer.dispose();
});
