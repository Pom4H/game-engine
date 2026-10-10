// Adapter to the MIT webgl-engine-bench cube contract.
// JS and Rust variants BOTH use production ROM4 WebGPURenderer.
// Rust changes only the upstream simulation's numeric update() routine.
import {BrowserRuntime} from '../../rom4/dist/runtime/browser.js';
import {useRustMotion, RUST_CAPACITY} from './rom4-motion.mjs';

const WIDTH = 1280, HEIGHT = 720;
const mesh = Object.freeze({kind: 'box', size: [1, 1, 1]});
const camera = Object.freeze({position: [0, 0, 40], target: [0, 0, 0], fov: 60});

// Upstream Three/Babylon cubes use Euler 'YXZ' (Ry * Rx * Rz), whereas
// ROM4 compose() uses Rx * Ry * Rz. Convert without altering orientation.
function referenceToEngineEuler(rx, ry, rz) {
  const sx = Math.sin(rx), cx = Math.cos(rx);
  const sy = Math.sin(ry), cy = Math.cos(ry);
  const sz = Math.sin(rz), cz = Math.cos(rz);
  return [
    Math.atan2(sx, cy * cx),
    Math.asin(Math.max(-1, Math.min(1, sy * cx))),
    Math.atan2(cy * sz - sy * sx * cz, cy * cz + sy * sx * sz)
  ];
}

function baseScene() {
  return {
    version: 1, seed: 1, clearColor: [0, 0, 0, 1],
    entities: [], camera,
    rendering: {
      skyColor: [0, 0, 0], sunColor: [1, 1, 1],
      sunDirection: [-0.3, 1, 0.5], sunIntensity: 1.8,
      fogDensity: 0, exposure: 1
    }
  };
}

export function createRom4Scene(backend) {
  if (backend !== 'js' && backend !== 'rust') throw new Error('Unknown backend ' + backend);
  let runtime, sim, requested = 0, count = 0, epoch = 0;
  const names = [], active = [];

  function resizeEntities() {
    if (requested === count) return;
    const scene = runtime.scene;
    if (requested < count) {
      for (let i = requested; i < count; i++) scene.remove(names[i]);
      active.length = requested;
    } else {
      const movers = [];
      for (let i = count; i < requested; i++) {
        const id = names[i] ??= 'bench-cube-' + i;
        active[i] = scene.add({
          id, renderOnly: true, mesh,
          position: [sim.x[i], sim.y[i], sim.z[i]],
          rotation: referenceToEngineEuler(sim.rx[i], sim.ry[i], sim.rz[i]),
          material: {
            kind: 'steel',
            color: [sim.r[i], sim.g[i], sim.b[i], 1],
            roughness: 1, metalness: 0
          }
        });
        movers.push(id);
      }
      if (movers.length) {
        const id = 'bench-movers-' + epoch++;
        // Procedural projections move without creating fake collision bodies.
        scene.usePlugin({
          id, renderMovers: movers,
          modules: [{
            id: id + '-marker', phase: 'simulate', rateHz: 60,
            reads: [], writes: [], context: 'none', run: () => []
          }]
        });
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
      if (runtime.renderer.inspect().backend !== 'webgpu')
        throw new Error('ROM4 WebGPU hardware renderer required');
    },
    setCount(n) {
      if (!Number.isInteger(n) || n < 0 || n > RUST_CAPACITY)
        throw new RangeError('Benchmark object capacity exceeded: ' + n);
      requested = n;
      // The upstream loop calls sim.setCount AFTER this method.
      // Spawn tint is read on the FIRST frame, after reference seeding.
    },
    frame() {
      resizeEntities();
      for (let i = 0; i < count; i++) {
        const entity = active[i];
        entity.position[0] = sim.x[i]; entity.position[1] = sim.y[i]; entity.position[2] = sim.z[i];
        const euler = referenceToEngineEuler(sim.rx[i], sim.ry[i], sim.rz[i]);
        entity.rotation[0] = euler[0];
        entity.rotation[1] = euler[1];
        entity.rotation[2] = euler[2];
      }
      const stats = runtime.render();
      if (stats.errors.length) throw new Error('ROM4 render errors: ' + stats.errors.join('; '));
    }
  };
}
