export {FixedClock} from './core/fixed-clock.js';
export {SpatialHash,SPATIAL_QUERY_CAPACITY,SPATIAL_QUERY_REFERENCES,type SpatialItem} from './core/spatial-hash.js';
export {EngineKernel,ModuleScheduler,ENGINE_PHASES,SIMULATION_TIERS,type EngineModule,type EnginePhase,type ModuleDescription,type ModuleFrame,type SimulationTier} from './core/kernel.js';
export {PhysicsWorld,RigidBody,type CollisionShape,type Contact,type PhysicsStats,type RigidBodyOptions} from './physics/world.js';
export {PlasticDeformationSystem,type DeformableBodySpec,type SceneDeformationSpec,type PlasticDent} from './physics/deformation.js';
export {StructuralBody,type StructuralDefinition,type StructuralNodeSpec,type StructuralConstraintSpec,type StructuralDistanceSpec,type StructuralVolumeSpec,type StructuralStats,type BakedStructuralState} from './physics/structure.js';
export {Scene,type RuntimeEntity} from './scene/scene.js';
export {validateScene} from './scene/validate.js';
export {defineScene} from './scene/define.js';
export {encodeScene,decodeScene,sceneURL,sceneFromURL,type URLSceneOptions} from './scene/url.js';
export type {SceneSpec,SceneSnapshot,EntitySpec,BodySpec,SceneAnimationSpec,SceneSurfaceContactsSpec,Primitive,MaterialSpec,CameraSpec,RenderingSpec,Color} from './scene/types.js';
export {primitiveMesh,primitiveKey,type MeshData} from './procedural/mesh.js';
export {clothLoftMesh,type ClothRing,type ClothLoftOptions} from './procedural/cloth.js';
export {demoScene} from './demo.js';
export type {Vec3,MutableVec3,Mat4} from './math.js';

export {material,materialKinds,type MaterialKind,type PhysicalMaterial,type MechanicalMaterial,type ThermalMaterial,type OpticalMaterial,type AcousticMaterial,type SurfaceMaterialProperties} from './materials/catalog.js';
export type {EngineEvent,ImpactEvent,FractureEvent} from './scene/events.js';
export {renderAudio,synthesizeEvent,wavBytes,type AudioChannels} from './audio/synth.js';
export {renderSceneAudio,type SceneAudioOptions,type SceneAudioRender} from './audio/offline.js';

export {fracturePlate,type PlateFractureInput,type PlateFracturePattern,type PlateFragment,type Vec2} from './materials/glass-fracture.js';

export {resolveEnvironment,resolveEnvironmentAt,environmentTimeScale,type EnvironmentSpec,type EnvironmentState,type EnvironmentClockSpec,type WeatherKeyframe,type Precipitation,type Snowfall} from './environment/types.js';
export {deriveSurfaceState,effectiveFriction,type MaterialFinish,type MaterialTreatment,type MaterialSurfaceSpec,type SurfaceState} from './materials/surface.js';
export {SurfaceEnvironmentSystem,type SurfaceEnvironmentState,type BodyEnvironmentState,type SurfaceEnvironmentField,type SurfaceContactWork} from './environment/surface-state.js';
/** @deprecated Prefer SurfaceEnvironmentSystem and generic surface state types. */
export {WinterSystem,type WinterSurfaceState,type WinterBodyState} from './environment/winter.js';

export type {SceneModule,SceneModuleContext,SceneCommand} from './scene/modules.js';
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

export type {SurfaceTextureSpec} from './scene/types.js';

export {RenderProfiler,RENDER_CPU_QUANTA,RENDER_GPU_QUANTA,type RenderCpuQuantum,type RenderGpuQuantum,type RenderWork,type QuantumStats,type RenderFrameTiming,type RenderProfileSnapshot} from './render/profiler.js';

export {analyzeWGSL,buildRenderAtomReport,type ShaderOperationAtoms,type ShaderEntryAtoms,type ShaderProgramAtoms,type RenderCommandAtoms,type RenderGeometryAtoms,type RenderMemoryAtoms,type RenderAtomReport} from './render/atoms.js';
