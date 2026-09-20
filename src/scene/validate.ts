import {AnimationSystem,type WalkerSpec,type VehicleMotionSpec} from '../animation/locomotion.js';
import {SnowSurface,type SnowSurfaceOptions} from '../environment/snow-surface.js';
import {materialKinds} from '../materials/catalog.js';
import {finiteVec3} from '../math.js';
import type {SceneSpec,EntitySpec} from './types.js';

export function validateScene(value:unknown):SceneSpec{
  if(!value||typeof value!=='object')throw new TypeError('Scene must be an object');
  const scene=value as Record<string,unknown>;
  if(scene.version!==1)throw new TypeError('Unsupported scene version');
  if(!Array.isArray(scene.entities))throw new TypeError('Scene.entities must be an array');
  const ids=new Set<string>();
  for(const [index,raw] of scene.entities.entries()){
    if(!raw||typeof raw!=='object')throw new TypeError(`Entity ${index} must be an object`);const entity=raw as Record<string,unknown>;
    if(typeof entity.id!=='string'||!entity.id||entity.id.length>180||ids.has(entity.id))throw new TypeError(`Entity ${index} requires a unique stable id`);ids.add(entity.id);
    for(const key of ['position','rotation','scale'] as const)if(entity[key]!==undefined){if(!Array.isArray(entity[key]))throw new TypeError(`${entity.id}.${key} must be a vec3`);finiteVec3(entity[key] as number[],`${entity.id}.${key}`);}
    validateEntity(entity);
    if(entity.body!==undefined&&(!entity.body||typeof entity.body!=='object'))throw new TypeError(`${entity.id}.body must be an object`);
    if(entity.environmental!==undefined){if(!entity.environmental||typeof entity.environmental!=='object')throw new TypeError(`${entity.id}.environmental must be an object`);const use=(entity.environmental as Record<string,unknown>).surfaceUse;if(use!==undefined&&!['generic','road','sidewalk','curb'].includes(String(use)))throw new TypeError(`${entity.id}.environmental.surfaceUse is unknown`);}
    if(entity.material!==undefined){
      if(!entity.material||typeof entity.material!=='object')throw new TypeError(`${entity.id}.material must be an object`);
      const material=entity.material as Record<string,unknown>,kind=material.kind;
      if(kind!==undefined&&!materialKinds().includes(kind as any))throw new TypeError(`${entity.id}.material.kind is unknown`);
      if(material.finish!==undefined&&!['raw','rough','smooth','polished','weathered'].includes(String(material.finish)))throw new TypeError(`${entity.id}.material.finish is unknown`);
      if(material.treatment!==undefined&&!['none','sealed','biocide','galvanized','painted'].includes(String(material.treatment)))throw new TypeError(`${entity.id}.material.treatment is unknown`);
      if(material.ageYears!==undefined&&(typeof material.ageYears!=='number'||!Number.isFinite(material.ageYears)||material.ageYears<0))throw new TypeError(`${entity.id}.material.ageYears must be non-negative`);
    }
  }
  validateBindings(scene,scene.entities as EntitySpec[]);
  if(scene.seed!==undefined&&(!Number.isSafeInteger(scene.seed)))throw new TypeError('seed must be a safe integer');
  optionalNumber(scene,'ground','scene');
  if(scene.clearColor!==undefined)vector(scene.clearColor,4,'clearColor',0,1);
  if(scene.gravity!==undefined){if(!Array.isArray(scene.gravity))throw new TypeError('gravity must be a vec3');finiteVec3(scene.gravity as number[],'gravity');}
  if(scene.environment!==undefined){
    if(!scene.environment||typeof scene.environment!=='object')throw new TypeError('environment must be an object');
    const environment=scene.environment as Record<string,unknown>;
    for(const key of ['humidity','sunlight','groundMoisture'])if(environment[key]!==undefined&&(typeof environment[key]!=='number'||!Number.isFinite(environment[key])||Number(environment[key])<0||Number(environment[key])>1))throw new TypeError(`environment.${key} must be within 0..1`);
    if(environment.temperatureC!==undefined&&(typeof environment.temperatureC!=='number'||!Number.isFinite(environment.temperatureC)))throw new TypeError('environment.temperatureC must be finite');
    if(environment.precipitation!==undefined&&!['arid','rare','occasional','frequent'].includes(String(environment.precipitation)))throw new TypeError('environment.precipitation is unknown');
    if(environment.snowfall!==undefined&&!['none','light','moderate','heavy'].includes(String(environment.snowfall)))throw new TypeError('environment.snowfall is unknown');
    if(environment.wind!==undefined){if(!Array.isArray(environment.wind))throw new TypeError('environment.wind must be a vec3');finiteVec3(environment.wind as number[],'environment.wind');}
    if(environment.clock!==undefined){
      if(!environment.clock||typeof environment.clock!=='object')throw new TypeError('environment.clock must be an object');
      const clock=environment.clock as Record<string,unknown>;
      if(clock.startHour!==undefined&&(typeof clock.startHour!=='number'||!Number.isFinite(clock.startHour)))throw new TypeError('environment.clock.startHour must be finite');
      if(clock.hoursPerSecond!==undefined&&(typeof clock.hoursPerSecond!=='number'||!Number.isFinite(clock.hoursPerSecond)||clock.hoursPerSecond<0))throw new TypeError('environment.clock.hoursPerSecond must be non-negative');
    }
    if(environment.weather!==undefined){
      if(!Array.isArray(environment.weather))throw new TypeError('environment.weather must be an array');
      for(const [index,raw] of environment.weather.entries()){
        if(!raw||typeof raw!=='object')throw new TypeError(`environment.weather[${index}] must be an object`);
        const frame=raw as Record<string,unknown>;
        if(typeof frame.hour!=='number'||!Number.isFinite(frame.hour)||frame.hour<0||frame.hour>24)throw new TypeError(`environment.weather[${index}].hour must be within 0..24`);
        if(frame.temperatureC!==undefined&&(typeof frame.temperatureC!=='number'||!Number.isFinite(frame.temperatureC)))throw new TypeError(`environment.weather[${index}].temperatureC must be finite`);
        if(frame.sunlight!==undefined&&(typeof frame.sunlight!=='number'||!Number.isFinite(frame.sunlight)||frame.sunlight<0||frame.sunlight>1))throw new TypeError(`environment.weather[${index}].sunlight must be within 0..1`);
        if(frame.humidity!==undefined&&(typeof frame.humidity!=='number'||!Number.isFinite(frame.humidity)||frame.humidity<0||frame.humidity>1))throw new TypeError(`environment.weather[${index}].humidity must be within 0..1`);
        if(frame.snowfall!==undefined&&!['none','light','moderate','heavy'].includes(String(frame.snowfall)))throw new TypeError(`environment.weather[${index}].snowfall is unknown`);
        if(frame.wind!==undefined){if(!Array.isArray(frame.wind))throw new TypeError(`environment.weather[${index}].wind must be a vec3`);finiteVec3(frame.wind as number[],`environment.weather[${index}].wind`);}
      }
    }
  }
  if(scene.camera!==undefined){const camera=object(scene.camera,'camera');optionalNumber(camera,'fov','camera',1,179);optionalNumber(camera,'focusDistance','camera',.05);optionalNumber(camera,'aperture','camera',0,20);if(JSON.stringify(camera.position)===JSON.stringify(camera.target))throw new TypeError('camera position and target must differ');if(!Array.isArray(camera.position)||!Array.isArray(camera.target))throw new TypeError('camera position/target must be vec3');finiteVec3(camera.position as number[],'camera.position');finiteVec3(camera.target as number[],'camera.target');}
  if(scene.rendering!==undefined){
    const r=object(scene.rendering,'rendering');
    if(r.sunDirection!==undefined){vector(r.sunDirection,3,'rendering.sunDirection');if(Math.hypot(...r.sunDirection as number[])<1e-8)throw new TypeError('rendering.sunDirection must be nonzero');}
    for(const key of ['sunColor','skyColor'])if(r[key]!==undefined)vector(r[key],3,`rendering.${key}`,0);
    for(const key of ['sunIntensity','fogDensity','exposure'])optionalNumber(r,key,'rendering',0);
    optionalNumber(r,'shadowExtent','rendering',.1,10000);
    if(r.reflectionProbe!==undefined){
      const probe=object(r.reflectionProbe,'rendering.reflectionProbe'),hasPosition=probe.position!==undefined,hasEntity=probe.entity!==undefined;
      if(hasPosition===hasEntity)throw new TypeError('rendering.reflectionProbe requires exactly one of position or entity');
      if(hasPosition)vector(probe.position,3,'rendering.reflectionProbe.position');
      if(hasEntity){const id=stableId(probe.entity,'rendering.reflectionProbe.entity');if(!ids.has(id))throw new TypeError(`rendering.reflectionProbe.entity references missing entity ${id}`);}
      if(probe.offset!==undefined)vector(probe.offset,3,'rendering.reflectionProbe.offset');
      optionalNumber(probe,'radius','rendering.reflectionProbe',.5,500);
      if(probe.facesPerFrame!==undefined){number(probe.facesPerFrame,'rendering.reflectionProbe.facesPerFrame',1,6);if(!Number.isInteger(probe.facesPerFrame))throw new TypeError('rendering.reflectionProbe.facesPerFrame must be integer');}
      if(probe.exclude!==undefined){const excluded=boundedArray(probe.exclude,'rendering.reflectionProbe.exclude',4096);for(const [i,value] of excluded.entries()){const id=stableId(value,`rendering.reflectionProbe.exclude[${i}]`);if(!ids.has(id))throw new TypeError(`rendering.reflectionProbe.exclude[${i}] references missing entity ${id}`);}}
    }
  }
  return structuredClone(value) as SceneSpec;
}

const HUMANOID_JOINTS=['root','pelvis','chest','neck','head','leftHip','rightHip','leftKnee','rightKnee','leftAnkle','rightAnkle','leftFoot','rightFoot','leftShoulder','rightShoulder','leftElbow','rightElbow','leftHand','rightHand'];
function boundedArray(value:unknown,path:string,limit:number):unknown[]{if(!Array.isArray(value)||value.length>limit)throw new TypeError(`${path} must be an array of at most ${limit} entries`);return value;}
function stableId(value:unknown,path:string,max=180):string{if(typeof value!=='string'||!value||value.length>max)throw new TypeError(`${path} requires a stable id`);return value;}
function validateBindings(scene:Record<string,unknown>,entities:readonly EntitySpec[]):void{
  const byId=new Map(entities.map(e=>[e.id,e])),claimed=new Set<string>();
  const reference=(value:unknown,path:string)=>{const id=stableId(value,path),entity=byId.get(id);if(!entity)throw new TypeError(`${path} references missing entity ${id}`);return entity;};
  if(scene.animation!==undefined){
    const a=object(scene.animation,'animation'),walkers=a.walkers===undefined?[]:boundedArray(a.walkers,'animation.walkers',128),vehicles=a.vehicles===undefined?[]:boundedArray(a.vehicles,'animation.vehicles',128);
    if(walkers.length+vehicles.length>128)throw new TypeError('animation supports at most 128 actors');
    const validator=new AnimationSystem();
    const claim=(id:string,path:string)=>{const entity=reference(id,path),body=entity.body;if(body&&body.motion!=='kinematic'&&(body.mass??(body.velocity||body.angularVelocity?1:0))>0)throw new TypeError(`${path} cannot bind a dynamic physics body`);if(claimed.has(id))throw new TypeError(`${path} binds entity ${id} more than once`);claimed.add(id);};
    for(const [i,raw] of walkers.entries()){
      const path=`animation.walkers[${i}]`,w=object(raw,path);stableId(w.id,`${path}.id`,160);vector(w.root,3,`${path}.root`);number(w.speed,`${path}.speed`,0,12);optionalNumber(w,'heading',path);optionalNumber(w,'period',path,.25,4);optionalNumber(w,'heightScale',path,.25,3);
      for(const [j,value] of (w.bindings===undefined?[]:boundedArray(w.bindings,`${path}.bindings`,4096)).entries()){
        const p=`${path}.bindings[${j}]`,b=object(value,p);claim(stableId(b.entity,`${p}.entity`),`${p}.entity`);
        if(!HUMANOID_JOINTS.includes(String(b.joint)))throw new TypeError(`${p}.joint is unknown`);
        choice(b.boneTo,HUMANOID_JOINTS,`${p}.boneTo`);choice(b.foot,['left','right'],`${p}.foot`);
        for(const key of ['offset','rotation','scale'])if(b[key]!==undefined)vector(b[key],3,`${p}.${key}`,key==='scale'?Number.MIN_VALUE:-Infinity);
      }
      validator.addWalker(w as unknown as WalkerSpec);
    }
    for(const [i,raw] of vehicles.entries()){
      const path=`animation.vehicles[${i}]`,v=object(raw,path);stableId(v.id,`${path}.id`,160);vector(v.velocity,3,`${path}.velocity`);optionalNumber(v,'startTime',path,0);
      const parts=boundedArray(v.parts,`${path}.parts`,4096);if(!parts.length)throw new TypeError(`${path}.parts must not be empty`);
      for(const [j,value] of parts.entries()){
        const p=`${path}.parts[${j}]`,part=object(value,p);claim(stableId(part.id,`${p}.id`),`${p}.id`);vector(part.origin,3,`${p}.origin`);
        if(part.wheel!==undefined&&typeof part.wheel!=='boolean')throw new TypeError(`${p}.wheel must be boolean`);
        optionalNumber(part,'radius',p,Number.MIN_VALUE);if(part.rotation!==undefined)vector(part.rotation,3,`${p}.rotation`);choice(part.wheelAxis,[0,1,2],`${p}.wheelAxis`);
      }
      validator.addVehicle(v as unknown as VehicleMotionSpec);
    }
  }
  if(scene.deformation!==undefined){
    const config=object(scene.deformation,'deformation'),bodies=config.bodies===undefined?[]:boundedArray(config.bodies,'deformation.bodies',128),bodyIds=new Set<string>(),visualIds=new Set<string>();
    for(const [i,raw] of bodies.entries()){
      const path=`deformation.bodies[${i}]`,item=object(raw,path),bodyId=stableId(item.bodyId,`${path}.bodyId`),body=reference(bodyId,`${path}.bodyId`);
      if(bodyIds.has(bodyId))throw new TypeError(`${path}.bodyId is duplicated`);bodyIds.add(bodyId);
      if(!body.body)throw new TypeError(`${path}.bodyId requires a physics body`);
      if(body.body.shape==='sphere')throw new TypeError(`${path}.bodyId must use a box collision envelope`);
      if(!body.mesh&&!body.body.collisionSize)throw new TypeError(`${path}.bodyId requires body.collisionSize when it has no mesh`);
      const ids=boundedArray(item.visualIds,`${path}.visualIds`,4096);if(!ids.length)throw new TypeError(`${path}.visualIds must not be empty`);
      const deform=item.deformVisualIds===undefined?ids:boundedArray(item.deformVisualIds,`${path}.deformVisualIds`,4096),deformSet=new Set(deform.map(String));
      for(const id of deformSet)if(!ids.map(String).includes(id))throw new TypeError(`${path}.deformVisualIds must be a subset of visualIds`);
      for(const [j,value] of ids.entries()){
        const p=`${path}.visualIds[${j}]`,id=stableId(value,p),visual=reference(id,p);
        if(visualIds.has(id))throw new TypeError(`${p} is already owned by another deformation body`);visualIds.add(id);
        if((visual.renderMesh??visual.mesh)?.kind!=='triangle-mesh')throw new TypeError(`${p} must reference a triangle mesh`);
        if(visual.body&&(visual.body.mass??(visual.body.velocity||visual.body.angularVelocity?1:0))>0)throw new TypeError(`${p} cannot also own a dynamic physics body`);
      }
      optionalNumber(item,'skinThicknessM',path,.0002,.02);optionalNumber(item,'radiusM',path,.06,2.5);optionalNumber(item,'maxDentM',path,.01,1.8);optionalNumber(item,'minEnergyJ',path,0,1e7);
    }
  }
  if(scene.surfaceContacts!==undefined){
    const config=object(scene.surfaceContacts,'surfaceContacts'),snow=config.snow===undefined?[]:boundedArray(config.snow,'surfaceContacts.snow',128),wheels=config.wheels===undefined?[]:boundedArray(config.wheels,'surfaceContacts.wheels',512),snowIds=new Set<string>(),wheelIds=new Set<string>();
    for(const [i,raw]of snow.entries()){
      const path=`surfaceContacts.snow[${i}]`,item=object(raw,path),entity=reference(item.surfaceId,`${path}.surfaceId`);
      if(snowIds.has(entity.id))throw new TypeError(`${path}.surfaceId is duplicated`);snowIds.add(entity.id);
      if(!entity.environmental?.surfaceUse)throw new TypeError(`${path}.surfaceId requires an environmental surface`);
      if(Math.abs(entity.rotation?.[0]??0)>1e-5||Math.abs(entity.rotation?.[2]??0)>1e-5||!['box','plane'].includes(entity.mesh?.kind??''))throw new TypeError(`${path}.surfaceId requires a horizontal box or plane`);
      for(const key of ['tileSize','coarseCellSize','detailedCellSize','maxTiles','maxDetailedTiles'])optionalNumber(item,key,path,Number.MIN_VALUE);
      if(item.seed!==undefined&&!Number.isSafeInteger(item.seed))throw new TypeError(`${path}.seed must be a safe integer`);
      if(item.material!==undefined)materialSpec(item.material,`${path}.material`);
      const mesh=entity.mesh!,scale=entity.scale??[1,1,1],size:readonly[number,number]=mesh.kind==='box'?[(mesh.size?.[0]??1)*scale[0],(mesh.size?.[2]??1)*scale[2]]:mesh.kind==='plane'?[(mesh.size?.[0]??1)*scale[0],(mesh.size?.[1]??1)*scale[2]]:[1,1];
      try{new SnowSurface({...item,id:'validate-snow',center:[0,0],height:0,size} as unknown as SnowSurfaceOptions);}catch(error){throw new TypeError(`${path}: ${error instanceof Error?error.message:String(error)}`);}
    }
    for(const [i,raw]of wheels.entries()){
      const path=`surfaceContacts.wheels[${i}]`,item=object(raw,path),entity=reference(item.entityId,`${path}.entityId`);
      if(wheelIds.has(entity.id))throw new TypeError(`${path}.entityId is duplicated`);wheelIds.add(entity.id);
      if(!entity.body)throw new TypeError(`${path}.entityId requires a physics body`);
      optionalNumber(item,'radius',path,Number.MIN_VALUE);if(item.lateral!==undefined)vector(item.lateral,3,`${path}.lateral`);
    }
  }
}

function object(value:unknown,path:string):Record<string,unknown>{if(!value||typeof value!=='object'||Array.isArray(value))throw new TypeError(`${path} must be an object`);return value as Record<string,unknown>;}
function number(value:unknown,path:string,min=-Infinity,max=Infinity):void{if(typeof value!=='number'||!Number.isFinite(value)||value<min||value>max)throw new TypeError(`${path} must be finite within ${min}..${max}`);}
function optionalNumber(obj:Record<string,unknown>,key:string,path:string,min=-Infinity,max=Infinity):void{if(obj[key]!==undefined)number(obj[key],`${path}.${key}`,min,max);}
function vector(value:unknown,length:number,path:string,min=-Infinity,max=Infinity):void{if(!Array.isArray(value)||value.length!==length)throw new TypeError(`${path} must have ${length} components`);value.forEach((v,i)=>number(v,`${path}[${i}]`,min,max));}
function choice(value:unknown,values:readonly unknown[],path:string):void{if(value!==undefined&&!values.includes(value))throw new TypeError(`${path} is unknown`);}

function assetUrl(value:unknown,path:string):void{
  if(typeof value!=='string'||value.length===0||value.length>8192||/[\s\u0000-\u001f\u007f\\]/u.test(value))throw new TypeError(`${path} must be a nonempty HTTP(S) or relative asset URL`);
  const scheme=/^([a-z][a-z0-9+.-]*):/i.exec(value);
  if(scheme&&!/^https?:\/\//i.test(value))throw new TypeError(`${path} must use HTTP(S) or a relative asset path`);
  try{const parsed=new URL(value,'https://scene-assets.invalid/');if(!['http:','https:'].includes(parsed.protocol))throw new Error('unsupported scheme');}
  catch{throw new TypeError(`${path} must be a valid HTTP(S) or relative asset URL`);}
}
function surfaceTexture(value:unknown,path:string):void{
  const texture=object(value,path);
  if(texture.url===undefined&&texture.normalUrl===undefined&&texture.ormUrl===undefined)throw new TypeError(`${path} requires url, normalUrl or ormUrl`);
  if(texture.url!==undefined)assetUrl(texture.url,`${path}.url`);
  if(texture.normalUrl!==undefined)assetUrl(texture.normalUrl,`${path}.normalUrl`);
  if(texture.ormUrl!==undefined)assetUrl(texture.ormUrl,`${path}.ormUrl`);
  optionalNumber(texture,'sizeM',path,.01,1000);
  optionalNumber(texture,'bumpStrength',path,0,2);
  optionalNumber(texture,'albedoStrength',path,0,1);
  optionalNumber(texture,'normalStrength',path,0,2);
  optionalNumber(texture,'ormStrength',path,0,1);
}
function materialSpec(value:unknown,path:string):void{
  const m=object(value,path);
  if(m.texture!==undefined)surfaceTexture(m.texture,`${path}.texture`);
  if(m.label!==undefined&&(typeof m.label!=='string'||m.label.length>100))throw new TypeError(`${path}.label must be at most 100 characters`);
  optionalNumber(m,'roughness',path,0,1);optionalNumber(m,'metalness',path,0,1);optionalNumber(m,'clearcoat',path,0,1);optionalNumber(m,'clearcoatRoughness',path,.02,1);
  choice(m.pattern,['plain','brick','plaster','rubber','window','fabric'],`${path}.pattern`);
  if(m.emissive!==undefined)vector(m.emissive,3,`${path}.emissive`,0,50);
  choice(m.kind,materialKinds(),`${path}.kind`);
  choice(m.finish,['raw','rough','smooth','polished','weathered'],`${path}.finish`);
  choice(m.treatment,['none','sealed','biocide','galvanized','painted'],`${path}.treatment`);
  optionalNumber(m,'ageYears',path,0);
  if(m.color!==undefined)vector(m.color,4,`${path}.color`,0,1);
}

function primitiveSpec(value:unknown,path:string):void{
  const m=object(value,path);
  if(!['box','sphere','plane','shard','polygon-prism','cylinder','snowdrift','triangle-mesh','torus'].includes(String(m.kind)))throw new TypeError(`${path}.kind is unknown`);
  if(m.kind==='torus'){number(m.radius,`${path}.radius`,Number.MIN_VALUE);number(m.tube,`${path}.tube`,Number.MIN_VALUE);optionalNumber(m,'segments',path,8,128);}
  if(m.kind==='triangle-mesh'){if(!Array.isArray(m.positions)||!Array.isArray(m.normals)||m.positions.length!==m.normals.length||m.positions.length<9||m.positions.length%3||m.positions.length>900000)throw new TypeError(`${path} requires matching vertex and normal triplets`);m.positions.forEach((v,i)=>number(v,`${path}.positions[${i}]`));m.normals.forEach((v,i)=>number(v,`${path}.normals[${i}]`));if(!Array.isArray(m.indices)||!m.indices.length||m.indices.length%3||m.indices.length>1800000)throw new TypeError(`${path}.indices must contain triangles`);for(const index of m.indices)if(!Number.isInteger(index)||index<0||index>=m.positions.length/3)throw new TypeError(`${path}.indices out of bounds`);}
  if(m.kind==='snowdrift'){vector(m.size,3,`${path}.size`,Number.MIN_VALUE);number(m.seed,`${path}.seed`);optionalNumber(m,'segments',path,4,128);optionalNumber(m,'offset',path);if(m.continuous!==undefined&&typeof m.continuous!=='boolean')throw new TypeError(`${path}.continuous must be boolean`);}
  if(m.kind==='cylinder'){number(m.radius,`${path}.radius`,Number.MIN_VALUE);number(m.height,`${path}.height`,Number.MIN_VALUE);optionalNumber(m,'topRadius',path,0);optionalNumber(m,'segments',path,3,128);}
  if(m.kind==='box'||m.kind==='shard'){if(m.size!==undefined||m.kind==='shard')vector(m.size,3,`${path}.size`,Number.MIN_VALUE);}
  if(m.kind==='plane'&&m.size!==undefined)vector(m.size,2,`${path}.size`,Number.MIN_VALUE);
  if(m.kind==='sphere'){optionalNumber(m,'radius',path,Number.MIN_VALUE);if(m.segments!==undefined){number(m.segments,`${path}.segments`,3,256);if(!Number.isInteger(m.segments))throw new TypeError(`${path}.segments must be integer`);}}
  if(m.kind==='shard'||m.kind==='polygon-prism')choice(m.axis,[0,1,2],`${path}.axis`);
  if(m.kind==='shard')optionalNumber(m,'skew',path,-1,1);
  if(m.kind==='polygon-prism'){
    number(m.thickness,`${path}.thickness`,Number.MIN_VALUE);
    if(!Array.isArray(m.points)||m.points.length<3||m.points.length>4096)throw new TypeError(`${path}.points requires 3..4096 vertices`);
    m.points.forEach((p,i)=>vector(p,2,`${path}.points[${i}]`));
  }
}

export function validateEntity(value:unknown):EntitySpec{
  const e=object(value,'entity'),id=e.id;
  if(typeof id!=='string'||!id||id.length>180)throw new TypeError('entity requires a stable id');
  for(const key of ['position','rotation','scale'])if(e[key]!==undefined)vector(e[key],3,`${id}.${key}`,key==='scale'?Number.MIN_VALUE:-Infinity);
  if(e.mesh!==undefined)primitiveSpec(e.mesh,`${id}.mesh`);
  if(e.renderMesh!==undefined)primitiveSpec(e.renderMesh,`${id}.renderMesh`);
  if(e.body!==undefined){const b=object(e.body,`${id}.body`);for(const key of ['mass','friction'])optionalNumber(b,key,`${id}.body`,0);optionalNumber(b,'restitution',`${id}.body`,0,1);choice(b.motion,['dynamic','kinematic'],`${id}.body.motion`);choice(b.shape,['auto','box','sphere'],`${id}.body.shape`);if(b.collisionSize!==undefined)vector(b.collisionSize,3,`${id}.body.collisionSize`,Number.MIN_VALUE);for(const key of ['velocity','angularVelocity'])if(b[key]!==undefined)vector(b[key],3,`${id}.body.${key}`);}
  if(e.material!==undefined)materialSpec(e.material,`${id}.material`);
  if(e.environmental!==undefined){const env=object(e.environmental,`${id}.environmental`);if(env.snowMaterial!==undefined)materialSpec(env.snowMaterial,`${id}.environmental.snowMaterial`);choice(env.surfaceUse,['generic','road','sidewalk','curb'],`${id}.environmental.surfaceUse`);optionalNumber(env,'snowDepthM',`${id}.environmental`,0,5);optionalNumber(env,'iceDepthM',`${id}.environmental`,0,1);optionalNumber(env,'waterDepthM',`${id}.environmental`,0,1);}
  if(e.light!==undefined){const l=object(e.light,`${id}.light`);if(l.kind!=='point')throw new TypeError(`${id}.light.kind is unknown`);optionalNumber(l,'intensity',`${id}.light`,0);optionalNumber(l,'range',`${id}.light`,Number.MIN_VALUE);if(l.color!==undefined)vector(l.color,3,`${id}.light.color`,0,1);}
  return structuredClone(value) as EntitySpec;
}
