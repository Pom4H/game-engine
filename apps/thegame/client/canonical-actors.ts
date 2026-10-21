import type {Scene} from '../../../src/scene/scene.js';
import type {Vec3} from '../shared.js';
import type {CanonicalEntity,CanonicalFrame} from './canonical-types.js';

/** The Game's original presentation compiler, loaded from its browser library.
 * The host supplies its actual Engine Scene and canonical display selection. */
export interface CanonicalActors{
 update(frame:CanonicalFrame,entities:CanonicalEntity[],context:{origin:Vec3;yaw:number;offsetZ:number;focus:Vec3;subjectId?:string;groundAt?:(x:number,y:number,z:number)=>number|null}):void;
 isActorMesh(id:string):boolean;
 isOwnedMesh(id:string,owner:string):boolean;
 hasActor(id:string):boolean;
 headPosition?(id:string):Vec3|null;
 setHiddenOwner?(id:string|null):void;
 inspect():{source:'thegame';actors:number;vehicles:number;meshes:number;geometryBuilds:number;hiddenOwner?:string|null;hiddenMeshes?:number};
 dispose():void;
}
export type CanonicalActorsFactory=(scene:Scene)=>CanonicalActors;
