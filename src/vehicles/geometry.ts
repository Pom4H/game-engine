import type {Primitive} from '../scene/types.js';

/** Compiler-owned flat numeric arrays: freeze ownership, not a renderer cache key.
 * A Scene computes keys for its own copies; serializing them here is wasted work. */
export function freezeVehicleMesh(mesh:Extract<Primitive,{kind:'triangle-mesh'}>):void {
  Object.freeze(mesh.positions);
  Object.freeze(mesh.normals);
  Object.freeze(mesh.indices);
  if (mesh.colors) Object.freeze(mesh.colors);
  Object.freeze(mesh);
}
