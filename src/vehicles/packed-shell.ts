import {decodePackedMesh,type PackedMesh} from '../assets/packed-mesh.js';

/** @deprecated Vehicle shells now use the engine-wide PackedMesh codec. */
export type PackedShell=PackedMesh;
/** @deprecated Use decodePackedMesh. */
export const decodePackedShell=decodePackedMesh;
