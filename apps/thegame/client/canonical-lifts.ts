import type {CanonicalFrame,CanonicalLift} from './canonical-types.js';
/** Source Game interaction view, using the same presented pose as graphics. */
export type CanonicalLiftInteraction={buildingId:string;floorCount:number;floor:number;inside:boolean;available:boolean;state:CanonicalLift};
export interface CanonicalLiftView{
 present(frame:CanonicalFrame,point:{x:number;y:number;z:number}):CanonicalLiftInteraction|null;
 inspect():{cachedPlans:number;sourceBuilds:number};
 dispose():void;
}
export type CanonicalLiftFactory=()=>CanonicalLiftView;
