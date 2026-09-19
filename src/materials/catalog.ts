import type {Color} from '../scene/types.js';

export type MaterialKind='default'|'glass'|'steel'|'wood'|'concrete'|'asphalt';

export interface AcousticMaterial {
  /** Dominant free resonance of a small reference object. Geometry scales it. */
  readonly resonanceHz:number;
  readonly damping:number;
  readonly brightness:number;
  readonly noise:number;
}

export interface SurfaceMaterialProperties {
  readonly baseRoughness:number;
  readonly waterRetention:number;
  readonly bioAffinity:number;
  readonly dirtAffinity:number;
  readonly weathering:number;
}

export interface PhysicalMaterial {
  readonly kind:MaterialKind;
  readonly density:number;
  readonly restitution:number;
  readonly friction:number;
  /** Tensile failure stress used by the generic brittle fracture model. */
  readonly failureStressPa:number;
  /** Approximate elastic strain at failure. Together with stress this defines stored fracture energy density. */
  readonly failureStrain:number;
  readonly brittle:boolean;
  readonly color:Color;
  readonly acoustic:AcousticMaterial;
  readonly surface:SurfaceMaterialProperties;
}

const MATERIALS:Readonly<Record<MaterialKind,PhysicalMaterial>>=Object.freeze({
  default:Object.freeze({kind:'default',density:1000,restitution:.15,friction:.6,failureStressPa:Number.POSITIVE_INFINITY,failureStrain:0,brittle:false,color:[.72,.76,.82,1] as const,acoustic:{resonanceHz:650,damping:.35,brightness:.35,noise:.15},surface:{baseRoughness:.55,waterRetention:.35,bioAffinity:.08,dirtAffinity:.45,weathering:.45}}),
  glass:Object.freeze({kind:'glass',density:2500,restitution:.07,friction:.32,failureStressPa:45e6,failureStrain:.0006,brittle:true,color:[.58,.82,.94,.28] as const,acoustic:{resonanceHz:2850,damping:.08,brightness:.95,noise:.48},surface:{baseRoughness:.08,waterRetention:.04,bioAffinity:.01,dirtAffinity:.22,weathering:.1}}),
  steel:Object.freeze({kind:'steel',density:7850,restitution:.32,friction:.42,failureStressPa:350e6,failureStrain:.012,brittle:false,color:[.55,.58,.62,1] as const,acoustic:{resonanceHz:920,damping:.12,brightness:.72,noise:.12},surface:{baseRoughness:.28,waterRetention:.08,bioAffinity:.02,dirtAffinity:.3,weathering:.58}}),
  wood:Object.freeze({kind:'wood',density:650,restitution:.18,friction:.55,failureStressPa:45e6,failureStrain:.006,brittle:false,color:[.48,.3,.16,1] as const,acoustic:{resonanceHz:430,damping:.42,brightness:.22,noise:.34},surface:{baseRoughness:.72,waterRetention:.78,bioAffinity:.7,dirtAffinity:.62,weathering:.78}}),
  concrete:Object.freeze({kind:'concrete',density:2350,restitution:.04,friction:.75,failureStressPa:4e6,failureStrain:.00015,brittle:true,color:[.48,.49,.5,1] as const,acoustic:{resonanceHz:310,damping:.55,brightness:.18,noise:.72},surface:{baseRoughness:.78,waterRetention:.86,bioAffinity:.82,dirtAffinity:.72,weathering:.68}}),
  asphalt:Object.freeze({kind:'asphalt',density:2400,restitution:.03,friction:.86,failureStressPa:3.5e6,failureStrain:.0004,brittle:false,color:[.09,.095,.105,1] as const,acoustic:{resonanceHz:190,damping:.72,brightness:.08,noise:.88},surface:{baseRoughness:.92,waterRetention:.56,bioAffinity:.08,dirtAffinity:.82,weathering:.72}}),
});

export function material(kind:MaterialKind='default'):PhysicalMaterial{return MATERIALS[kind];}
export function materialKinds():readonly MaterialKind[]{return Object.keys(MATERIALS) as MaterialKind[];}
