export {CpuProfiler,timingStats,type CpuProfilerOptions,type CpuProfileSnapshot,type CpuScopeSnapshot} from './core/profiling.js';
export {FixedClock} from './core/fixed-clock.js';
export {SpatialHash,SPATIAL_MAX_ITEM_CELLS,SPATIAL_QUERY_CAPACITY,SPATIAL_QUERY_REFERENCES,type SpatialItem} from './core/spatial-hash.js';
export {EngineKernel,ModuleScheduler,ENGINE_PHASES,SIMULATION_TIERS,type EngineModule,type EnginePhase,type ModuleDescription,type ModuleFrame,type SimulationTier} from './core/kernel.js';
export {PhysicsWorld,RigidBody,type CollisionShape,type Contact,type PhysicsStats,type RigidBodyOptions} from './physics/world.js';
export {PlasticDeformationSystem,type DeformableBodySpec,type SceneDeformationSpec,type PlasticDent} from './physics/deformation.js';
export {StructuralBody,type StructuralDefinition,type StructuralNodeSpec,type StructuralConstraintSpec,type StructuralDistanceSpec,type StructuralVolumeSpec,type StructuralStats,type BakedStructuralState} from './physics/structure.js';
export {bindStructuralSkin,applyStructuralSkin,type StructuralSkinBinding} from './physics/structural-skin.js';
export {StructuralStaticContactSolver,type StructuralStaticBox,type StructuralContactStats} from './physics/structural-contact.js';
export {AdaptiveStructuralController,type ReducedRigidState,type StructuralActivationPolicy,type StructuralActivation,type AdaptiveStructuralStats} from './physics/adaptive-structure.js';
export {generatePassengerVehicle,generatePassengerWheelParts,passengerPartMaterial,passengerStructuralDefinition,interpolateSection,validatePassengerVehicleProfile,type PassengerVehicleProfile,type PassengerSideSection,type PassengerRoofSection,type ParametricPassengerGeometry,type ParametricVehiclePart,type ParametricVehiclePartRole} from './vehicles/passenger.js';
export {M3_PARAMETRIC_PROFILE,M3_REFERENCE_PROVENANCE,M3_VEHICLE_DEFINITION,generateM3Vehicle,generateM3ProceduralWheelVehicle,m3PartMaterial,m3PartBody,m3StructuralBlueprint,type M3StructuralBlueprint} from './vehicles/m3.js';
export {M3_HIGH_FIDELITY_SHELL,M3_SHELL_FIDELITY,m3HighFidelityBody} from './vehicles/m3-shell.js';
export {M3_DETAILED_BODY_PARAMETERS,generateDetailedThreeBoxBody,generateDetailedThreeBoxGlass,generateM3DetailedProceduralBody,generateM3DetailedProceduralGlass,type DetailedThreeBoxParameters,type M3DetailedBodyParameters} from './vehicles/m3-detailed-procedural.js';
export {M3_FBX_PARTS_FIDELITY,M3_FBX_PART_SOURCES,m3FbxParts,type M3FbxPartSource} from './vehicles/m3-fbx-parts.js';
export {decodePackedShell,type PackedShell} from './vehicles/packed-shell.js';
export {encodePackedMesh,decodePackedMesh,type PackedMesh} from './assets/packed-mesh.js';
export {ElasticPlasticPanelResponse,FourCornerSuspension,DoorHinge,M3InteractionRig,type PanelImpactInput,type PanelImpactResult,type SuspensionPose,type VehicleInteractionImpact,type VehicleInteractionState} from './vehicles/interaction-physics.js';
export {Scene,type RuntimeEntity} from './scene/scene.js';
export {validateScene} from './scene/validate.js';
export {defineScene} from './scene/define.js';
export {encodeScene,decodeScene,sceneURL,sceneFromURL,type URLSceneOptions} from './scene/url.js';
export type {SceneSpec,SceneSnapshot,EntitySpec,BodySpec,SceneAnimationSpec,SceneSurfaceContactsSpec,Primitive,MaterialSpec,CameraSpec,RenderingSpec,ReflectionProbeSpec,Color} from './scene/types.js';
export {primitiveMesh,primitiveKey,type MeshData} from './procedural/mesh.js';
export {clothLoftMesh,type ClothRing,type ClothLoftOptions} from './procedural/cloth.js';
export type {Vec3,MutableVec3,Mat4} from './math.js';

export {material,materialKinds,thermalLinearScale,type MaterialKind,type PhysicalMaterial,type MechanicalMaterial,type ThermalMaterial,type OpticalMaterial,type AcousticMaterial,type SurfaceMaterialProperties} from './materials/catalog.js';
export type {EngineEvent,ImpactEvent,FractureEvent,MechanismEvent} from './scene/events.js';
export {renderAudio,synthesizeEvent,wavBytes,type AudioChannels} from './audio/synth.js';
export {renderSceneAudio,type SceneAudioOptions,type SceneAudioRender} from './audio/offline.js';

export {fracturePlate,type PlateFractureInput,type PlateFracturePattern,type PlateFragment,type Vec2} from './materials/glass-fracture.js';

export {resolveEnvironment,resolveEnvironmentAt,environmentTimeScale,type EnvironmentSpec,type EnvironmentState,type EnvironmentClockSpec,type WeatherKeyframe,type Precipitation,type Snowfall} from './environment/types.js';
export {deriveSurfaceState,effectiveFriction,type MaterialFinish,type MaterialTreatment,type MaterialSurfaceSpec,type SurfaceState} from './materials/surface.js';
export {SurfaceEnvironmentSystem,type SurfaceEnvironmentState,type BodyEnvironmentState,type SurfaceEnvironmentField,type SurfaceContactWork} from './environment/surface-state.js';

export type {SceneModule,SceneModuleContext,SceneCommand} from './scene/modules.js';
export {SceneSystemRuntime,type SystemFrame,type SystemHandler} from './scene/system-runtime.js';
export {renderAmbience,type AmbienceFrame,type AmbienceOptions} from './audio/ambience.js';
export {batchStaticScenery} from './procedural/static-batch.js';
export {SnowFootprints,type FootContact,type SnowFootprint} from './environment/footprints.js';

export {renderFootsteps,type FootstepSound} from './audio/footsteps.js';

export {sampleWalker,bindHumanoid,solveTwoBone} from './animation/locomotion.js';
export {AnimationSystem,type AnimationTarget} from './animation/system.js';
export type {WalkerSpec,HumanoidJoint,HumanoidBinding,HumanoidPose,RigTransform,VehiclePart,VehicleMotionSpec,GroundSampler} from './animation/locomotion.js';
export {SurfaceContactSystem,surfaceContains,surfaceElevation} from './environment/surface-contacts.js';
export type {SurfaceSample,SurfaceFootprint,WheelSurfaceContact,SnowContactSurfaceOptions} from './environment/surface-contacts.js';
export {SnowSurface,snowRelief} from './environment/snow-surface.js';
export {WalkWorld,walkerInput,type WalkBox} from './runtime/walker-motion.js';
export {WalkerControls,type WalkerControlOptions} from './runtime/walker-controls.js';

export type {SurfaceTextureSpec} from './scene/types.js';

export {CpuRenderer,encodePng} from './render/cpu.js';
export {buildRenderFrame,renderPrimitive,primitiveBaseScale,renderModel,type RenderFrameIR,type RenderObjectIR} from './render/frame.js';
export type {Renderer,RenderStats,LinearPixelSample,LinearPixelStage,EngineBridge,EngineProfileSnapshot} from './render/types.js';

export {RenderProfiler,RENDER_CPU_QUANTA,RENDER_GPU_QUANTA,type RenderCpuQuantum,type RenderGpuQuantum,type RenderWork,type QuantumStats,type RenderFrameTiming,type RenderProfileSnapshot} from './render/profiler.js';

export {analyzeWGSL,buildRenderAtomReport,type ShaderOperationAtoms,type ShaderEntryAtoms,type ShaderProgramAtoms,type RenderCommandAtoms,type RenderGeometryAtoms,type RenderMemoryAtoms,type RenderAtomReport} from './render/atoms.js';

export {detailedRoadWheelMeshes,detailedPassengerWheelMeshes,type RoadWheelGeometrySpec} from './vehicles/passenger-wheel.js';
export {compileVehicle,type VehicleDefinition,type VehicleFamily,type VehicleReferenceProvenance,type ThreeBoxVehicleDefinition,type CompiledVehicleGeometry} from './vehicles/framework.js';
export {PICKUP_CANOPY_VEHICLE_DEFINITION,compileDoubleCabPickupVehicle,type DoubleCabPickupVehicleDefinition} from './vehicles/pickup.js';
export {worldTileKey,worldTileSize,worldTileBounds,worldTileAt,worldTileChildren,distanceToWorldTile,type WorldTileId,type WorldTileBounds,type WorldTileDemand} from './world/tiles.js';
export {VisibilityInterest,DEFAULT_VISIBILITY_INTEREST,geometricHorizonDistance,type VisibilityObserver,type VisibilityInterestConfig,type VisibilityPlan} from './world/visibility.js';
export {InfiniteWorld,type InfiniteWorldTileState,type InfiniteWorldHooks,type InfiniteWorldOptions,type InfiniteWorldStats} from './world/infinite-world.js';
export {TransitAuthority,THEGAME_TRANSIT_ROUTES,transitServiceTime,type TransitMode,type TransitRoute,type TransitStop,type TransitPassenger,type TransitPassengerState,type TransitPassengerPose,type TransitServicePose,type TransitServiceState,type TransitServicePhase} from './games/thegame/transit.js';
export {TransitVehicleAuthority,transitVehicleProjection,type TransitSeatPose} from './games/thegame/transit-vehicle.js';
export {lightHelicopter,LIGHT_HELICOPTER_HOVER_COLLECTIVE,LIGHT_HELICOPTER_HOVER_ROLL,LIGHT_HELICOPTER_MAIN_RPM,LIGHT_HELICOPTER_TAIL_RPM} from './vehicles/helicopter.js';
