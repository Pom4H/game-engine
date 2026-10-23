import type {Scene} from '../../../src/scene/scene.js';
import type {CanonicalFrame} from './canonical-types.js';
import type {Vec3} from '../shared.js';
import type {CanonicalUrbanContext} from './canonical-urban.js';

export type CanonicalSceneryContext=CanonicalUrbanContext & {officeBuilding:string;mode?:'office'|'game'};
/** Absolute authoritative coordinates; the renderer alone applies Office placement. */
export type CanonicalInteriorView={eye:Vec3;target:Vec3;observer:{x:number;y:number;z:number};blocked?:(from:Vec3,to:Vec3)=>boolean};
export type CanonicalInteriorStats={available:boolean;buildings:number;levels:number;instances:number;lifts:number;liftInstances:number;cachedBuildings:number;geometryBuilds:number;selection:{id:string;levels:number[];litLevel:number}[]};
export type CanonicalOfficeStats={available:boolean;visible:boolean;entities:number;floors:number[];geometryBuilds:number};
export interface CanonicalSceneryAssets{
 update(frame:CanonicalFrame,context:CanonicalSceneryContext):void;
 updateInteriors?(frame:CanonicalFrame,context:CanonicalSceneryContext,view:CanonicalInteriorView):void;
 inspect():{source:'thegame';buildings:number;props:number;trees:number;airportBoxes:number;meshes:number;geometryBuilds:number;sourceBuilds?:number;sourceBuildings?:number;cachedBuildings?:number;outerCells?:number;outerBuildings?:number;outerCachedBuildings?:number;interiors?:CanonicalInteriorStats;nativeOffice?:CanonicalOfficeStats};
 dispose():void;
}
export type CanonicalSceneryFactory=(scene:Scene)=>CanonicalSceneryAssets;
