import {
 canonicalContent,contentHash,MemoryContentStore as SharedMemoryContentStore,
 type ContentAddressedRepository as SharedContentAddressedRepository,
} from '../content/index.js';
import type {RenderResourceKind} from './index.js';

export {canonicalContent,contentHash};
export interface ContentAddressedRepository extends SharedContentAddressedRepository<RenderResourceKind>{}
/** Render-specialized view over the engine-wide content-addressed store. */
export class MemoryContentStore extends SharedMemoryContentStore<RenderResourceKind> implements ContentAddressedRepository{}
