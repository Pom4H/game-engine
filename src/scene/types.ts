import type {WalkerSpec,VehicleMotionSpec} from '../animation/locomotion.js';
import type {SnowContactSurfaceOptions} from '../environment/surface-contacts.js';
import type {Vec3} from '../math.js';
import type {MaterialKind} from '../materials/catalog.js';
import type {EnvironmentSpec} from '../environment/types.js';
import type {MaterialFinish,MaterialTreatment,SurfaceAppearance} from '../materials/surface.js';
import type {FacadeSpec} from '../render/facade-surface.js';
import type {GroundLitterSpec} from '../render/ground-litter.js';
import type {GroundCover} from '../render/ground-cover.js';
import type {RainResponse,SurfaceWeatherSpec} from '../render/rain-surface.js';
import type {SceneDeformationSpec} from '../physics/deformation.js';
import type {FluidVolumeSpec} from '../physics/fluid.js';
import type {WindVolumeSpec} from '../physics/wind.js';
import type {SoilVolumeSpec} from '../physics/soil.js';
import type {VehicleAir,VehicleControls,VehicleSpec} from '../vehicles/vehicle.js';

export type Color = readonly [number,number,number,number];
export type Primitive =
  | {kind:'box'; size?:Vec3}
  | {kind:'triangle-mesh';positions:readonly number[];normals:readonly number[];indices:readonly number[]; /** Optional authored UV pairs, including signed coordinates. */ uvs?:readonly number[]; /** Additive procedural variation, one value per vertex. */ variationSeeds?:readonly number[]; /** Optional sRGB vertex albedo, RGBA per vertex in [0,1]. */ colors?:readonly number[]}
  | {kind:'torus';radius:number;tube:number;segments?:number}
  | {kind:'cylinder'; radius:number; height:number; topRadius?:number; segments?:number}
  | {kind:'snowdrift'; size:Vec3; seed:number; segments?:number; continuous?:boolean; offset?:number}
  | {kind:'sphere'; radius?:number; segments?:number}
  | {kind:'plane'; size?:readonly [number,number]}
  /** Engine-generated triangular prism used for brittle fracture debris. */
  | {kind:'shard'; size:Vec3; axis?:0|1|2; skew?:number}
  | {kind:'polygon-prism'; points:readonly (readonly [number,number])[]; thickness:number; axis?:0|1|2};
/** Optional image surface detail, projected in world metres by the renderer.
 * Relative URLs resolve against the document URL. The renderer owns image/GPU
 * loading and cache lifetime; authoring code supplies only this descriptor. */
export interface SurfaceTextureSpec {
  /** Finite source terrain uses absolute authored X/Z UVs and its water mask.
   * The default retains the existing world triplanar image path. */
  readonly projection?:'triplanar'|'terrain-map';
  /** Optional albedo image. At least one map URL must be present. */
  readonly url?:string;
  /** World-space repeat size in metres; defaults to 1. */
  readonly sizeM?:number;
  /** Height-derived bump amplitude; defaults to 0.5. */
  readonly bumpStrength?:number;
  /** Blend of image albedo with the base material; defaults to 1. */
  readonly albedoStrength?:number;
  /** Optional tangent-space normal detail, projected with the same world scale. */
  readonly heightUrl?:string;
  /** Inward distance from the raster shell, in metres. White=0, black=-scale. */
  readonly heightScaleM?:number;
  readonly normalUrl?:string;
  readonly normalStrength?:number;
  /** Optional glTF-style ORM map: R=occlusion, G=roughness, B=metalness. */
  readonly ormUrl?:string;
  readonly ormStrength?:number;
}
export interface MaterialSpec { /** Optional optical vegetation; groundLitter remains for hard surfaces. */ groundCover?:GroundCover; facade?:FacadeSpec; /** Authored procedural seed; otherwise derived from entity identity. */ variationSeed?:number; groundLitter?:GroundLitterSpec; /** Optical rain kernels; absent keeps the existing material path. */ rainResponse?:RainResponse; /** Final optical state from an external simulation; never advances surface physics. */ surfaceAppearance?:SurfaceAppearance; /** UV-space coating overlay. Its supporting surface supplies collision and shadow. */ decal?:{kind:'coating-loss';severity:number;seed:number}; texture?:SurfaceTextureSpec; label?:string; /** Painted lettering in sRGB; defaults to the existing pale gold. */ labelColor?:readonly[number,number,number]; roughness?:number; metalness?:number; /** Dielectric top-coat intensity independent of the base layer. */ clearcoat?:number; clearcoatRoughness?:number; emissive?:readonly[number,number,number]; pattern?:'plain'|'brick'|'plaster'|'rubber'|'window'|'fabric';  kind?:MaterialKind; color?:Color; finish?:MaterialFinish; ageYears?:number; treatment?:MaterialTreatment }
export type SurfaceUse='generic'|'road'|'sidewalk'|'curb';
export interface EnvironmentalSpec { /** Appearance inherited by engine-generated snow cover; the base surface retains its own material. */ snowMaterial?:MaterialSpec; surfaceUse?:SurfaceUse; /** Initial settled snow, in metres. */ snowDepthM?:number; iceDepthM?:number; waterDepthM?:number; /** Weather/contact field spacing; detailed SnowSurface impressions keep their own resolution. */ fieldCellSizeM?:number }
export interface BodySpec {
  /** 0 is static. Dynamic mass may be explicit; material density is available to engine-generated fragments. */
  mass?:number;
  motion?:'dynamic'|'kinematic';
  velocity?:Vec3;
  angularVelocity?:Vec3;
  restitution?:number;
  friction?:number;
  shape?:'auto'|'box'|'sphere';
  /** Explicit collision envelope for body-only proxies. */
  collisionSize?:Vec3;
  /** Hollow internal volume used for water ingress. External buoyancy follows collision geometry. */
  fluid?:{readonly enclosedVolumeM3:number;readonly leakAreaM2?:number};
}
export interface EntitySpec {
  /** Attached render geometry whose collision is owned by its parent assembly. */
  visualOnly?:boolean;
  id:string;
  position?:Vec3;
  rotation?:Vec3;
  scale?:Vec3;
  /** Authoritative physical/collision geometry. Renderer uses it when renderMesh is absent. */
  mesh?:Primitive;
  /** Optional high-detail visual geometry. Never changes mass, contacts or environmental queries. */
  renderMesh?:Primitive;
  /** Pure projection entity. It never creates a collider, even for brittle visual materials such as glass. */
  renderOnly?:boolean;
  /** Visual visibility only. Hiding never moves an entity or removes its collider. */
  renderVisible?:boolean;
  /** Primary camera only; shadows, reflections and physical state are retained. */
  renderCameraVisible?:boolean;
  material?:MaterialSpec;
  environmental?:EnvironmentalSpec;
  light?:LightSpec;
  body?:BodySpec;
}
export interface LightEmissionSpec {
  /** World-space optical axis; angles are radians from this axis. */
  axis:Vec3; innerAngle:number; outerAngle:number;
  /** Opaque vertical ribs between glass panels; rotation and width in radians. */
  panelCount?:number; panelRotation?:number; frameWidth?:number;
  /** Rectangular glass enclosure centred on the emitter; top/bottom are opaque. */
  boxHalfSize?:Vec3; frameWidthM?:number;
}
export interface LightSpec { kind:'point'; color?:readonly[number,number,number]; intensity?:number; range?:number; emission?:LightEmissionSpec; /** Opt into a bounded nearby spotlight shadow map. Requires a polar emission cone narrower than 90 degrees. */ castShadow?:boolean }
export interface CameraIntrinsicsSpec {
  /** Focal lengths in pixels of the calibration image. */
  fx:number; fy:number;
  /** Principal point in pixels of the calibration image. */
  cx:number; cy:number;
  /** Calibration image dimensions. Rendering at another aspect ratio is rejected. */
  width:number; height:number;
}
export interface CameraSpec {
  position:Vec3; target:Vec3;
  /** Calibrated camera up direction. Defaults to world +Y for authored cameras. */
  up?:Vec3;
  /** Convenience vertical FOV for authored cameras. Ignored when intrinsics are present. */
  fov?:number;
  /** Exact pinhole calibration for measured/real-world captures. */
  intrinsics?:CameraIntrinsicsSpec;
  focusDistance?:number; aperture?:number;
}
export interface CameraRailSpec {
  /** Closed Catmull–Rom dolly, evaluated at absolute simulation time. */
  durationSeconds:number;
  keyframes:readonly {position:Vec3;target:Vec3}[];
}
export interface EnvironmentRadianceSpec {
  /** Equirectangular measured radiance, RGB half-float pixels in row-major order. */
  width:number; height:number; rgb16fBase64:string;
  /** Rotation taking world directions into the environment-camera coordinate system. */
  worldToEnvironment?:readonly [number,number,number, number,number,number, number,number,number];
  /** Dataset convention. Stanford-ORB uses +Y up and +Z at the left seam. */
  convention?:'stanford-orb'|'latlong-y-up';
  /** Physical scale multiplier. Keep at 1 for calibrated captures. */
  intensity?:number;
}
export interface ReflectionProbeSpec {
  /** Fixed world-space origin. Mutually exclusive with entity. */
  position?:Vec3;
  /** Optional entity whose current transform anchors the probe. */
  entity?:string;
  offset?:Vec3;
  /** Far clip / influence capture radius in metres. */
  radius?:number;
  /** Exact entity ids omitted from the captured environment (usually the reflected object itself). */
  exclude?:readonly string[];
  /** Faces refreshed per rendered frame. 1 amortizes the probe over six frames. */
  facesPerFrame?:number;
  /** Half-extents of the local parallax-correction box around the probe origin. */
  boxHalfExtents?:Vec3;
}
export interface RenderingSpec {
  /** Rain input from the presented simulation frame, with absolute render origin. */
  surfaceWeather?:SurfaceWeatherSpec;
  /** Continuous presented night factor for architectural materials; absent keeps each material's night. */
  facadeNight?:number;
  sunDirection?:Vec3; sunColor?:Vec3; skyColor?:Vec3;
  sunIntensity?:number; fogDensity?:number; exposure?:number; shadowExtent?:number;
  /** Linear diffuse irradiance, independent of the visible sky/background. */
  ambientIrradiance?:Vec3;
  /** Explicit camera backdrop. Does not affect world lighting or material energy. */
  backgroundColor?:Vec3;
  /** In-scattered ambient radiance, independent of the sky background. */
  fogColor?:Vec3;
  /** Height-dependent extinction above fogBaseHeight; zero is homogeneous. */
  fogHeightFalloff?:number; fogBaseHeight?:number;
  /** Clear near zone, then a linear extinction ramp along the viewing ray. */
  fogStartDistance?:number; fogRampDistance?:number;
  reflectionProbe?:ReflectionProbeSpec;
  /** World grid for the synthetic distant reflection proxy; defaults to 0.5 m.
   * Nearby reflections continue to use SSR and explicit local probes. */
  environmentProbeGridM?:number;
  /** Measured HDR environment. When present it replaces the synthetic distant-radiance proxy. */
  environmentRadiance?:EnvironmentRadianceSpec;
}
export interface AppearanceMaterialPatch {
  readonly id?:string;
  readonly idPrefix?:string;
  readonly treatment?:MaterialTreatment;
  readonly set:Readonly<Pick<MaterialSpec,'color'|'roughness'|'metalness'|'clearcoat'|'clearcoatRoughness'|'emissive'|'surfaceAppearance'|'rainResponse'|'groundLitter'|'groundCover'|'variationSeed'|'facade'|'texture'>>;
}
export interface AppearancePatch {
  readonly rendering?:Partial<RenderingSpec>;
  readonly materials?:readonly AppearanceMaterialPatch[];
}
export interface SceneAnimationSpec {
  readonly walkers?:readonly WalkerSpec[];
  readonly vehicles?:readonly VehicleMotionSpec[];
}
export interface SceneSurfaceContactsSpec {
  readonly snow?:readonly (SnowContactSurfaceOptions & {readonly surfaceId:string})[];
  readonly wheels?:readonly {readonly entityId:string;readonly radius?:number;readonly lateral?:Vec3}[];
}
export interface SceneVehicleVisualSpec {
  /** Render-only entity whose transform is projected from one authoritative vehicle assembly. */
  readonly entityId:string;
  readonly assemblyId:string;
  /** Local pose in the assembly body's frame. */
  readonly localPosition:Vec3;
  readonly localRotation?:Vec3;
  readonly localScale?:Vec3;
  /** Optional physical part supplying suspension/steer/spin state. */
  readonly partId?:string;
  readonly wheelRole?:'tyre'|'rim';
}
export interface SceneVehicleAssemblySpec {
  /** Existing authored Scene entity/body that owns the pose and collision shape. */
  readonly entityId:string;
  /** Ordinary Vehicle composition; Scene only owns its lifetime and force-driver binding. */
  readonly vehicle:Omit<VehicleSpec,'id'>;
  readonly controls?:VehicleControls;
  readonly air?:VehicleAir;
}
export interface SceneSpec {
  /** Statically checked causal observation DAG, compiled by Rust World v3. */
  couplings?:readonly import('../world-ir/couplings.js').WorldCoupling[];
  /** Opt-in CPU profiler: diagnoses cost without changing physics or render quality. */
  performance?:import('./performance.js').ScenePerformanceConfig;
  /** Declarative rig/routes restored by Scene construction, URL loading and reset. */
  animation?:SceneAnimationSpec;
  /** Author contact bindings once; native systems own every subsequent update. */
  surfaceContacts?:SceneSurfaceContactsSpec;
  /** Persistent plastic deformation groups driven by physics contacts. */
  deformation?:SceneDeformationSpec;
  /** Declarative physics assemblies adopt existing Scene bodies; no second pose/integrator. */
  vehicleAssemblies?:readonly SceneVehicleAssemblySpec[];
  /** Visual children are projections of assembly state, never another vehicle simulation. */
  vehicleVisuals?:readonly SceneVehicleVisualSpec[];
  /** Finite physical fluid volumes; rendering remains an ordinary entity/material concern. */
  fluids?:readonly FluidVolumeSpec[];
  /** Spatial air-flow volumes for wind tunnels, gust corridors and wake experiments. */
  windVolumes?:readonly WindVolumeSpec[];
  /** Persistent deformable bearing fields for wheels/tracks. */
  soilVolumes?:readonly SoilVolumeSpec[];
  rendering?:RenderingSpec;
  version:1;
  seed?:number;
  gravity?:Vec3;
  ground?:number;
  clearColor?:Color;
  environment?:EnvironmentSpec;
  camera?:CameraSpec;
  cameraRail?:CameraRailSpec;
  entities:readonly EntitySpec[];
}
export interface SceneSnapshot {
  version:1;
  time:number;
  tick:number;
  entities:readonly {id:string;position:Vec3;rotation:Vec3;velocity:Vec3;material:MaterialKind}[];
}
