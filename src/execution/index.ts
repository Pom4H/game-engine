import {renderModel,renderPrimitive} from '../render/frame.js';
import type {CameraSpec} from '../scene/types.js';
import type {RuntimeEntity,Scene} from '../scene/scene.js';
import {
  CAUSAL_RENDER_CONTRACT_VERSION,contentHash,defineCausalRenderObservation,defineRenderFrame,defineRenderProgram,
  type CausalSurfaceObservation,type ContentAddressedRepository,type ContentHash,type ContentRef,type PortableRenderFrame,type RenderPartitionability,type RenderProgramDescriptor,type ResourceManifest,type TemporalInputs,
} from '../render-ir/index.js';

export type ExecutionResourceAccess='read'|'write';
export interface ExecutionResourceUse {readonly resource:ContentRef;readonly access:ExecutionResourceAccess}
export interface ExecutionCostHint {readonly cpuMicros?:number;readonly gpuMicros?:number;readonly npuMicros?:number;readonly bytesRead?:number;readonly bytesWritten?:number}
export interface ExecutionNode {
  readonly id:string;readonly operation:string;readonly inputs:readonly ExecutionResourceUse[];readonly outputs:readonly ContentRef[];
  readonly deterministic:boolean;readonly partitionability:RenderPartitionability|{readonly kind:'atomic'};readonly cost?:ExecutionCostHint;
}
export interface ExecutionGraph {readonly schema:1;readonly graphHash:ContentHash;readonly programHash:ContentHash;readonly nodes:readonly ExecutionNode[]}
export type PlacementKind='local'|'mesh.temporal'|'mesh.spatial'|'mesh.samples';
export type ExecutionAccelerator='cpu'|'gpu'|'npu';
export interface PlacementProfile {readonly kind:PlacementKind;readonly accelerator?:ExecutionAccelerator;readonly deadlineNs?:bigint}
export interface LocalProgramDescriptor {readonly graph:ExecutionGraph;readonly placement:'local';readonly accelerator:ExecutionAccelerator}

export function defineExecutionGraph(graph:ExecutionGraph):ExecutionGraph{
  if(graph.schema!==1||!graph.graphHash||!graph.programHash)throw new TypeError('Execution graph requires schema 1, a stable hash and a program hash');
  const ids=new Set<string>();for(const node of graph.nodes){if(!node.id||ids.has(node.id))throw new TypeError('Execution nodes require unique stable IDs');ids.add(node.id);if(!node.operation)throw new TypeError('Execution node requires an operation');}
  return deepFreeze(structuredClone(graph));
}
export function localProgram(graph:ExecutionGraph,accelerator:ExecutionAccelerator='cpu'):LocalProgramDescriptor{return Object.freeze({graph,placement:'local',accelerator});}

export interface SceneRenderProjectionOptions{
  readonly epoch:bigint;readonly frame:bigint;readonly stochasticSequence?:bigint;readonly camera?:CameraSpec;readonly temporal?:TemporalInputs;
}
export interface ProjectedRenderFrame {readonly frame:PortableRenderFrame;readonly frameRef:ContentRef}
export interface RenderSequenceCheckpoint {
  readonly schema:1;readonly firstFrame:bigint;readonly lastFrameExclusive:bigint;readonly frames:readonly ContentRef[];
  readonly programRef:ContentRef;readonly graphRef:ContentRef;readonly resourceManifestRef:ContentRef;readonly profileHash:string;readonly cameraHash:string;
}
export interface RenderSequenceBundle {
  readonly program:RenderProgramDescriptor;readonly programRef:ContentRef;readonly graph:ExecutionGraph;readonly graphRef:ContentRef;readonly manifest:ResourceManifest;readonly manifestRef:ContentRef;
  readonly checkpoint:RenderSequenceCheckpoint;readonly checkpointRef:ContentRef;readonly cameraHash:string;
}

const cameraData=(camera:CameraSpec):readonly number[]=>Object.freeze([
 ...camera.position,...camera.target,...(camera.up??[0,1,0]),
 camera.fov??0,camera.focusDistance??0,camera.aperture??0,
 ...(camera.intrinsics?[camera.intrinsics.fx,camera.intrinsics.fy,camera.intrinsics.cx,camera.intrinsics.cy,camera.intrinsics.width,camera.intrinsics.height]:[0,0,0,0,0,0]),
]);
const materialData=(entity:RuntimeEntity,store:ContentAddressedRepository,refs:ContentRef[])=>{
  const textureRef=entity.material.texture?store.put('texture',entity.material.texture):undefined;if(textureRef)refs.push(textureRef);
  return {
    kind:entity.material.kind,color:entity.material.color,labelColor:entity.material.labelColor,label:entity.material.label,
    roughness:entity.material.roughness,metalness:entity.material.metalness,clearcoat:entity.material.clearcoat,clearcoatRoughness:entity.material.clearcoatRoughness,
    emissive:entity.material.emissive,pattern:entity.material.pattern,finish:entity.material.finish,ageYears:entity.material.ageYears,treatment:entity.material.treatment,
    ...(textureRef?{texture:textureRef}:{}),profile:entity.material.profile,surface:entity.material.surface,
  };
};

export function projectSceneRenderFrame(scene:Scene,store:ContentAddressedRepository,options:SceneRenderProjectionOptions):ProjectedRenderFrame{
  if(options.epoch<0n||options.frame<0n)throw new RangeError('Render frame identity must be non-negative');
  const camera=options.camera??scene.camera,objects=[],lights=[],refs:ContentRef[]=[],surfaces:CausalSurfaceObservation[]=[];
  for(const entity of [...scene.entities.values()].sort((a,b)=>a.id.localeCompare(b.id))){
    if(entity.light){const light=entity.light,color=light.color??[1,1,1];lights.push(Object.freeze({id:entity.id,kind:'point' as const,state:Object.freeze([...entity.position,...color,light.intensity??1,light.range??10])}));}
    const primitive=renderPrimitive(entity);if(!primitive)continue;
    const physicalGeometry=entity.mesh?store.put('mesh',entity.mesh):undefined,visualGeometry=store.put('mesh',primitive),material=store.put('material',materialData(entity,store,refs)),transform=Object.freeze(Array.from(renderModel(entity)));
    if(physicalGeometry)refs.push(physicalGeometry);refs.push(visualGeometry,material);
    objects.push(Object.freeze({id:entity.id,mesh:visualGeometry,material,transform}));
    const surface=scene.surfaces.surfaces.get(entity.id),bodySurface=scene.surfaces.bodies.get(entity.id),body=entity.body;
    surfaces.push(Object.freeze({
      identity:Object.freeze({entityId:entity.id,surfaceId:entity.id}),
      ...(physicalGeometry?{physicalGeometry}:{}),visualGeometry,material,transform,
      linearVelocityMps:Object.freeze(body?[...body.velocity] as [number,number,number]:[0,0,0] as [number,number,number]),
      angularVelocityRadps:Object.freeze(body?[...body.angularVelocity] as [number,number,number]:[0,0,0] as [number,number,number]),
      ...(surface?{surface:Object.freeze({
        temperatureC:surface.temperatureC,wetness:surface.wetness,snowDepthM:surface.snowDepthM,waterDepthM:surface.waterDepthM,iceDepthM:surface.iceDepthM,slush:surface.slush,
        dirt:surface.dirt,wear:surface.wear,trackMelt:surface.trackMelt,puddle:surface.puddle,snowFreshness:surface.snowpack.freshness,
        snowLiquidFraction:surface.snowpack.liquidFraction,snowIceFraction:surface.snowpack.iceFraction,snowGrainSizeMm:surface.snowpack.grainSizeMm,snowCrust:surface.snowpack.crust,
      })}:{}),
      ...(bodySurface?{bodySurface:Object.freeze({snowCoverage:bodySurface.snowCoverage,rearSnow:bodySurface.rearSnow,wetness:bodySurface.wetness,roadDirt:bodySurface.roadDirt})}:{}),
    }));
  }
  const environment=store.put('environment',{state:scene.environment,rendering:scene.spec.rendering??null,clearColor:scene.spec.clearColor??null});refs.push(environment);
  const observation=store.put('observation',defineCausalRenderObservation({
    schema:1,contractVersion:CAUSAL_RENDER_CONTRACT_VERSION,simulationTick:BigInt(scene.tick),simulationTimeSeconds:scene.time,
    world:Object.freeze({handedness:'right' as const,up:'+Y' as const,positionUnit:'m' as const,timeUnit:'s' as const,angleUnit:'rad' as const,radiance:'scene-linear' as const}),
    surfaces:Object.freeze(surfaces),environment,
  }));refs.push(observation);
  const frame=defineRenderFrame({
    schema:1,simulationTick:BigInt(scene.tick),frame:options.frame,camera:cameraData(camera),objects:Object.freeze(objects),lights:Object.freeze(lights),environment,observation,
    resources:store.manifest(refs),temporal:options.temporal??Object.freeze({}),
    determinism:Object.freeze({epoch:options.epoch,frame:options.frame,stochasticSequence:options.stochasticSequence??options.frame}),
  });
  return Object.freeze({frame,frameRef:store.put('frame',frame)});
}

export function createRenderSequenceBundle(store:ContentAddressedRepository,frames:readonly PortableRenderFrame[],options:{readonly profileHash:string;readonly warmupFrames:number}):RenderSequenceBundle{
  if(!frames.length)throw new RangeError('Render sequence requires at least one frame');
  if(!options.profileHash)throw new TypeError('Render sequence requires a profile hash');
  if(!Number.isSafeInteger(options.warmupFrames)||options.warmupFrames<0)throw new RangeError('warmupFrames must be non-negative');
  const ordered=[...frames].sort((a,b)=>a.frame<b.frame?-1:a.frame>b.frame?1:0);
  for(let i=1;i<ordered.length;i++)if(ordered[i]!.frame!==ordered[i-1]!.frame+1n)throw new TypeError('Render sequence frames must be contiguous');
  const frameRefs:ContentRef[]=[],resourceRefs:ContentRef[]=[];
  for(const frame of ordered){frameRefs.push(store.put('frame',frame));resourceRefs.push(...frame.resources.resources);}
  const manifest=store.manifest(resourceRefs),manifestRef=store.put('manifest',manifest),cameraHash=contentHash(ordered.map(frame=>frame.camera),'camera');
  const partitionability={kind:'temporal' as const,warmupFrames:options.warmupFrames},programHash=contentHash({profileHash:options.profileHash,partitionability,resources:manifest.resources},'program');
  const program=defineRenderProgram({schema:1,programHash,profileHash:options.profileHash,partitionability,requiredResources:manifest}),programRef=store.put('program',program);
  const graph=lowerRenderProgram(program),graphRef=store.put('graph',graph);
  const checkpoint:RenderSequenceCheckpoint=Object.freeze({
    schema:1,firstFrame:ordered[0]!.frame,lastFrameExclusive:ordered.at(-1)!.frame+1n,frames:Object.freeze(frameRefs),
    programRef,graphRef,resourceManifestRef:manifestRef,profileHash:options.profileHash,cameraHash,
  });
  const checkpointRef=store.put('checkpoint',checkpoint);
  return Object.freeze({program,programRef,graph,graphRef,manifest,manifestRef,checkpoint,checkpointRef,cameraHash});
}
export function lowerRenderProgram(program:RenderProgramDescriptor):ExecutionGraph{
  const graphHash=contentHash({operation:'render.sequence',programHash:program.programHash,profileHash:program.profileHash,partitionability:program.partitionability,resources:program.requiredResources.resources},'graph');
  return defineExecutionGraph({schema:1,graphHash,programHash:program.programHash,nodes:[Object.freeze({
    id:'render.sequence',operation:'render.sequence',
    inputs:Object.freeze(program.requiredResources.resources.map(resource=>Object.freeze({resource,access:'read' as const}))),
    outputs:Object.freeze([]),deterministic:true,partitionability:program.partitionability,
  })]});
}
function deepFreeze<T>(value:T):T{if(value&&typeof value==='object'&&!Object.isFrozen(value)&&!ArrayBuffer.isView(value)){for(const child of Object.values(value as Record<string,unknown>))deepFreeze(child);Object.freeze(value);}return value;}
