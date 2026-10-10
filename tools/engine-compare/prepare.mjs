#!/usr/bin/env node
// Extend a PINNED upstream checkout, preserving its shared Sim3D and harness.
// All WebGPU adapters run the SAME moving, tinted unit-cube fixture.
import {cp, copyFile, mkdir, readFile, writeFile} from 'node:fs/promises';
import {resolve, join} from 'node:path';
import {execFileSync} from 'node:child_process';

export const UPSTREAM = '2785ce1d4a0afdfff88d4d1f6863de9427f831f5';
const upstream = resolve(process.argv[2] ?? 'artifacts/engine-compare/upstream');
const actual = execFileSync('git', ['-C', upstream, 'rev-parse', 'HEAD'], {encoding: 'utf8'}).trim();
if (actual !== UPSTREAM) throw new Error('Upstream changed: ' + actual);
const here = resolve('tools/engine-compare');
await mkdir(join(upstream, 'rom4'), {recursive: true});
await cp(resolve('dist'), join(upstream, 'rom4/dist'), {recursive: true, force: true});
await copyFile(resolve('kernels/bench-motion/target/wasm32-unknown-unknown/release/engine_bench_motion.wasm'),
  join(upstream, 'rom4/bench_motion.wasm'));
await copyFile(join(here, 'rom4-scene.mjs'), join(upstream, 'scenes/cubes/rom4-scene.mjs'));
await copyFile(join(here, 'rom4-motion.mjs'), join(upstream, 'scenes/cubes/rom4-motion.mjs'));
for (const backend of ['js', 'rust'])
  await writeFile(join(upstream, 'scenes/cubes/rom4-' + backend + '.js'),
    "import {createRom4Scene} from './rom4-scene.mjs';\nexport default createRom4Scene('" + backend + "');\n");

// Preserve the upstream per-mesh Three.js test but switch its rendering backend
// to WebGPU, matching the already-provided upstream Three instanced WebGPU test.
let three = await readFile(join(upstream, 'scenes/cubes/three-mesh.js'), 'utf8');
if (!three.includes("from 'three'") ||
    !three.includes('new THREE.WebGLRenderer({ antialias: false })'))
  throw new Error('Pinned Three.js source mismatch');
three = three.replace("from 'three'", "from 'three/webgpu'");
three = three.replace('new THREE.WebGLRenderer({ antialias: false })',
  "new THREE.WebGPURenderer({ antialias: false, alpha: false });\n" +
  "    await renderer.init();\n" +
  "    if (!renderer.backend.isWebGPUBackend) throw new Error('Three.js WebGPU fallback forbidden')");
three = three.replace("variant: 'mesh'", "variant: 'mesh-webgpu'");
await writeFile(join(upstream, 'scenes/cubes/three-mesh-webgpu.js'), three);

// Babylon reference scenes are also preserved except device backend, which
// is switched from WebGL2 to WebGPU for an apples-to-apples API comparison.
const original = 'engine = new BABYLON.Engine(canvas, false, { doNotHandleContextLost: true, stencil: false }, false);';
for (const [source, dest, variantFrom, variantTo] of [
  ['babylon-instances.js', 'babylon-instances-webgpu.js', "variant: 'instances'", "variant: 'instances-webgpu'"],
  ['babylon-thin.js', 'babylon-thin-webgpu.js', "variant: 'thin-instances'", "variant: 'thin-instances-webgpu'"]
]) {
  let content = await readFile(join(upstream, 'scenes/cubes', source), 'utf8');
  if (!content.includes(original) || !content.includes(variantFrom))
    throw new Error('Pinned Babylon.js source mismatch: ' + source);
  content = content.replace(original,
    "engine = new BABYLON.WebGPUEngine(canvas, { antialias: false, adaptToDeviceRatio: false });\n" +
    "  await engine.initAsync();");
  content = content.replace(variantFrom, variantTo);
  // Babylon WebGPU requires frame boundaries for manual scene.render() calls.
  // runRenderLoop normally inserts these; the upstream benchmark owns RAF.
  const bareRenders = content.split('scene.render();').length - 1;
  if (bareRenders < 2) throw new Error('Expected Babylon warm and frame render calls');
  content = content.replaceAll('scene.render();',
    'engine.beginFrame(); scene.render(); engine.endFrame();');
  await writeFile(join(upstream, 'scenes/cubes', dest), content);
}

// Replace checker atlas with one opaque white texel for ALL engines. The
// original seeded simulation, unit cube and tint stay unchanged. Lighting
// paths remain engine-specific, so strict pixel equality is not asserted.
const whitePng = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4////fwAJ+wP9KobjigAAAABJRU5ErkJggg==';
await writeFile(join(upstream, 'assets/atlas.png'), Buffer.from(whitePng, 'base64'));
await copyFile(join(here, 'run.mjs'), join(upstream, 'tools/rom4-run.mjs'));
console.log('Prepared six WebGPU adapters, upstream SHA=' + UPSTREAM);
