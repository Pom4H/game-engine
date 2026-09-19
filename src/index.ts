export {FixedClock} from './core/fixed-clock.js';
export {SpatialHash,SPATIAL_QUERY_CAPACITY,SPATIAL_QUERY_REFERENCES,type SpatialItem} from './core/spatial-hash.js';
export {EngineKernel,ModuleScheduler,ENGINE_PHASES,SIMULATION_TIERS,type EngineModule,type EnginePhase,type ModuleDescription,type ModuleFrame,type SimulationTier} from './core/kernel.js';
export {PhysicsWorld,RigidBody,type CollisionShape,type Contact,type PhysicsStats,type RigidBodyOptions} from './physics/world.js';
export {Scene,type RuntimeEntity} from './scene/scene.js';
export {validateScene} from './scene/validate.js';
export {defineScene} from './scene/define.js';
export {encodeScene,decodeScene,sceneURL,sceneFromURL,type URLSceneOptions} from './scene/url.js';
export type {SceneSpec,SceneSnapshot,EntitySpec,BodySpec,Primitive,MaterialSpec,CameraSpec,RenderingSpec,Color} from './scene/types.js';
export {primitiveMesh,primitiveKey,type MeshData} from './procedural/mesh.js';
export {demoScene} from './demo.js';
export type {Vec3,MutableVec3,Mat4} from './math.js';

export {material,materialKinds,type MaterialKind,type PhysicalMaterial,type AcousticMaterial} from './materials/catalog.js';
export type {EngineEvent,ImpactEvent,FractureEvent} from './scene/events.js';
export {renderAudio,synthesizeEvent,wavBytes,type AudioChannels} from './audio/synth.js';

export {fracturePlate,type PlateFractureInput,type PlateFracturePattern,type PlateFragment,type Vec2} from './materials/glass-fracture.js';

export {resolveEnvironment,resolveEnvironmentAt,environmentTimeScale,type EnvironmentSpec,type EnvironmentState,type EnvironmentClockSpec,type WeatherKeyframe,type Precipitation,type Snowfall} from './environment/types.js';
export {deriveSurfaceState,effectiveFriction,type MaterialFinish,type MaterialTreatment,type MaterialSurfaceSpec,type SurfaceState} from './materials/surface.js';
export {WinterSystem,type WinterSurfaceState,type WinterBodyState} from './environment/winter.js';

export type {SceneModule,SceneModuleContext,SceneCommand} from './scene/modules.js';
export {renderAmbience,type AmbienceFrame,type AmbienceOptions} from './audio/ambience.js';
