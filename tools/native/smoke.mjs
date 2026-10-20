import { spawn } from 'node:child_process';
import { readFile, mkdir } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const root = fileURLToPath(new URL('../../', import.meta.url));
const out = resolve(root, 'artifacts/native');
await mkdir(out, { recursive: true });
const compiled = process.argv.includes('--compiled');
const executable = compiled ? resolve(root, `artifacts/native-app/the-engine${process.platform === 'win32' ? '.exe' : ''}`) : process.execPath;
const prefix = compiled ? [] : [resolve(root, 'tools/native/main.mjs')];
async function run(mode) {
  const name = `${compiled ? 'compiled-' : ''}${mode}`;
  const reportPath = resolve(out, `${name}.json`), imagePath = resolve(out, `${name}.png`);
  const args = [...prefix, ...(mode === 'headless' ? ['--headless'] : []), '--width', '320', '--height', '180', '--frames', '24', '--output', imagePath, '--report', reportPath];
  await new Promise((resolveRun, reject) => {
    // A different cwd also verifies that compiled addons are located relative
    // to the executable, not accidentally in the development node_modules.
    const child = spawn(executable, args, { cwd: compiled ? dirname(out) : root, stdio: 'inherit', shell: false });
    const timer = setTimeout(() => { child.kill(); reject(new Error(`${name} did not finish within 180 seconds`)); }, 180000);
    child.once('error', error => { clearTimeout(timer); reject(error); });
    child.once('exit', (code, signal) => { clearTimeout(timer); code === 0 ? resolveRun() : reject(new Error(`${name} exited with ${code ?? signal}`)); });
  });
  const report = JSON.parse(await readFile(reportPath, 'utf8'));
  assert.equal(report.status, 'success'); assert.equal(report.browser, false);
  assert.equal(report.runtime, 'bun'); assert.ok(report.bunVersion);
  assert.equal(report.compiled, compiled); assert.equal(report.mode, mode);
  assert.equal(report.frames, 24); assert.equal(report.simulation.tick, 24);
  assert.equal(report.renderer.backend, 'webgpu'); assert.equal(report.adapter.isFallbackAdapter, false);
  assert.ok(report.renderer.drawCalls > 0); assert.ok(report.renderer.triangles > 0);
  assert.deepEqual(report.renderer.errors, []);
  assert.equal(report.firstFrame.nonUniform, true); assert.equal(report.lastFrame.nonUniform, true);
  assert.equal(report.frameChanged, true);
  const firstY = report.initialSnapshot.entities.find(entity => entity.id === 'falling-sphere').position[1];
  const lastY = report.finalSnapshot.entities.find(entity => entity.id === 'falling-sphere').position[1];
  assert.ok(firstY - lastY > 0.1, 'Shared Scene physics must move the sphere, not only the temporal shader jitter');
  assert.notEqual(report.firstFrame.sha256, report.lastFrame.sha256);
  const png = await readFile(imagePath);
  assert.deepEqual([...png.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  console.log(`PASS ${name}: ${report.adapter.description || report.adapter.device}, ${report.renderer.triangles} triangles`);
}
await run('headless');
await run('window');
