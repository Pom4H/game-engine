import type {Scene} from '../../../src/scene/scene.js';
import type {CanonicalFrame} from './canonical-types.js';
import type {CanonicalUrbanContext} from './canonical-urban.js';

export interface CanonicalTerrainAssets{
 update(frame:CanonicalFrame,context:CanonicalUrbanContext):void;
 inspect():{source:'thegame';available:boolean;cells:number;hubCells:number;outerCells:number;cachedCells:number;cachedVertices:number;meshes:number;waterTriangles:number;roadTriangles:number;geometryBuilds:number;sourceBuilds:number;heightMismatches:number;texture:{width:number;height:number;checksum:number}|null};
 dispose():void;
}
export type CanonicalTerrainFactory=(scene:Scene)=>CanonicalTerrainAssets;
