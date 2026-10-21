import type {SimulationProfile,SimulationProfileInput} from '../core/kernel.js';
import type {AppearancePatch,CameraSpec,SceneSnapshot,SceneSpec} from '../scene/types.js';
import type {Scene} from '../scene/scene.js';
import type {RenderProfileSnapshot,RenderProfiler} from './profiler.js';
import type {VisibilityMode,VisibilitySnapshot} from './gpu-visibility.js';
import type {VisibilityPlanSnapshot} from './visibility-plan.js';
import type {RenderPipelinePlan} from './pipeline-plan.js';
import type {ModelHistorySnapshot} from './model-history.js';
import type {RadianceProjectionSnapshot} from './radiance.js';
export type LinearPixelStage='hdr'|'reflection'|'effects'|'taa'|'motionBlur';
export interface LinearPixelSample {x:number;y:number;rgba:readonly[number,number,number,number]}
export interface RenderTargetInfo {width:number;height:number;format:string}
export interface RenderStats {environmentBaking?:{active:boolean;queued:boolean;failed:boolean}}
export interface RenderStats {postProcessing?:Readonly<import('./camera-post.js').PostProcessingSettings>}
export interface RenderStats {cameraDepth?:Readonly<import('./camera-depth.js').CameraDepthConfiguration>}
export interface RenderStats {spotLightShadows?:{active:number;size:number;lights:readonly string[]}}
export interface RenderStats {backend:'webgpu'|'cpu';width:number;height:number;drawCalls:number;triangles:number;geometryCountBasis?:'exact'|'candidate-upper-bound';visibility?:{mode:VisibilityMode;batches:number;candidates:number;currentVisible:number|null;diagnostics?:VisibilitySnapshot;reflection?:{batches:number;candidates:number;currentVisible:number|null}};pipeline?:RenderPipelinePlan;renderTargets?:Readonly<Record<string,RenderTargetInfo>>;preparation?:{entries:number;lights:number;builds:number;modelUpdates:number;batchPlanBuilds:number;batchCauseEntries:number;modelHistory?:ModelHistorySnapshot;radiance?:RadianceProjectionSnapshot;visibilityPlan:VisibilityPlanSnapshot};meshes:number;objects?:number;buffers?:number;textures?:number;errors:readonly string[];pointLights?:number;lightOverflow?:number;materialTextures?:number;cpuStagingBytes?:number;environmentCache?:{updates:number;invalidations:Readonly<Record<string,number>>;causes?:{entries:number;rebuilds:number}};reflectionProbe?:{validFaces:number;complete:boolean;nextFace:number;position?:readonly[number,number,number]};profile?:RenderProfileSnapshot}
export interface Renderer {configurePostProcessing?(options:Partial<import('./camera-post.js').PostProcessingSettings>):Readonly<import('./camera-post.js').PostProcessingSettings>;setSimulationProfile?(profile:SimulationProfileInput):void;setResolution?(width:number,height:number):void;sampleLinearPixels?(points:readonly (readonly [number,number])[],stage?:LinearPixelStage):Promise<readonly LinearPixelSample[]>;prepareMaterials?(scene:Scene):Promise<void>;render(scene:Scene,camera?:CameraSpec):void;resize():void;inspect(includeProfile?:boolean):RenderStats;profileLatest?():ReturnType<RenderProfiler["latest"]>;profile?():RenderProfileSnapshot|undefined;resetProfile?():void;flush():Promise<void>;dispose():void}
/** Discard reprojection history after a deliberate camera/subject cut. */
export interface Renderer {resetTemporalHistory?():void}
export interface EngineBridge {snapshot():SceneSnapshot;setSimulationProfile(profile:SimulationProfileInput):SimulationProfile;probeLinear(points:readonly (readonly [number,number])[],stage?:LinearPixelStage):Promise<readonly LinearPixelSample[]>;pause():void;resume():void;step(count?:number):SceneSnapshot;seek(seconds:number):SceneSnapshot;replaceScene(scene:SceneSpec):Promise<void>;patchAppearance(patch:AppearancePatch):void;setCamera(camera:CameraSpec):void;render():RenderStats;profile():RenderProfileSnapshot|undefined;resetProfile():void;drain():Promise<void>;flush():Promise<void>;dispose():void;inspect():Record<string,unknown>}
