#!/usr/bin/env node
// Extend the pinned MIT upstream harness, preserving its seeded Sim3D/loop.
import { cp, copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { execFileSync } from 'node:child_process';

export const UPSTREAM = '2785ce1d4a0afdfff88d4d1f6863de9427f831f5';
const upstream = resolve(process.argv[2] ?? 'artifacts/engine-compare/upstream');
const actual = execFileSync('git', ['-C', upstream, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
if (actual !== UPSTREAM) throw new Error('Upstream changed: expected ' + UPSTREAM + ' got ' + actual);
const here = resolve('tools/engine-compare');
await mkdir(join(upstream, 'rom4'), { recursive: true });
await cp(resolve('dist'), join(upstream, 'rom4/dist'), { recursive: true, force: true });
await copyFile(resolve('kernels/bench-motion/target/wasm32-unknown-unknown/release/engine_bench_motion.wasm'), join(upstream, 'rom4/bench_motion.wasm'));
await copyFile(join(here, 'rom4-scene.mjs'), join(upstream, 'scenes/cubes/rom4-scene.mjs'));
await copyFile(join(here, 'rom4-motion.mjs'), join(upstream, 'scenes/cubes/rom4-motion.mjs'));
for (const backend of ['js', 'rust']) {
  await writeFile(join(upstream, 'scenes/cubes/rom4-' + backend + '.js'),
    "import {createRom4Scene} from './rom4-scene.mjs';\nexport default createRom4Scene('" + backend + "');\n");
}
// Both ordinary individual meshes and optimized instances use WebGPU.
let threeMesh = await readFile(join(upstream, 'scenes/cubes/three-mesh.js'), 'utf8');
const threeRenderer = 'new THREE.WebGLRenderer({ antialias: false })';
if (!threeMesh.includes("from 'three'") || !threeMesh.includes(threeRenderer))
  throw new Error('Pinned Three mesh source no longer matches');
threeMesh = threeMesh.replace("from 'three'", "from 'three/webgpu'");
threeMesh = threeMesh.replace(threeRenderer,
  "new THREE.WebGPURenderer({ antialias: false, alpha: false });\n" +
  "    await renderer.init();\n" +
  "    if (!renderer.backend.isWebGPUBackend) throw new Error('WebGPU fallback forbidden')");
threeMesh = threeMesh.replace("variant: 'mesh'", "variant: 'mesh-webgpu'");
await writeFile(join(upstream, 'scenes/cubes/three-mesh-webgpu.js'), threeMesh);

// Adapt existing Babylon thin + per-object instances to WebGPUEngine.
const original = 'engine = new BABYLON.Engine(canvas, false, { doNotHandleContextLost: true, stencil: false }, false);';
for (const [name,variant] of [
  ['babylon-thin', 'thin-instances-webgpu'],
  ['babylon-instances', 'instances-webgpu']
]) {
  let source = await readFile(join(upstream, 'scenes/cubes/' + name + '.js'), 'utf8');
  if (!source.includes(original)) throw new Error('Pinned Babylon source changed: ' + name);
  source = source.replace(original,
    'engine = new BABYLON.WebGPUEngine(canvas, { antialias: false, adaptToDeviceRatio: false });\n  await engine.initAsync();');
  const before = name === 'babylon-thin' ? "variant: 'thin-instances'" : "variant: 'instances'";
  source = source.replace(before, "variant: '" + variant + "'");
  await writeFile(join(upstream, 'scenes/cubes/' + name + '-webgpu.js'), source);
}
// Identical opaque white texel replaces upstream checker for ALL variants.
const whitePng = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4////fwAJ+wP9KobjigAAAABJRU5ErkJggg==';
await writeFile(join(upstream, 'assets/atlas.png'), Buffer.from(whitePng, 'base64'));
await copyFile(join(here, 'run.mjs'), join(upstream, 'tools/rom4-run.mjs'));
console.log('Prepared 6-way cube benchmark from upstream ' + UPSTREAM);
