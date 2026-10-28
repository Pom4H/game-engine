import {WebGPURenderer as EngineRenderer} from '../../dist/render/webgpu.js';
import {cameraProjection} from '../../dist/render/calibrated-camera.js';
import {matrixError} from './metrics.mjs';
import {visibilityCamera, threeCubeFaces} from './fixture.mjs';
import {engineFeatures,requireProfile,sharedEffects} from './profiles.mjs';
import {requireParameters} from './parameters.mjs';
import {RenderCpuPhaseObserver} from './cpu-phases.mjs';
import {renderModel} from '../../dist/render/frame.js';
import {instanceUpdateRuns} from './instance-updates.mjs';

export const pipelineManifest = {
  engine: {instances: 'GPU AABB culling + compaction + indirect draw; main/reflected views share a 40-float source, with independent visibility outputs', shading: 'engine PBR + procedural material/weather detail', shadows: '2048 static + 1024 dynamic, cached static map', environment: 'shared 256px linear HDR cubemap; engine prefilter + irradiance SH', sky: 'procedural atmosphere/clouds', antiAliasing: 'native TAA', effects: ['AO', 'SSR', 'planar reflection', 'bloom', 'tone mapping'], profiling: 'common pass timestamps; internal profiler disabled'},
  three: {instances: 'InstancedMesh; native bounding-volume culling of whole batches', shading: 'MeshStandardMaterial', shadows: '2048 directional PCF, raster depthBias=1/slope=1.5, receiver bias=-.000025', environment: 'shared 256px linear HDR cubemap, adapted X convention; native PMREM', sky: 'shared cubemap background', antiAliasing: 'none (one sample)', effects: ['ACES tone mapping'], profiling: 'common pass timestamps; internal profiler disabled'},
  babylon: {instances: 'thin instances; native bounding-volume culling of whole batches', shading: 'PBRMaterial', shadows: '2048 directional PCF, raster depthBias=1/slope=1.5, API bias=.00005 (WebGPU normalized offset=.000025)', environment: 'shared 256px linear HDR cubemap; native HDRFiltering GGX, 64 samples, outside measurement', sky: 'shared cubemap on BackgroundMaterial', antiAliasing: 'none (one sample)', effects: ['ACES tone mapping'], visualLimitations: ['Residual PCF self-shadow striping on the large ground. Equal image quality is not established.'], profiling: 'common pass timestamps; internal profiler disabled'},
};

export async function seedEnvironment(canvas, fixture, width, height) {
  // A bounded fixture-only adapter for the current engine's procedural radiance.
  // Generation is setup work, never part of any measured renderer frame.
  const renderer = await EngineRenderer.create(canvas, {profiling: false, visibility: 'gpu'});
  const queue=renderer.device.queue,writeTexture=queue.writeTexture;let uploaded;
  const target=renderer.gpu?.environmentMap;if(!target)throw new Error('Environment upload adapter needs updating');
  queue.writeTexture=function(destination,data,...args){if(destination.texture===target&&(destination.mipLevel??0)===0){if(!(data instanceof Uint16Array)||data.length!==256*256*6*4)throw new Error('Environment upload shape changed');uploaded=data.slice();}return writeTexture.call(this,destination,data,...args);};
  try {
    renderer.setResolution(width, height);
    await renderer.prepareMaterials(fixture.scene);
    renderer.render(fixture.scene, visibilityCamera(0));
    await renderer.flush();
    if(!uploaded)throw new Error('Missing source environment upload');
    return {size: 256, rgba16f: uploaded};
  } finally {queue.writeTexture=writeTexture;renderer.dispose();}
}

export function describePipeline(name,profile='native',options={}){
  requireProfile(profile);
  const parameters=requireParameters(options);
  const result=profile!=='native'&&name==='engine'?{...pipelineManifest.engine,antiAliasing:'none (one sample, unjittered)',effects:['native tone mapping'],instances:'GPU AABB culling + compaction + indirect draw; main view only',visualLimitations:['Common effect set. Native PBR, procedural material detail, atmosphere, IBL, bloom kernels and tone mapping still differ.']}:pipelineManifest[name];
  const instances=name==='engine'?(parameters.engineVisibility==='gpu'?'GPU AABB culling + compaction + indirect draw':parameters.engineVisibility==='cpu-batched'?'CPU AABB culling + instanced indirect draw':'CPU per-object culling + individual main-view draws'):(parameters.peerInstancing?result.instances:'Individual meshes + native per-mesh bounds culling');
  return {...result,instances,environmentMode:parameters.environmentMode,...(profile==='common-bloom'?{effects:[...result.effects,'bloom']}:{}),sharedEffects:sharedEffects(profile)};
}

export async function createBackend(name, canvas, fixture, environment, width, height,profile='native',{cpuPhaseTimings=false,...options}={}) {
  requireProfile(profile);
  const parameters=requireParameters(options);
  if(cpuPhaseTimings&&name!=='engine')throw new Error('Renderer CPU phase timings only cover Engine');
  if (name === 'engine') {
    const renderer = await EngineRenderer.create(canvas, {profiling: false, visibility:parameters.engineVisibility,features:engineFeatures(profile)});
    renderer.setResolution(width, height);
    await renderer.prepareMaterials(fixture.scene);
    const phases=cpuPhaseTimings?new RenderCpuPhaseObserver(renderer.profiler):null;
    return {
      beginCpuFrame:phases?frame=>phases.beginFrame(frame):undefined,
      endCpuFrame:phases?cpuMs=>phases.endFrame(cpuMs):undefined,
      render(camera, frame) {renderer.setTimelineFrame(frame);renderer.render(fixture.scene, camera);},
      audit(camera) {
        const objects = renderer.renderFrame?.objects;
        // Query the renderer-owned cache, whose models feed the production buffers.
        if (!objects) throw new Error('Engine Render IR inspection adapter needs updating');
        const byId = new Map(objects.map(object => [object.entity.id, object]));
        const errors = fixture.groups.flatMap(group => group.objects.map((object,index) => matrixError(group.models.subarray(index*16,index*16+16), byId.get(object.entity.id)?.model ?? [])));
        return {objects: objects.length, modelMaxError: Math.max(...errors), geometrySource: 'production Render IR', cameraSource: 'production RenderFrameIR.camera',
          viewMaxError: matrixError(fixture.view(camera), fixture.view(renderer.renderFrame.camera)), projectionMaxError: matrixError(fixture.projection(camera, width / height), cameraProjection(renderer.renderFrame.camera, width, height).matrix)};
      },
      inspect: () => ({...renderer.inspect(false),environmentMode:parameters.environmentMode,environmentUpdates:renderer.environmentUpdates,measuredEnvironmentApplied:renderer.measuredRadianceSpec===fixture.scene.spec.rendering?.environmentRadiance}),
      flush: () => renderer.flush(),
      reset: () => renderer.resetTemporalHistory(),
      dispose: () => {try{phases?.dispose();}finally{renderer.dispose();}},
    };
  }
  if (name === 'three') return createThree(canvas, fixture, environment, width, height,profile,parameters);
  if (name === 'babylon') return createBabylon(canvas, fixture, environment, width, height,profile,parameters);
  throw new Error('Unknown backend: ' + name);
}

function peerGroups(fixture,instancing){return instancing?fixture.groups:fixture.groups.flatMap(group=>group.objects.map((object,index)=>({...group,objects:[object],models:group.models.subarray(index*16,index*16+16),linearColors:group.linearColors.subarray(index*4,index*4+4)})));}

async function createThree(canvas, fixture, environment, width, height,profile,parameters) {
  const T = await import('/vendor/three/build/three.webgpu.js');
  const renderer = new T.WebGPURenderer({canvas, antialias: false, trackTimestamp: false, powerPreference: 'high-performance'});
  renderer.setPixelRatio(1);renderer.setSize(width, height, false);renderer.toneMapping = T.ACESFilmicToneMapping;renderer.toneMappingExposure = fixture.rendering.exposure;
  renderer.shadowMap.enabled = true;renderer.shadowMap.type = T.PCFShadowMap;
  await renderer.init();
  if (!renderer.backend.isWebGPUBackend) throw new Error('Three.js fell back from WebGPU');
  const scene = new T.Scene(), camera = new T.PerspectiveCamera(65, width / height, .1, 145), meshes = [];
  const faces = threeCubeFaces(environment).map(data => new T.DataTexture(data, environment.size, environment.size, T.RGBAFormat, T.HalfFloatType));
  const cube = new T.CubeTexture(faces);cube.type = T.HalfFloatType;cube.format = T.RGBAFormat;cube.colorSpace = T.LinearSRGBColorSpace;cube.needsUpdate = true;
  scene.environment = cube;scene.background = cube;
  scene.fog = new T.FogExp2(new T.Color(...fixture.rendering.skyColor), fixture.rendering.fogDensity);
  for (const group of peerGroups(fixture,parameters.peerInstancing)) {
    const geometry = new T.BufferGeometry();
    geometry.setAttribute('position', new T.BufferAttribute(group.positions.slice(), 3));
    geometry.setAttribute('normal', new T.BufferAttribute(group.normals.slice(), 3));
    geometry.setIndex(new T.BufferAttribute(group.indices.slice(), 1));
    const material = new T.MeshStandardMaterial({color: 0xffffff, metalness: group.optics.metalness, roughness: group.optics.roughness});
    const mesh = parameters.peerInstancing?new T.InstancedMesh(geometry, material, group.objects.length):new T.Mesh(geometry,material);
    if(parameters.peerInstancing){
      mesh.instanceMatrix.array.set(group.models);mesh.instanceMatrix.needsUpdate = true;
      mesh.instanceColor = new T.InstancedBufferAttribute(new Float32Array(group.objects.length * 3), 3);
      for (let n = 0; n < group.objects.length; n++) mesh.instanceColor.array.set(group.linearColors.subarray(n * 4, n * 4 + 3), n * 3);
      mesh.instanceColor.needsUpdate = true;mesh.computeBoundingBox();mesh.computeBoundingSphere();
    }else{mesh.matrix.fromArray(group.models);material.color.setRGB(...group.linearColors.subarray(0,3));}
    mesh.castShadow = true;mesh.receiveShadow = true;mesh.matrixAutoUpdate = false;
    mesh.onBeforeShadow = (renderer, object, viewCamera, shadowCamera, geometry, shadowMaterial) => {
      shadowMaterial.polygonOffset = true;shadowMaterial.polygonOffsetFactor = 1.5;shadowMaterial.polygonOffsetUnits = 1;
    };
    scene.add(mesh);meshes.push({mesh, group});
  }
  const settings = fixture.rendering, length = Math.hypot(...settings.sunDirection), direction = settings.sunDirection.map(value => value / length);
  const sun = new T.DirectionalLight(new T.Color(1, .87, .72), settings.sunIntensity);
  sun.position.set(direction[0] * 180, 4 + direction[1] * 180, direction[2] * 180);sun.target.position.set(0, 4, 0);sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);sun.shadow.bias = -.000025;Object.assign(sun.shadow.camera, {left: -settings.shadowExtent, right: settings.shadowExtent, top: settings.shadowExtent, bottom: -settings.shadowExtent, near: 1, far: 400});
  scene.add(sun, sun.target);
  for (const entity of fixture.lights) {
    const source = entity.light, light = new T.PointLight(new T.Color(...source.color), source.intensity, source.range, 2);
    light.position.set(...entity.position);scene.add(light);
  }
  const setCamera = spec => {camera.position.set(...spec.position);camera.up.set(0, 1, 0);camera.lookAt(...spec.target);camera.fov = spec.fov;camera.near = spec.near;camera.far = spec.far;camera.updateProjectionMatrix();camera.updateMatrixWorld();};
  let post=null,bloomNode=null,bloomExecutions=0;
  if(profile==='common-bloom'){
    const {pass}=await import('/vendor/three/build/three.tsl.js'),{bloom}=await import('/vendor/three/examples/jsm/tsl/display/BloomNode.js');
    post=new T.RenderPipeline(renderer);const source=pass(scene,camera).getTextureNode('output');bloomNode=bloom(source,.46,0,1);bloomNode.setResolutionScale(.25);
    const update=bloomNode.updateBefore;bloomNode.updateBefore=function(...args){bloomExecutions++;return update.apply(this,args);};post.outputNode=source.add(bloomNode);
  }
  const records=new Map(meshes.flatMap(record=>record.group.objects.map((object,index)=>[object.entity.id,{...record,index}])));
  return {
    updateInstances(changed){const touched=new Map();for(const item of changed){const record=records.get(item.object.entity.id),model=renderModel(item.object.entity);item.group.models.set(model,item.index*16);if(parameters.peerInstancing){record.mesh.instanceMatrix.array.set(model,record.index*16);if(!touched.has(record.mesh))touched.set(record.mesh,[]);touched.get(record.mesh).push(record.index);}else{record.mesh.matrix.fromArray(model);record.mesh.matrixWorldNeedsUpdate=true;}}for(const [mesh,indices] of touched){for(const run of instanceUpdateRuns(indices))mesh.instanceMatrix.addUpdateRange(run.start*16,run.count*16);mesh.instanceMatrix.needsUpdate=true;mesh.computeBoundingBox();mesh.computeBoundingSphere();}},
    render(spec) {setCamera(spec);if(post)post.render();else renderer.render(scene, camera);},
    audit(spec) {
      setCamera(spec);
      return {objects: meshes.reduce((sum, {mesh}) => sum + (parameters.peerInstancing?mesh.count:1), 0), modelMaxError: Math.max(...meshes.map(({mesh, group}) => matrixError(group.models, parameters.peerInstancing?mesh.instanceMatrix.array:mesh.matrix.elements))),
        geometryMaxError: Math.max(...meshes.flatMap(({mesh, group}) => [matrixError(group.positions, mesh.geometry.attributes.position.array), matrixError(group.normals, mesh.geometry.attributes.normal.array), matrixError(group.indices, mesh.geometry.index.array)])),
        viewMaxError: matrixError(fixture.view(spec), camera.matrixWorldInverse.elements), projectionMaxError: matrixError(fixture.projection(spec, width / height), camera.projectionMatrix.elements)};
    },
    inspect: () => ({backend: 'webgpu', geometries: renderer.info.memory.geometries, textures: renderer.info.memory.textures,comparisonEffects:sharedEffects(profile)?{...sharedEffects(profile),bloom:!!bloomNode,samples:Math.max(1,renderer.samples)}:null,bloomExecutions,instancing:parameters.peerInstancing,bloomParameters:bloomNode?{threshold:bloomNode.threshold.value,strength:bloomNode.strength.value,resolutionScale:bloomNode.getResolutionScale()}:null}),
    flush: () => renderer.backend.device.queue.onSubmittedWorkDone(),
    reset() {},
    dispose() {post?.dispose();bloomNode?.dispose();for (const {mesh} of meshes) {mesh.geometry.dispose();mesh.material.dispose();}cube.dispose();renderer.dispose();},
  };
}

async function createBabylon(canvas, fixture, environment, width, height,profile,parameters) {
  const B = await import('/vendor/babylon/index.js');
  const engine = new B.WebGPUEngine(canvas, {antialias: false, adaptToDeviceRatio: false, powerPreference: 'high-performance', enableAllFeatures: false});
  await engine.initAsync({jsPath: '/vendor/babylon/assets/glslang/glslang.js', wasmPath: '/vendor/babylon/assets/glslang/glslang.wasm'}, {jsPath: '/vendor/babylon/assets/twgsl/twgsl.js', wasmPath: '/vendor/babylon/assets/twgsl/twgsl.wasm'});
  engine.setSize(width, height);
  const scene = new B.Scene(engine);scene.useRightHandedSystem = true;
  const camera = new B.FreeCamera('camera', new B.Vector3(0, 0, 0), scene);scene.activeCamera = camera;camera.minZ = .1;camera.maxZ = 145;
  scene.imageProcessingConfiguration.toneMappingEnabled = true;scene.imageProcessingConfiguration.toneMappingType = B.ImageProcessingConfiguration.TONEMAPPING_ACES;scene.imageProcessingConfiguration.exposure = fixture.rendering.exposure;
  scene.fogMode = B.Scene.FOGMODE_EXP2;scene.fogDensity = fixture.rendering.fogDensity;scene.fogColor = new B.Color3(...fixture.rendering.skyColor);
  const faces = Array.from({length: 6}, (_, face) => environment.rgba16f.slice(face * environment.size ** 2 * 4, (face + 1) * environment.size ** 2 * 4));
  const cube = new B.RawCubeTexture(scene, faces, environment.size, B.Constants.TEXTUREFORMAT_RGBA, B.Constants.TEXTURETYPE_HALF_FLOAT, true, false, B.Texture.TRILINEAR_SAMPLINGMODE);
  // The shared source already uses right-handed WebGPU +Z; suppress Babylon's
  // default right-handed conversion for cubemaps authored in its loader convention.
  cube.gammaSpace = false;cube.invertZ = true;cube.coordinatesMode = B.Texture.CUBIC_MODE;cube.lodGenerationScale = 1;cube.lodGenerationOffset = 0;
  const backgroundCube = cube.clone();backgroundCube.coordinatesMode = B.Texture.SKYBOX_MODE;
  // PBR roughness expects a GGX-prefiltered environment, rather than merely
  // averaged mipmaps. Like Three's PMREM, this is setup work only.
  await new B.HDRFiltering(engine, {quality: B.Constants.TEXTURE_FILTERING_QUALITY_HIGH}).prefilter(cube);
  scene.environmentTexture = cube;
  const sky = B.MeshBuilder.CreateBox('background', {size: 1000}, scene), background = new B.BackgroundMaterial('background', scene);
  background.reflectionTexture = backgroundCube;background.backFaceCulling = false;background.useRGBColor = false;
  sky.material = background;sky.infiniteDistance = true;sky.isPickable = false;
  const meshes = [];
  for (const group of peerGroups(fixture,parameters.peerInstancing)) {
    const mesh = new B.Mesh('group:' + meshes.length, scene), data = new B.VertexData();
    data.positions = group.positions.slice();data.normals = group.normals.slice();data.indices = group.indices.slice();data.applyToMesh(mesh, false);
    const material = new B.PBRMaterial('material:' + meshes.length, scene);
    material.albedoColor = B.Color3.White();material.metallic = group.optics.metalness;material.roughness = group.optics.roughness;material.maxSimultaneousLights = 5;
    material.sideOrientation = B.Material.CounterClockWiseSideOrientation;mesh.material = material;mesh.receiveShadows = true;
    if(parameters.peerInstancing){mesh.thinInstanceSetBuffer('matrix', group.models.slice(), 16, false);mesh.thinInstanceSetBuffer('color', group.linearColors.slice(), 4, true);mesh.useVertexColors = true;}
    else{mesh.freezeWorldMatrix(B.Matrix.FromArray(group.models));material.albedoColor=new B.Color3(...group.linearColors.subarray(0,3));}
    meshes.push({mesh, group});
  }
  const settings = fixture.rendering, length = Math.hypot(...settings.sunDirection), direction = settings.sunDirection.map(value => value / length);
  const sun = new B.DirectionalLight('sun', new B.Vector3(...direction.map(value => -value)), scene);
  sun.position = new B.Vector3(direction[0] * 180, 4 + direction[1] * 180, direction[2] * 180);sun.diffuse = new B.Color3(1, .87, .72);sun.intensity = settings.sunIntensity;
  sun.autoCalcShadowZBounds = false;sun.autoUpdateExtends = false;sun.shadowMinZ = 1;sun.shadowMaxZ = 400;sun.shadowFrustumSize = settings.shadowExtent * 2;
  // Match production engine raster slope bias rather than compensating for a
  // large terrain with an arbitrary constant offset. Babylon's half-Z shader
  // factor maps API .00005 to a normalized depth offset of .000025.
  const shadows = new B.ShadowGenerator(2048, sun);shadows.bias = .00005;shadows.usePercentageCloserFiltering = true;shadows.filteringQuality = B.ShadowGenerator.QUALITY_MEDIUM;
  shadows.onBeforeShadowMapRenderMeshObservable.add(() => {engine.setZOffset(1.5);engine.setZOffsetUnits(1);});
  shadows.onAfterShadowMapRenderMeshObservable.add(() => {engine.setZOffset(0);engine.setZOffsetUnits(0);});
  for (const {mesh} of meshes) shadows.addShadowCaster(mesh);
  for (const entity of fixture.lights) {
    const source = entity.light, light = new B.PointLight(entity.id, new B.Vector3(...entity.position), scene);
    light.diffuse = new B.Color3(...source.color);light.intensity = source.intensity;light.range = source.range;
  }
  const setCamera = spec => {camera.position.set(...spec.position);camera.upVector.set(0, 1, 0);camera.setTarget(new B.Vector3(...spec.target));camera.fov = spec.fov * Math.PI / 180;camera.minZ = spec.near;camera.maxZ = spec.far;};
  setCamera(visibilityCamera(0));
  let post=null,bloomExecutions=0;
  if(profile==='common-bloom'){
    post=new B.DefaultRenderingPipeline('comparison.bloom',true,scene,[camera]);post.samples=1;post.fxaaEnabled=false;post.bloomScale=.25;post.bloomWeight=.46;post.bloomThreshold=1;post.bloomKernel=36;post.bloomEnabled=true;
    post.bloom._merge.onApplyObservable.add(()=>bloomExecutions++);
  }
  await scene.whenReadyAsync();
  const records=new Map(meshes.flatMap(record=>record.group.objects.map((object,index)=>[object.entity.id,{...record,index}])));
  return {
    updateInstances(changed){const touched=new Map();for(const item of changed){const record=records.get(item.object.entity.id),model=renderModel(item.object.entity);item.group.models.set(model,item.index*16);if(parameters.peerInstancing){record.mesh.thinInstanceSetMatrixAt(record.index,B.Matrix.FromArray(model),false);if(!touched.has(record.mesh))touched.set(record.mesh,[]);touched.get(record.mesh).push(record.index);}else record.mesh.freezeWorldMatrix(B.Matrix.FromArray(model));}for(const [mesh,indices] of touched){for(const run of instanceUpdateRuns(indices))mesh.thinInstancePartialBufferUpdate('matrix',run.count,run.start);mesh.thinInstanceRefreshBoundingInfo();}},
    render(spec) {setCamera(spec);engine.beginFrame();scene.render();engine.endFrame();},
    audit(spec) {
      setCamera(spec);
      return {objects: meshes.reduce((sum, {mesh}) => sum + (parameters.peerInstancing?mesh.thinInstanceCount:1), 0), modelMaxError: Math.max(...meshes.map(({mesh, group}) => matrixError(group.models, parameters.peerInstancing?mesh.thinInstanceGetWorldMatrices().flatMap(matrix => [...matrix.m]):mesh.getWorldMatrix().m))),
        geometryMaxError: Math.max(...meshes.flatMap(({mesh, group}) => [matrixError(group.positions, mesh.getVerticesData(B.VertexBuffer.PositionKind)), matrixError(group.normals, mesh.getVerticesData(B.VertexBuffer.NormalKind)), matrixError(group.indices, mesh.getIndices())])),
        viewMaxError: matrixError(fixture.view(spec), camera.getViewMatrix(true).m), projectionMaxError: matrixError(fixture.projection(spec, width / height), camera.getProjectionMatrix(true).m), backgroundObjectsExcludedFromAudit: 1};
    },
    inspect: () => ({backend: 'webgpu', meshes: scene.meshes.length, materials: scene.materials.length,comparisonEffects:sharedEffects(profile)?{...sharedEffects(profile),bloom:!!post?.bloomEnabled,samples:post?.samples??1,antiAliasing:post?.fxaaEnabled?'fxaa':'none'}:null,bloomExecutions,instancing:parameters.peerInstancing,bloomParameters:post?{threshold:post.bloomThreshold,strength:post.bloomWeight,resolutionScale:post.bloomScale,samples:post.samples,fxaa:post.fxaaEnabled}:null}),
    flush: () => engine._device.queue.onSubmittedWorkDone(),
    reset() {},
    dispose() {post?.dispose();scene.dispose();engine.dispose();},
  };
}
