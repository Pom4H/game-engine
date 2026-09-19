import type {Color} from '../scene/types.js';

export type MaterialKind='default'|'glass'|'steel'|'wood'|'concrete'|'asphalt'|'snow';

export interface MechanicalMaterial {
  /** Young's modulus, used by deformation/reduced-order structural solvers. */
  readonly youngModulusPa:number;
  /** Onset of permanent deformation. */
  readonly yieldStressPa:number;
  /** Tensile failure stress used by fracture. */
  readonly failureStressPa:number;
  /** Approximate elastic strain at failure. */
  readonly failureStrain:number;
  /** 0 = almost perfectly elastic/brittle, 1 = strongly plastic before failure. */
  readonly plasticity:number;
  readonly brittle:boolean;
}

export interface ThermalMaterial {
  /** Specific heat capacity. */
  readonly specificHeatJkgK:number;
  /** Bulk thermal conductivity. */
  readonly conductivityWmK:number;
  /** Fraction of incident short-wave energy absorbed by the surface. */
  readonly solarAbsorptivity:number;
  readonly emissivity:number;
}

export interface OpticalMaterial {
  readonly ior:number;
  readonly roughness:number;
  readonly metalness:number;
  readonly transmission:number;
}

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
  /** Relative permeability for water transport / drying. */
  readonly permeability:number;
}

export interface PhysicalMaterial {
  readonly kind:MaterialKind;
  readonly density:number;
  readonly restitution:number;
  readonly friction:number;
  readonly color:Color;
  readonly mechanical:MechanicalMaterial;
  readonly thermal:ThermalMaterial;
  readonly optical:OpticalMaterial;
  readonly acoustic:AcousticMaterial;
  readonly surface:SurfaceMaterialProperties;
}

const m=(value:PhysicalMaterial):PhysicalMaterial=>Object.freeze({
  ...value,
  mechanical:Object.freeze(value.mechanical),
  thermal:Object.freeze(value.thermal),
  optical:Object.freeze(value.optical),
  acoustic:Object.freeze(value.acoustic),
  surface:Object.freeze(value.surface),
});

const MATERIALS:Readonly<Record<MaterialKind,PhysicalMaterial>>=Object.freeze({
  default:m({
    kind:'default',density:1000,restitution:.15,friction:.6,color:[.72,.76,.82,1],
    mechanical:{youngModulusPa:2e9,yieldStressPa:30e6,failureStressPa:Number.POSITIVE_INFINITY,failureStrain:0,plasticity:.35,brittle:false},
    thermal:{specificHeatJkgK:1000,conductivityWmK:.35,solarAbsorptivity:.58,emissivity:.9},
    optical:{ior:1.5,roughness:.55,metalness:0,transmission:0},
    acoustic:{resonanceHz:650,damping:.35,brightness:.35,noise:.15},
    surface:{baseRoughness:.55,waterRetention:.35,bioAffinity:.08,dirtAffinity:.45,weathering:.45,permeability:.35},
  }),
  glass:m({
    kind:'glass',density:2500,restitution:.07,friction:.32,color:[.58,.82,.94,.28],
    mechanical:{youngModulusPa:70e9,yieldStressPa:45e6,failureStressPa:45e6,failureStrain:.0006,plasticity:0,brittle:true},
    thermal:{specificHeatJkgK:840,conductivityWmK:1.0,solarAbsorptivity:.12,emissivity:.84},
    optical:{ior:1.52,roughness:.08,metalness:0,transmission:.92},
    acoustic:{resonanceHz:2850,damping:.08,brightness:.95,noise:.48},
    surface:{baseRoughness:.08,waterRetention:.04,bioAffinity:.01,dirtAffinity:.22,weathering:.1,permeability:.01},
  }),
  steel:m({
    kind:'steel',density:7850,restitution:.32,friction:.42,color:[.55,.58,.62,1],
    mechanical:{youngModulusPa:200e9,yieldStressPa:350e6,failureStressPa:520e6,failureStrain:.12,plasticity:.78,brittle:false},
    thermal:{specificHeatJkgK:490,conductivityWmK:45,solarAbsorptivity:.45,emissivity:.35},
    optical:{ior:2.5,roughness:.28,metalness:.92,transmission:0},
    acoustic:{resonanceHz:920,damping:.12,brightness:.72,noise:.12},
    surface:{baseRoughness:.28,waterRetention:.08,bioAffinity:.02,dirtAffinity:.3,weathering:.58,permeability:.01},
  }),
  wood:m({
    kind:'wood',density:650,restitution:.18,friction:.55,color:[.48,.3,.16,1],
    mechanical:{youngModulusPa:11e9,yieldStressPa:35e6,failureStressPa:45e6,failureStrain:.006,plasticity:.18,brittle:false},
    thermal:{specificHeatJkgK:1700,conductivityWmK:.14,solarAbsorptivity:.68,emissivity:.9},
    optical:{ior:1.47,roughness:.72,metalness:0,transmission:0},
    acoustic:{resonanceHz:430,damping:.42,brightness:.22,noise:.34},
    surface:{baseRoughness:.72,waterRetention:.78,bioAffinity:.7,dirtAffinity:.62,weathering:.78,permeability:.68},
  }),
  concrete:m({
    kind:'concrete',density:2350,restitution:.04,friction:.75,color:[.48,.49,.5,1],
    mechanical:{youngModulusPa:30e9,yieldStressPa:4e6,failureStressPa:4e6,failureStrain:.00015,plasticity:.02,brittle:true},
    thermal:{specificHeatJkgK:880,conductivityWmK:1.7,solarAbsorptivity:.58,emissivity:.92},
    optical:{ior:1.5,roughness:.78,metalness:0,transmission:0},
    acoustic:{resonanceHz:310,damping:.55,brightness:.18,noise:.72},
    surface:{baseRoughness:.78,waterRetention:.86,bioAffinity:.82,dirtAffinity:.72,weathering:.68,permeability:.52},
  }),
  asphalt:m({
    kind:'asphalt',density:2400,restitution:.03,friction:.86,color:[.09,.095,.105,1],
    mechanical:{youngModulusPa:5e9,yieldStressPa:3e6,failureStressPa:3.5e6,failureStrain:.0004,plasticity:.42,brittle:false},
    thermal:{specificHeatJkgK:920,conductivityWmK:.75,solarAbsorptivity:.92,emissivity:.95},
    optical:{ior:1.56,roughness:.92,metalness:0,transmission:0},
    acoustic:{resonanceHz:190,damping:.72,brightness:.08,noise:.88},
    surface:{baseRoughness:.92,waterRetention:.56,bioAffinity:.08,dirtAffinity:.82,weathering:.72,permeability:.22},
  }),
  snow:m({
    kind:'snow',density:180,restitution:.01,friction:.48,color:[.91,.945,.98,1],
    mechanical:{youngModulusPa:2e6,yieldStressPa:8e3,failureStressPa:8e3,failureStrain:.08,plasticity:.88,brittle:false},
    thermal:{specificHeatJkgK:2100,conductivityWmK:.12,solarAbsorptivity:.18,emissivity:.98},
    optical:{ior:1.31,roughness:.96,metalness:0,transmission:.18},
    acoustic:{resonanceHz:110,damping:.92,brightness:.03,noise:.52},
    surface:{baseRoughness:.96,waterRetention:.98,bioAffinity:0,dirtAffinity:.5,weathering:1,permeability:.82},
  }),
});

export function material(kind:MaterialKind='default'):PhysicalMaterial{return MATERIALS[kind];}
export function materialKinds():readonly MaterialKind[]{return Object.keys(MATERIALS) as MaterialKind[];}
