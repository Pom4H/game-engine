export {FixedClock} from './core/fixed-clock.js';
export {SpatialHash,SPATIAL_MAX_ITEM_CELLS,SPATIAL_QUERY_CAPACITY,SPATIAL_QUERY_REFERENCES,type SpatialItem} from './core/spatial-hash.js';
export {EngineKernel,KernelProgram,ModuleScheduler,ENGINE_PHASES,ENGINE_DEPTH,ENGINE_DEPTH_AXES,SIMULATION_TIERS,simulationDepth,simulationProfile,simulationProfileKey,simulationTierDepth,simulationTierForDepth,validateEngineDepth,type EngineModule,type EnginePlugin,type EnginePhase,type ModuleDescription,type ModuleDepthRequirement,type ModuleFrame,type EngineDepth,type SimulationProfile,type SimulationProfileInput,type SimulationProfileSpec,type SimulationTier} from './core/kernel.js';
export {DepthVariantRegistry,compileDepthVariants,type DepthRange,type DepthVariant,type DepthVariantPlugin,type CompiledDepthVariant,type CompiledDepthVariants} from './core/variants.js';
export {ENGINE_DOMAINS,ENGINE_SLOTS,type EngineDomain,type EngineSlot} from './core/domains.js';
export {PhysicsWorld,RigidBody,applyInvInertiaWorld,type PhysicsForceDriver,type CollisionShape,type Contact,type PhysicsStats,type RigidBodyOptions} from './physics/world.js';
export {CollisionSolverFamily,type CollisionSolverProgram,type CollisionSolverPlugin} from './physics/depth.js';
export {PhysicsCauseTrace,physicsCause,PHYSICS_CAUSE_TRACE_SCHEMA,PHYSICS_CAUSE_TRACE_VERSION,type PhysicsCauseRef,type PhysicsCauseWriter,type PhysicsCauseManifestWriter,type PhysicsTraceRecord,type PhysicsSourceKind,type PhysicsComponentKind,type PhysicsLawKind,type PhysicsEffectKind} from './physics/cause-trace.js';
export {ForceFrame} from './physics/force-frame.js';
export {physicsAccounting,rigidBodyMechanicalEnergyJ,type PhysicsAccountingState} from './physics/accounting.js';
export {ThermalMass,validateThermalSpec,type ThermalSpec} from './physics/thermal.js';
export {solveWheelContact,type WheelContactResult} from './physics/wheel-contact.js';
export {bodyWheelSupport,groundSupport,wheelHit,rayTriangles,type WheelSupport,type WheelHit} from './physics/wheel-support.js';
export {FluidField,validateFluidVolume,type FluidVolumeSpec,type FluidSample} from './physics/fluid.js';
export {WindField,validateWindVolume,type WindVolumeSpec,type AirSample} from './physics/wind.js';
export {SoilField,soilWheelSupport,validateSoilVolume,type SoilVolumeSpec,type SoilSample,type SoilContactInput,type SoilContactResult} from './physics/soil.js';
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
export type {SceneSpec,SceneSnapshot,EntitySpec,BodySpec,SceneAnimationSpec,SceneSurfaceContactsSpec,SceneVehicleAssemblySpec,Primitive,MaterialSpec,CameraSpec,CameraRailSpec,LightSpec,LightEmissionSpec,RenderingSpec,ReflectionProbeSpec,Color} from './scene/types.js';
export {primitiveMesh,primitiveKey,surfaceGridPrimitive,type MeshData} from './procedural/mesh.js';
export {clothLoftMesh,type ClothRing,type ClothLoftOptions} from './procedural/cloth.js';
export type {Vec3,MutableVec3,Mat4} from './math.js';

export {material,materialKinds,thermalLinearScale,type MaterialKind,type PhysicalMaterial,type MechanicalMaterial,type ThermalMaterial,type OpticalMaterial,type AcousticMaterial,type SurfaceMaterialProperties} from './materials/catalog.js';
export type {EngineEvent,ImpactEvent,FractureEvent,MechanismEvent} from './scene/events.js';
export {renderAudio,synthesizeEvent,wavBytes,type AudioChannels} from './audio/synth.js';
export {AudioSynthFamily,type EventSynthesizer,type AudioSynthPlugin} from './audio/depth.js';
export {renderSceneAudio,type SceneAudioOptions,type SceneAudioRender} from './audio/offline.js';

export {fracturePlate,type PlateFractureInput,type PlateFracturePattern,type PlateFragment,type Vec2} from './materials/glass-fracture.js';

export {resolveEnvironment,resolveEnvironmentAt,environmentTimeScale,environmentHistorySteps,type EnvironmentSpec,type EnvironmentState,type EnvironmentClockSpec,type WeatherKeyframe,type EnvironmentHistoryKeyframe,type EnvironmentHistoryStep,type Precipitation,type Snowfall} from './environment/types.js';
export {deriveSurfaceState,effectiveFriction,type MaterialFinish,type MaterialTreatment,type MaterialSurfaceSpec,type SurfaceState} from './materials/surface.js';
export {SurfaceEnvironmentSystem,type SurfaceEnvironmentState,type BodyEnvironmentState,type SurfaceEnvironmentField,type SurfaceContactWork,type SnowpackState,type SnowLayerState,type SnowDiagnosticClass} from './environment/surface-state.js';
export {DeformableSurfaceField,surfaceFieldResolution,type DeformableSurfaceCell,type DeformableSurfaceStamp} from './environment/deformable-surface.js';

export type {SceneModule,ScenePlugin,SceneModuleContext,SceneCommand} from './scene/modules.js';
export {SceneSystemRuntime,type SystemFrame,type SystemHandler} from './scene/system-runtime.js';
export {renderAmbience,type AmbienceFrame,type AmbienceOptions} from './audio/ambience.js';
export {batchStaticScenery} from './procedural/static-batch.js';
export {SnowFootprints,type FootContact,type SnowFootprint} from './environment/footprints.js';

export {renderFootsteps,type FootstepSound} from './audio/footsteps.js';

export {AnimationSystem,sampleWalker,bindHumanoid,solveTwoBone} from './animation/locomotion.js';
export type {WalkerSpec,HumanoidJoint,HumanoidBinding,HumanoidPose,RigTransform,VehiclePart,VehicleMotionSpec,GroundSampler} from './animation/locomotion.js';
export {SurfaceContactSystem,surfaceContains,surfaceElevation} from './environment/surface-contacts.js';
export type {SurfaceSample,SurfaceFootprint,WheelSurfaceContact,SnowContactSurfaceOptions} from './environment/surface-contacts.js';
export {SnowSurface,snowRelief} from './environment/snow-surface.js';
export {WalkWorld,walkerInput,type WalkBox} from './runtime/walker-motion.js';
export {WalkerControls,type WalkerControlOptions} from './runtime/walker-controls.js';

export type {SurfaceTextureSpec} from './scene/types.js';

export {CpuRenderer,encodePng} from './render/cpu.js';
export {buildRenderFrame,buildProxyRenderFrame,renderPrimitive,renderProxyPrimitive,primitiveBaseScale,renderModel,type RenderFrameIR,type RenderObjectIR} from './render/frame.js';
export {RenderFrameFamily,type RenderFrameBuilder,type RenderFramePlugin} from './render/depth.js';
export type {Renderer,RenderStats,LinearPixelSample,LinearPixelStage,EngineBridge} from './render/types.js';

export {RenderProfiler,RENDER_CPU_QUANTA,RENDER_GPU_QUANTA,type RenderCpuQuantum,type RenderGpuQuantum,type RenderWork,type QuantumStats,type RenderFrameTiming,type RenderProfileSnapshot} from './render/profiler.js';

export {analyzeWGSL,buildRenderAtomReport,type ShaderOperationAtoms,type ShaderEntryAtoms,type ShaderProgramAtoms,type RenderCommandAtoms,type RenderGeometryAtoms,type RenderMemoryAtoms,type RenderAtomReport} from './render/atoms.js';

export {detailedRoadWheelMeshes,detailedPassengerWheelMeshes,type RoadWheelGeometrySpec} from './vehicles/passenger-wheel.js';
export {compileVehicle,type VehicleDefinition,type VehicleFamily,type VehicleReferenceProvenance,type ThreeBoxVehicleDefinition,type CompiledVehicleGeometry} from './vehicles/framework.js';
export {PICKUP_CANOPY_VEHICLE_DEFINITION,compileDoubleCabPickupVehicle,type DoubleCabPickupVehicleDefinition} from './vehicles/pickup.js';

export {Drivetrain,torqueAtRpm,validateDrivetrainSpec,type DrivetrainSpec,type DrivetrainInput,type DrivetrainState,type CombustionEngineSpec,type ClutchSpec,type GearboxSpec,type DifferentialSpec,type TorqueCurvePoint} from './vehicles/drivetrain.js';
export {Vehicle,vehicle,wheel,wing,rotor,PartCondition,type VehicleControls,type VehicleAir,type VehiclePose,type PartSample,type VehicleBlueprint,type VehicleSpec,type WheelSpec,type WingSpec,type RotorSpec,type ConditionSpec} from './vehicles/vehicle.js';
export {lightHelicopter,LIGHT_HELICOPTER_HOVER_COLLECTIVE,LIGHT_HELICOPTER_HOVER_ROLL,LIGHT_HELICOPTER_MAIN_RPM,LIGHT_HELICOPTER_TAIL_RPM} from './vehicles/helicopter.js';



export {worldTileKey,worldTileSize,worldTileBounds,worldTileAt,worldTileChildren,distanceToWorldTile,type WorldTileId,type WorldTileBounds,type WorldTileDemand} from './world/tiles.js';
export {VisibilityInterest,DEFAULT_VISIBILITY_INTEREST,geometricHorizonDistance,type VisibilityObserver,type VisibilityInterestConfig,type VisibilityPlan} from './world/visibility.js';
export {InfiniteWorld,type InfiniteWorldTileState,type InfiniteWorldHooks,type InfiniteWorldOptions,type InfiniteWorldStats} from './world/infinite-world.js';

export {WorldGeneratorFamily,type WorldGenerator,type WorldGeneratorVariant,type WorldGeneratorPlugin} from './world/depth.js';

export {Projection,Publication,LatestStateOutbox,projection,scalar,vector3,type Field,type Fields,type Values,type Stamp,type Row,type Frame} from './network/projection.js';
export {ProjectionFamily,type ProjectionVariant,type ProjectionFamilyPlugin} from './network/depth.js';
export {PlaybackClock,Replica,type Sample,type SampleRow} from './network/playback.js';
export {AuthoritySession,type AuthorityAdapter,type DebugAction,type DebugRequest} from './network/authority.js';

export {CausalAuthority,type AuthorityClock,type AuthorityScope,type AuthorityGrant,type AuthorityProposal,type AuthorityCommitContext,type AuthorityCommitAdapter,type AuthorityCommitDecision,type AuthorityRecord,type AuthorityCommitResult,type CausalAuthorityStats} from './network/causal-authority.js';

export {canonicalContent,contentHash,MemoryContentStore as SharedContentStore,type ContentHash as SharedContentHash,type ContentRef as SharedContentRef,type ResourceManifest as SharedResourceManifest,type ContentAddressedRepository as SharedContentAddressedRepository} from './content/index.js';
export {CausalStorage,MemoryScopeHeadStore,type CausalStorageKind,type CausalRef,type CausalMutation,type CausalCheckpoint,type CausalScopeHead,type ScopeHeadStore,type CausalAppendInput,type CausalAppendResult,type CausalCheckpointResult,type RestoredMutation,type CausalRestore,type CausalHydrationProof} from './storage/index.js';
