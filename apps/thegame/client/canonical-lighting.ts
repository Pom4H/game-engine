import type {Vec3} from '../shared.js';
import type {CanonicalFrame} from './canonical-types.js';
/** Source Game appearance for one presented frame. Directions use Office space;
 * colors, irradiance, exposure and lengths retain their original source values. */
export type CanonicalLighting={sunDirection:Vec3;sunColor:Vec3;sunIntensity:number;skyColor:Vec3;ambientIrradiance:Vec3;fogDensity:number;exposure:number;shadowExtent:number};
export type CanonicalLightingSource=(frame:Pick<CanonicalFrame,'environment'>,yaw:number)=>CanonicalLighting;
