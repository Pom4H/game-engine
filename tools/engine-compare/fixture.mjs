import {Scene} from '../../dist/scene/scene.js';
import {buildRenderFrame} from '../../dist/render/frame.js';
import {primitiveKey} from '../../dist/procedural/mesh.js';
import {lookAt, perspective} from '../../dist/math.js';
import {renderModel} from '../../dist/render/frame.js';
import {movingScenario,motionApis} from './parameters.mjs';
import {fixedEnvironmentRadiance} from './environment.mjs';
import {visibilityScene, visibilityCamera as sourceCamera} from '../gpu-visibility/scene.mjs';

// cameraProjection currently uses these clip defaults, rather than near/far
// extension fields on CameraSpec. Peers must use the actual production projection.
export function visibilityCamera(frame, scenario = 'static') {return {...sourceCamera(frame, scenario.startsWith('camera-')?'camera-motion':'static'), near: .05, far: 10000};}
export const versions = {engine: 'workspace', three: '0.186.1', babylon: '9.30.0'};
export const hash = async value => {
  const bytes = ArrayBuffer.isView(value) ? new Uint8Array(value.buffer, value.byteOffset, value.byteLength) : new TextEncoder().encode(JSON.stringify(value));
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), byte => byte.toString(16).padStart(2, '0')).join('');
};

/** Geometry comes from Render IR, including the engine's sphere tessellation.
 * No library-specific box/sphere builders or alternate physics simulations. */
export async function createFixture(count,{environmentMode='scene-derived'}={}) {
  if(!['fixed','scene-derived'].includes(environmentMode))throw new RangeError('Invalid environment mode');
  const base=visibilityScene(count),spec = {...base,rendering:{...base.rendering,...(environmentMode==='fixed'?{environmentRadiance:fixedEnvironmentRadiance()}: {})}, camera: visibilityCamera(0)}, scene = new Scene(spec);
  for (let tick = 0; tick < 60; tick++) scene.step(1 / 60);
  const frame = buildRenderFrame(scene, scene.camera, {includeMeshes: true});
  const groups = new Map();
  for (const object of frame.objects) {
    const material = object.entity.material;
    const optics = {metalness: material.metalness ?? material.profile.optical.metalness, roughness: material.roughness ?? material.surface.roughness};
    const key = primitiveKey(object.primitive) + ':' + JSON.stringify(optics);
    let group = groups.get(key);
    if (!group) {
      const source = object.mesh, vertices = source.vertices.length / 6;
      const positions = new Float32Array(vertices * 3), normals = new Float32Array(vertices * 3);
      for (let n = 0; n < vertices; n++) {positions.set(source.vertices.subarray(n * 6, n * 6 + 3), n * 3);normals.set(source.vertices.subarray(n * 6 + 3, n * 6 + 6), n * 3);}
      group = {key, positions, normals, indices: source.indices.slice(), optics, objects: []};
      groups.set(key, group);
    }
    group.objects.push(object);
  }
  for (const group of groups.values()) {
    group.models = new Float32Array(group.objects.length * 16);
    group.colors = new Float32Array(group.objects.length * 4);
    group.linearColors = new Float32Array(group.objects.length * 4);
    for (let n = 0; n < group.objects.length; n++) {
      group.models.set(group.objects[n].model, n * 16);
      group.colors.set(group.objects[n].entity.material.color, n * 4);
      group.linearColors.set(group.objects[n].entity.material.color.map((value, channel) => channel === 3 ? value : value ** 2.2), n * 4);
    }
  }
  const manifest = [];
  for (const group of groups.values()) manifest.push({ids: group.objects.map(object => object.entity.id), positions: await hash(group.positions), normals: await hash(group.normals), indices: await hash(group.indices), models: await hash(group.models), colors: await hash(group.colors), optics: group.optics});
  return {scene, groups: [...groups.values()], rendering: spec.rendering, lights: frame.lights,
    objectCount: frame.objects.length, sourceHash: await hash(spec), replayHash: await hash(scene.snapshot()), geometryHash: await hash(manifest), manifest,
    view: camera => lookAt(camera.position, camera.target), projection: (camera, aspect) => perspective(camera.fov * Math.PI / 180, aspect, camera.near, camera.far)};
}

/** Authored transform workload, outside rendering physics: a fixed subset of cubes
 * moves by frame index on every backend. Restore before replay checks/captures. */
export function createMotion(fixture,scenario,dirtyFraction,motionApi='direct'){
  if(!motionApis.includes(motionApi)||!Number.isFinite(dirtyFraction)||dirtyFraction<0||dirtyFraction>1)throw new RangeError('Invalid motion controls');
  const candidates=fixture.groups.flatMap(group=>group.objects.map((object,index)=>({group,index,object}))).filter(item=>item.object.entity.id.startsWith('cube:'));
  const count=movingScenario(scenario)?Math.ceil(candidates.length*dirtyFraction):0;
  const selected=candidates.filter((_,index)=>Math.floor((index+1)*count/candidates.length)>Math.floor(index*count/candidates.length)).map(item=>({...item,position:[...item.object.entity.position],model:Float32Array.from(item.object.model)}));
  let lastFrame=-1;
  const pose=[0,0,0];
  function publish(item,position){const entity=item.object.entity;if(motionApi==='visual-transform')fixture.scene.setVisualTransform(entity.id,position,entity.rotation,entity.scale);else for(let n=0;n<3;n++)entity.position[n]=position[n];}
  function update(frame){lastFrame=frame;for(let i=0;i<selected.length;i++){const item=selected[i];pose[0]=item.position[0]+Math.sin(frame*.03+i*.17)*.35;pose[1]=item.position[1]+Math.sin(frame*.021+i*.13)*.2;pose[2]=item.position[2];publish(item,pose);}}
  function syncModels(){for(const item of selected)item.group.models.set(renderModel(item.object.entity),item.index*16);}
  function restore(){for(const item of selected){publish(item,item.position);item.group.models.set(item.model,item.index*16);}}
  function describe(){const movers=fixture.scene.renderMoverIds(),registeredMovingObjects=selected.filter(item=>movers.has(item.object.entity.id)).length;if(registeredMovingObjects!==(motionApi==='visual-transform'?count:0))throw new Error('Motion API mover registration mismatch');return {mode:scenario,motionApi,dirtyFraction,movingObjects:count,registeredMovingObjects,lastFrame,deterministic:true,scope:'Identical authored pose changes plus backend matrix construction/GPU buffer updates are included in CPU render time. The selected mutation API is applied on all backends. Engine constructs its own matrices; peer adapters construct theirs once. Expected matrices are recomputed outside timing for audits. Physics is frozen and restored before replay checks. Visual-transform registration persists after pose restoration, including canonical captures.'};}
  return {selected,update,syncModels,restore,describe};
}

export function halfToFloat(value) {
  const sign = value & 0x8000 ? -1 : 1, exponent = value >> 10 & 31, fraction = value & 1023;
  return sign * (exponent === 0 ? fraction * 2 ** -24 : exponent === 31 ? (fraction ? NaN : Infinity) : (1 + fraction / 1024) * 2 ** (exponent - 15));
}

/** Three's WebGPU CubeTextureNode negates sampled X. Convert the canonical
 * right-handed WebGPU cubemap to that library convention without changing radiance. */
export function threeCubeFaces(environment) {
  const {size, rgba16f} = environment;
  return Array.from({length: 6}, (_, face) => {
    const sourceFace = face < 2 ? 1 - face : face, result = new Uint16Array(size * size * 4);
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      const source = ((sourceFace * size + y) * size + size - 1 - x) * 4;
      result.set(rgba16f.subarray(source, source + 4), (y * size + x) * 4);
    }
    return result;
  });
}
