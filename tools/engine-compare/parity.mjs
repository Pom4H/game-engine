#!/usr/bin/env node
// Pinned upstream Sim3D is the JS oracle. Rust stores the SAME SoA arrays
// directly in WebAssembly memory, with reference JS spawn/PRNG untouched.
import assert from 'node:assert/strict';
import {readFile, mkdir, writeFile} from 'node:fs/promises';
import {join, resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {useRustMotion, FIELDS, RUST_CAPACITY} from './rom4-motion.mjs';

const upstream = resolve(process.argv[2] ?? 'artifacts/engine-compare/upstream');
const {Sim3D} = await import(pathToFileURL(join(upstream, 'harness/sim.js')).href);
const bytes = await readFile(resolve('kernels/bench-motion/target/wasm32-unknown-unknown/release/engine_bench_motion.wasm'));
const tests = [];
for (const n of [1, 128, 2000, 10000]) {
  assert.ok(n <= RUST_CAPACITY);
  const js = new Sim3D(1), rust = new Sim3D(1);
  await useRustMotion(rust, bytes);
  js.setCount(n);
  rust.setCount(n);
  for (const field of FIELDS)
    for (let i = 0; i < n; i++)
      assert.equal(rust[field][i], js[field][i], 'spawn ' + field + '[' + i + ']');
  let maxError = 0;
  for (let tick = 0; tick < 120; tick++) {
    js.update();
    rust.update();
    for (const field of FIELDS) {
      for (let i = 0; i < n; i++) {
        const a = js[field][i], b = rust[field][i];
        assert.ok(Number.isFinite(b), 'Non-finite ' + field + '[' + i + ']');
        const error = Math.abs(a - b);
        maxError = Math.max(maxError, error);
        assert.ok(error <= 1e-6 + Math.abs(a) * 1e-7,
          'Numerical drift n=' + n + ' tick=' + tick +
          ' field=' + field + '[' + i + '] JS=' + a + ' Rust=' + b);
      }
    }
  }
  tests.push({count: n, ticks: 120, maxError});
}
const output = resolve('artifacts/engine-compare');
await mkdir(output, {recursive: true});
await writeFile(join(output, 'parity.json'), JSON.stringify({
  schema: 1, source: 'KilledByAPixel/webgl-engine-bench @ 2785ce1d4a0afdfff88d4d1f6863de9427f831f5',
  method: 'Upstream seeded Sim3D spawn, 60Hz bouncing cubes, JS oracle vs Rust/WASM persistent f32 SoA',
  tests
}, null, 2) + '\n');
console.log('RUST_MOTION_PARITY_PASS=' + JSON.stringify(tests));
