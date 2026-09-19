import {materialKinds} from '../materials/catalog.js';
import {finiteVec3} from '../math.js';
import type {SceneSpec} from './types.js';

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
        if(frame.sunlight!==undefined&&(typeof frame.sunlight!=='number'||frame.sunlight<0||frame.sunlight>1))throw new TypeError(`environment.weather[${index}].sunlight must be within 0..1`);
        if(frame.humidity!==undefined&&(typeof frame.humidity!=='number'||frame.humidity<0||frame.humidity>1))throw new TypeError(`environment.weather[${index}].humidity must be within 0..1`);
        if(frame.snowfall!==undefined&&!['none','light','moderate','heavy'].includes(String(frame.snowfall)))throw new TypeError(`environment.weather[${index}].snowfall is unknown`);
        if(frame.wind!==undefined){if(!Array.isArray(frame.wind))throw new TypeError(`environment.weather[${index}].wind must be a vec3`);finiteVec3(frame.wind as number[],`environment.weather[${index}].wind`);}
      }
    }
  }
  if(scene.camera!==undefined){const camera=scene.camera as Record<string,unknown>;if(!Array.isArray(camera.position)||!Array.isArray(camera.target))throw new TypeError('camera position/target must be vec3');finiteVec3(camera.position as number[],'camera.position');finiteVec3(camera.target as number[],'camera.target');}
  return structuredClone(value) as SceneSpec;
}
