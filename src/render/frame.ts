import {compose,type Mat4} from '../math.js';
import {primitiveMesh,type MeshData} from '../procedural/mesh.js';
import type {CameraSpec} from '../scene/types.js';
import type {Scene,RuntimeEntity} from '../scene/scene.js';
import type {Primitive} from '../scene/types.js';

export interface RenderObjectIR{
  readonly entity:RuntimeEntity;
  readonly primitive:Primitive;
  readonly mesh:MeshData;
  readonly model:Mat4;
}
export interface RenderFrameIR{
  readonly scene:Scene;
  readonly camera:CameraSpec;
  readonly objects:readonly RenderObjectIR[];
  readonly objectsById:ReadonlyMap<string,RenderObjectIR>;
  readonly lights:readonly RuntimeEntity[];
}
export function renderPrimitive(entity:RuntimeEntity):Primitive|undefined{return entity.renderMesh??entity.mesh;}
export function primitiveBaseScale(primitive:Primitive|undefined):readonly [number,number,number]{
  if(!primitive)return[1,1,1];
  if(primitive.kind==='box'||primitive.kind==='shard'){const s=primitive.size??[1,1,1];return[s[0],s[1],s[2]];}
  if(primitive.kind==='sphere'){const d=2*(primitive.radius??1);return[d,d,d];}
  if(primitive.kind==='plane')return[primitive.size?.[0]??1,1,primitive.size?.[1]??1];
  return[1,1,1];
}
export function renderModel(entity:RuntimeEntity):Mat4{
  const primitive=renderPrimitive(entity),base=primitiveBaseScale(primitive);
  return compose(entity.position,entity.rotation,[entity.scale[0]*base[0],entity.scale[1]*base[1],entity.scale[2]*base[2]]);
}
export function buildRenderFrame(scene:Scene,camera:CameraSpec=scene.camera):RenderFrameIR{
  const objects:RenderObjectIR[]=[],lights:RuntimeEntity[]=[];
  for(const entity of scene.entities.values()){
    if(entity.light)lights.push(entity);
    const primitive=renderPrimitive(entity);if(!primitive)continue;
    objects.push({entity,primitive,mesh:primitiveMesh(primitive),model:renderModel(entity)});
  }
  return{scene,camera,objects,objectsById:new Map(objects.map(object=>[object.entity.id,object] as const)),lights};
}
