import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve, extname } from 'node:path';
import { createHash } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { NativeRuntime } from './runtime.mjs';
import { demo } from './demo.mjs';
import { encodePNG, parseArgs, pixelEvidence } from './core.mjs';

const compiled = typeof __ENGINE_NATIVE_COMPILED__ !== 'undefined' && __ENGINE_NATIVE_COMPILED__;
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
async function save(path, bytes) { await mkdir(dirname(resolve(path)), { recursive: true }); await writeFile(path, bytes); }

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log(`The Engine native · Bun + SDL3 + Dawn (no browser)
  bun run native                         SDL3 window; WASD / Q,E; Escape closes
  bun run native --scene scene.json    existing procedural SceneSpec
  bun run native:headless --frames 60 --output frame.png
  --width 960 --height 540 --fps 60 --frames N --report report.json
  --backend auto|d3d12|vulkan|metal       explicit supported hardware backend
  --frames 0: interactive realtime; positive N: deterministic fixed steps
  Image materials, painted labels, Web Audio and DOM UI are not ported yet.`);
    return;
  }
  if (!process.versions.bun) throw new Error('This entrypoint requires Bun (not Node). Use bun run native.');
  const spec = options.scene ? JSON.parse(await readFile(resolve(options.scene), 'utf8')) : demo;
  let runtime, interrupted = false, first = null, last = null;
  const stop = () => { interrupted = true; };
  process.on('SIGINT', stop); process.on('SIGTERM', stop);
  try {
    runtime = await NativeRuntime.create(spec, { ...options, compiled });
    const initialSnapshot = structuredClone(runtime.scene.snapshot());
    console.log(JSON.stringify({ event: 'native-ready', ...runtime.inspect() }));
    while (!interrupted && !runtime.host.shouldClose && (!options.frames || runtime.frames < options.frames)) {
      const start = performance.now();
      const capture = Boolean(options.output) && (runtime.frames === 0 || runtime.frames + 1 === options.frames);
      const result = await runtime.frame({ steps: options.frames ? 1 : undefined, capture });
      if (result?.pixels) {
        const { rgba, width, height } = result.pixels;
        last = { ...pixelEvidence(rgba), sha256: hash(rgba), width, height, png: encodePNG(rgba, width, height) };
        first ??= last;
      }
      await delay(options.headless ? 0 : Math.max(1, 1000 / options.fps - (performance.now() - start)));
    }
    if (options.frames && runtime.frames !== options.frames) throw new Error(`Capture interrupted at frame ${runtime.frames}/${options.frames}`);
    if (options.output && !options.frames && runtime.frames) {
      const result = await runtime.frame({ steps: 0, capture: true });
      if (result?.pixels) {
        const { rgba, width, height } = result.pixels;
        last = { ...pixelEvidence(rgba), sha256: hash(rgba), width, height, png: encodePNG(rgba, width, height) };
      }
    }
    if (options.output && last) {
      await save(options.output, last.png);
      const extension = extname(options.output);
      const firstPath = `${options.output.slice(0, options.output.length - extension.length)}.first.png`;
      if (first) await save(firstPath, first.png);
    }
    const pixelSummary = item => item ? Object.fromEntries(Object.entries(item).filter(([key]) => key !== 'png')) : null;
    const report = { status: 'success', ...runtime.inspect(), bunVersion: process.versions.bun,
      compiled, initialSnapshot, finalSnapshot: runtime.scene.snapshot(), firstFrame: pixelSummary(first), lastFrame: pixelSummary(last),
      frameChanged: first && last ? first.sha256 !== last.sha256 : null };
    if (options.report) await save(options.report, JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report));
  } catch (error) {
    if (options.report) await save(options.report, JSON.stringify({ status: 'failed', message: String(error), stack: error.stack }, null, 2));
    throw error;
  } finally {
    process.removeListener('SIGINT', stop); process.removeListener('SIGTERM', stop);
    runtime?.close();
  }
}

try { await main(); }
catch (error) { console.error(error); process.exitCode = 1; }
finally {
  // Dawn's native instance can keep libuv alive until GC. All resources have
  // already been explicitly closed; the CLI has no remaining background work.
  globalThis.Bun?.gc(true);
  process.exit(process.exitCode ?? 0);
}
