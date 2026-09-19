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
  if(scene.rendering!==undefined){const r=object(scene.rendering,'rendering');if(r.sunDirection!==undefined){vector(r.sunDirection,3,'rendering.sunDirection');if(Math.hypot(...r.sunDirection as number[])<1e-8)throw new TypeError('rendering.sunDirection must be nonzero');}for(const key of ['sunColor','skyColor'])if(r[key]!==undefined)vector(r[key],3,`rendering.${key}`,0);for(const key of ['sunIntensity','fogDensity','exposure'])optionalNumber(r,key,'rendering',0);optionalNumber(r,'shadowExtent','rendering',.1,10000);}
  return structuredClone(value) as SceneSpec;
}

function object(value:unknown,path:string):Record<string,unknown>{if(!value||typeof value!=='object'||Array.isArray(value))throw new TypeError(`${path} must be an object`);return value as Record<string,unknown>;}
function number(value:unknown,path:string,min=-Infinity,max=Infinity):void{if(typeof value!=='number'||!Number.isFinite(value)||value<min||value>max)throw new TypeError(`${path} must be finite within ${min}..${max}`);}
function optionalNumber(obj:Record<string,unknown>,key:string,path:string,min=-Infinity,max=Infinity):void{if(obj[key]!==undefined)number(obj[key],`${path}.${key}`,min,max);}
function vector(value:unknown,length:number,path:string,min=-Infinity,max=Infinity):void{if(!Array.isArray(value)||value.length!==length)throw new TypeError(`${path} must have ${length} components`);value.forEach((v,i)=>number(v,`${path}[${i}]`,min,max));}
function choice(value:unknown,values:readonly unknown[],path:string):void{if(value!==undefined&&!values.includes(value))throw new TypeError(`${path} is unknown`);}
export function validateEntity(value:unknown):EntitySpec{
  const e=object(value,'entity'),id=e.id;
  if(typeof id!=='string'||!id||id.length>180)throw new TypeError('entity requires a stable id');
  for(const key of ['position','rotation','scale'])if(e[key]!==undefined)vector(e[key],3,`${id}.${key}`,key==='scale'?Number.MIN_VALUE:-Infinity);
  if(e.mesh!==undefined){
    const m=object(e.mesh,`${id}.mesh`),path=`${id}.mesh`;
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
  if(e.body!==undefined){const b=object(e.body,`${id}.body`);for(const key of ['mass','friction'])optionalNumber(b,key,`${id}.body`,0);optionalNumber(b,'restitution',`${id}.body`,0,1);choice(b.motion,['dynamic','kinematic'],`${id}.body.motion`);choice(b.shape,['auto','box','sphere'],`${id}.body.shape`);for(const key of ['velocity','angularVelocity'])if(b[key]!==undefined)vector(b[key],3,`${id}.body.${key}`);}
  if(e.material!==undefined){const m=object(e.material,`${id}.material`);if(m.label!==undefined&&(typeof m.label!=='string'||m.label.length>100))throw new TypeError(`${id}.material.label must be at most 100 characters`);optionalNumber(m,'roughness',`${id}.material`,0,1);optionalNumber(m,'metalness',`${id}.material`,0,1);choice(m.pattern,['plain','brick','plaster','rubber','window'],`${id}.material.pattern`);if(m.emissive!==undefined)vector(m.emissive,3,`${id}.material.emissive`,0,50);choice(m.kind,materialKinds(),`${id}.material.kind`);choice(m.finish,['raw','rough','smooth','polished','weathered'],`${id}.material.finish`);choice(m.treatment,['none','sealed','biocide','galvanized','painted'],`${id}.material.treatment`);optionalNumber(m,'ageYears',`${id}.material`,0);if(m.color!==undefined)vector(m.color,4,`${id}.material.color`,0,1);}
  if(e.environmental!==undefined){const env=object(e.environmental,`${id}.environmental`);choice(env.surfaceUse,['generic','road','sidewalk','curb'],`${id}.environmental.surfaceUse`);optionalNumber(env,'snowDepthM',`${id}.environmental`,0,5);optionalNumber(env,'iceDepthM',`${id}.environmental`,0,1);}
  if(e.light!==undefined){const l=object(e.light,`${id}.light`);if(l.kind!=='point')throw new TypeError(`${id}.light.kind is unknown`);optionalNumber(l,'intensity',`${id}.light`,0);optionalNumber(l,'range',`${id}.light`,Number.MIN_VALUE);if(l.color!==undefined)vector(l.color,3,`${id}.light.color`,0,1);}
  return structuredClone(value) as EntitySpec;
}
