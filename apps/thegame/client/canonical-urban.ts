import type {Scene} from '../../../src/scene/scene.js';
import type {Vec3} from '../shared.js';
import type {CanonicalFrame,CanonicalGeometry} from './canonical-types.js';

/** Original Game street assets, compiled from the authority's static records. */
export type CanonicalUrbanContext={geometry:CanonicalGeometry|null;visible:boolean;origin:Vec3;yaw:number;offsetZ:number;center:readonly[number,number];radius:number};
export interface CanonicalUrbanAssets{
 update(frame:CanonicalFrame,context:CanonicalUrbanContext):void;
 inspect():{source:'thegame';meshes:number;records:number;geometryBuilds:number};
 dispose():void;
}
export type CanonicalUrbanFactory=(scene:Scene)=>CanonicalUrbanAssets;
