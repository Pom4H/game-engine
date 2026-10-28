export {BrowserRuntime,type BrowserRuntimeOptions} from './runtime/browser.js';
export {SpatialAudio} from './audio/spatial.js';
export {WebGPURenderer,type WebGPURendererOptions,type EngineCanvasTarget,type EngineCanvasViewport} from './render/webgpu.js';
export {RenderMeshQuery,avoidCameraObstacles,type RenderMeshHit,type RenderMeshFilter,type CameraObstruction} from './render/mesh-ray.js';
export {ScenePerformanceProfiler,type ScenePerformanceConfig,type ScenePerformanceReport} from './scene/performance.js';
export type {RenderFeatures,RenderPipelinePlan} from './render/pipeline-plan.js';
export type {VisibilityMode} from './render/gpu-visibility.js';
export {sceneFromURL,sceneURL,encodeScene,decodeScene} from './scene/url.js';
export {WalkWorld,walkerInput,type WalkBox} from './runtime/walker-motion.js';
export {WalkerControls,type WalkerControlOptions} from './runtime/walker-controls.js';
export {compileCharacter,characterSpec,DEFAULT_CHARACTER_SPEC,CHARACTER_PRESETS,type CharacterSpec,type CompiledCharacter} from './characters/character.js';
export {sampleCharacterPose,type CharacterPoseName} from './characters/pose.js';
export {humanoidMeasurements,type HumanoidMeasurements,type HumanoidProportions} from './animation/locomotion.js';

export {connectAcousticWebAudio,type AcousticTransferObservation,type AcousticWebAudioGraph} from './audio/acoustic-transfer.js';
export {decodeWorldBinary,isWorldBinary,WORLD_BINARY_VERSION} from './scene/world-binary.js';
export {AcousticWaveField,type AcousticWaveFieldSpec,type AcousticPressurePlane} from './physics/wave-field.js';
export {createWasmAcousticWaveField,uploadAcousticPressurePlane} from './physics/wave-wasm.js';

export {createWasmStructuralBody,type RustStructuralStaticContacts} from './physics/structure-wasm.js';

export {createWasmRigidContactKernel} from './physics/rigid-wasm.js';

export {compileWorldCouplings,signalPortDimension,signalPortIndex,WORLD_SIGNAL_PORTS,WORLD_COUPLING_ABI_VERSION,type WorldSignalPort,type WorldCoupling,type WorldCouplingDimension} from './world-ir/couplings.js';
export {WorldInteractionJournal,eventsFromWorldInteractions,validateWorldInteractionGraph,WORLD_INTERACTION_IR_VERSION,WORLD_INTERACTION_LAWS,type WorldInteractionLaw,type WorldInteractionGraph,type WorldInteraction,type WorldInteractionEffect,type WorldInteractionDomain,type WorldInteractionRef} from './world-ir/index.js';

export {SceneAcousticCoupling,attachSceneAcoustics,type SceneAcousticCouplingOptions,type AcousticListenerSpec,type AcousticSensorObservation,type AcousticCouplingStats} from './scene/acoustic-coupling.js';

export {stepCharacterMotion,advanceCharacterMotion,CHARACTER_MOTION_MODE,CHARACTER_MOTION_EVENT,CHARACTER_MOTION_TUNING,CHARACTER_MOTION_BACKEND,type CharacterMotionState,type CharacterMotionInput,type CharacterMotionWorld,type CharacterMotionTuning} from './runtime/character-motion.js';

export {SolidWorld,SolidBody,SolidBodyOverlapQuery,COMPOUND_PHYSICS_BACKEND,type SolidBodyOptions,type SolidWorldOptions,type SolidShape,type SolidBox,type SolidPlane,type SolidPlaneOptions,type SolidRayHit,type SolidContact,type SolidImpact,type SolidJoint,type SolidPolicies,type SolidBodyOverlapSource} from './physics/compound.js';

export type {PostProcessingSettings} from './render/camera-post.js';

export * from "./observability/index.js";
export {appendWaterSurfaceCell,type WaterSurfaceCell,type WaterSurfaceMesh} from './procedural/water-surface.js';
