// Adapter to upstream deterministic cubes, using the PRODUCTION ROM4 renderer.
import { BrowserRuntime } from '../../rom4/dist/runtime/browser.js';
import { useRustMotion, RUST_CAPACITY } from './rom4-motion.mjs';
const WIDTH = 1280, HEIGHT = 720;
const mesh = Object.freeze({ kind: 'box', size: [1, 1, 1] });
const camera = Object.freeze({ position: [0, 0, 40], target: [0, 0, 0], fov: 60 });
function baseScene() {
  return {
    version: 1, seed: 1, clearColor: [0, 0, 0, 1],
    entities: [], camera,
    rendering: { skyColor: [0, 0, 0], sunColor: [1, 1, 1],
      sunDirection: [-0.3, 1, 0.5], sunIntensity: 1.8, fogDensity: 0, exposure: 1 }
  };
}
export function createRom4Scene(backend) {
  if (backend !== 'js' && backend !== 'rust') throw new Error('Unknown backend: ' + backend);
  let runtime, sim, requested = 0, count = 0, epoch = 0;
  const names = [], actual = [];
  function resizeEntities() {
    if (requested === count) return;
    const scene = runtime.scene;
    if (requested < count) {
      for (let i = requested; i < count; i++) scene.remove(names[i]);
      actual.length = requested;
    } else {
      const movers = [];
      for (let i = count; i < requested; i++) {
        const id = names[i] ??= 'bench-cube-' + i;
        actual[i] = scene.add({ id, renderOnly: true, mesh,
          position: [sim.x[i], sim.y[i], sim.z[i]],
          rotation: [sim.rx[i], sim.ry[i], sim.rz[i]],
          material: { kind: 'steel', color: [sim.r[i], sim.g[i], sim.b[i], 1],
            roughness: 1, metalness: 0 } });
        movers.push(id);
      }
      if (movers.length) {
        const id = 'benchmark-movers-' + epoch++;
        // Mark dynamic visual projections without introducing fake rigid bodies.
        scene.usePlugin({ id, renderMovers: movers,
          modules: [{ id: id + '-marker', phase: 'simulate', rateHz: 60,
            reads: [], writes: [], context: 'none', run: () => [] }] });
      }
    }
    count = requested;
  }
  return {
    engine: 'rom4', variant: backend + '-motion-webgpu',
    async init(root, simulation) {
      sim = simulation;
      if (backend === 'rust') await useRustMotion(sim);
      const canvas = document.createElement('canvas');
      canvas.width = WIDTH; canvas.height = HEIGHT;
      root.appendChild(canvas);
      runtime = await BrowserRuntime.create(canvas, baseScene(), {
        autoplay: false, audio: false, exposeBridge: false,
        resolution: [WIDTH, HEIGHT], profiling: true
      });
      if (runtime.renderer.inspect().backend !== 'webgpu') throw new Error('Hardware WebGPU required');
    },
    setCount(n) {
      if (!Number.isInteger(n) || n < 0 || n > RUST_CAPACITY)
        throw new RangeError('ROM4 cube count out of range: ' + n);
      requested = n; // upstream calls sim.setCount after this method
    },
    frame() {
      resizeEntities();
      for (let i = 0; i < count; i++) {
        const e = actual[i];
        e.position[0] = sim.x[i]; e.position[1] = sim.y[i]; e.position[2] = sim.z[i];
        e.rotation[0] = sim.rx[i]; e.rotation[1] = sim.ry[i]; e.rotation[2] = sim.rz[i];
      }
      const stats = runtime.render();
      if (stats.errors.length) throw new Error('ROM4 render: ' + stats.errors.join('; '));
    }
  };
}
