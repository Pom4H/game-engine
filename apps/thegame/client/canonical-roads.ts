import type {Scene} from '../../../src/scene/scene.js';
import type {CanonicalFrame} from './canonical-types.js';
import type {CanonicalUrbanContext} from './canonical-urban.js';

export interface CanonicalRoadAssets{
 update(frame:CanonicalFrame,context:CanonicalUrbanContext):void;
 inspect():{source:'thegame';available:boolean;roads:number;piers:number;cells:number;cachedCells:number;meshes:number;networkBuilds:number;geometryBuilds:number};
 dispose():void;
}
export type CanonicalRoadFactory=(scene:Scene)=>CanonicalRoadAssets;
