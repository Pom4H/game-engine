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
    if(entity.material!==undefined){if(!entity.material||typeof entity.material!=='object')throw new TypeError(`${entity.id}.material must be an object`);const kind=(entity.material as Record<string,unknown>).kind;if(kind!==undefined&&!materialKinds().includes(kind as any))throw new TypeError(`${entity.id}.material.kind is unknown`);}
  }
  if(scene.gravity!==undefined){if(!Array.isArray(scene.gravity))throw new TypeError('gravity must be a vec3');finiteVec3(scene.gravity as number[],'gravity');}
  if(scene.camera!==undefined){const camera=scene.camera as Record<string,unknown>;if(!Array.isArray(camera.position)||!Array.isArray(camera.target))throw new TypeError('camera position/target must be vec3');finiteVec3(camera.position as number[],'camera.position');finiteVec3(camera.target as number[],'camera.target');}
  return structuredClone(value) as SceneSpec;
}
