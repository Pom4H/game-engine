/** Vehicle-domain entry point: no renderer, scene runtime or packed FBX imports. */
export {VehicleCompiler,compileVehicle,type VehicleDefinition,type VehicleFamily,type VehicleReferenceProvenance,type ThreeBoxVehicleDefinition,type CompiledVehicleGeometry} from './framework.js';
export {RoadWheelCompiler,validateRoadWheel,type WheelSide,type CompiledRoadWheel} from './wheels.js';
export {detailedRoadWheelMeshes,type RoadWheelGeometrySpec} from './passenger-wheel.js';
export {M3_DETAILED_BODY_PARAMETERS,type DetailedThreeBoxParameters} from './m3-detailed-procedural.js';
export {PICKUP_CANOPY_VEHICLE_DEFINITION,compileDoubleCabPickupVehicle,type DoubleCabPickupVehicleDefinition} from './pickup.js';
export type {VehicleMesh,VehicleSurfaces,WheelMounts} from './assembly.js';
export type {ParametricVehiclePart,ParametricVehiclePartRole} from './passenger.js';
export {vehiclePart,type VehiclePartPath} from './assembly.js';
