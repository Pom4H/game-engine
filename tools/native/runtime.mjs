import { Scene } from '../../dist/scene/scene.js';
import { WebGPURenderer } from '../../dist/render/webgpu.js';
import { FixedClock } from '../../dist/core/fixed-clock.js';
import { assertNativeScene } from './core.mjs';
import { NativeHost } from './host.mjs';
import { GPUFrameQueue } from './frame-queue.mjs';
import { NativeEnvironmentWorker, nativeEnvironmentEntry } from './environment-worker.mjs';

/** Общие Scene, физика, fixed clock, WGSL и WebGPURenderer; меняется только host. */
export class NativeRuntime {
  static async create(spec, options) {
    const fps = options.fps ?? 60;
    if (!Number.isInteger(fps) || fps < 1 || fps > 240) throw new RangeError('Native tick rate must be an integer in [1, 240]');
    const scene = new Scene(structuredClone(spec));
    assertNativeScene(scene);
    const host = await NativeHost.create(options);
    let renderer, environmentWorker;
    try {
      renderer = await WebGPURenderer.create(host.canvas, { profiling: false });
      renderer.setBackgroundEnvironmentMaps(true, () => environmentWorker = new NativeEnvironmentWorker(nativeEnvironmentEntry(options.compiled), error => host.errors.push(error.message)));
      if (renderer.inspect().environmentBaking?.failed) throw new Error('Native environment worker could not be created');
      renderer.setResolution(host.canvas.width, host.canvas.height);
      await renderer.prepareMaterials(scene);
      await renderer.flush();
      host.assertHealthy();
      const runtime = new NativeRuntime(scene, renderer, host, options.fps ?? 60);
      runtime.environmentWorker = environmentWorker;
      return runtime;
    } catch (error) {
      try { renderer?.dispose(); await environmentWorker?.termination; } finally { host.close(); }
      throw error;
    }
  }

  constructor(scene, renderer, host, fps) {
    this.scene = scene; this.renderer = renderer; this.host = host;
    this.stepSeconds = 1 / fps; this.clock = new FixedClock(1000 / fps);
    this.gpuFrames = new GPUFrameQueue(host.device, 2);
    this.clock.reset(performance.now()); this.frames = 0; this.busy = false; this.closed = false;
  }

  tick() {
    this.moveCamera();
    this.scene.step(this.stepSeconds);
    // Native audio is not implemented yet; drain bounded event queues explicitly.
    this.scene.drainEvents(); this.scene.contacts.drainFootsteps();
  }

  moveCamera() {
    const keys = this.host.keys;
    if (!keys.size) return;
    const camera = this.scene.camera, p = camera.position, t = camera.target;
    const length = Math.hypot(t[0] - p[0], t[2] - p[2]) || 1;
    const f = [(t[0] - p[0]) / length, 0, (t[2] - p[2]) / length], r = [-f[2], 0, f[0]];
    const forward = Number(keys.has('w')) - Number(keys.has('s'));
    const right = Number(keys.has('d')) - Number(keys.has('a'));
    const up = Number(keys.has('e')) - Number(keys.has('q'));
    const normalizer = Math.max(1, Math.hypot(forward, right, up));
    const speed = 5 * this.stepSeconds / normalizer;
    const delta = [(f[0] * forward + r[0] * right) * speed, up * speed, (f[2] * forward + r[2] * right) * speed];
    this.scene.setCamera({ ...camera, position: p.map((v, i) => v + delta[i]), target: t.map((v, i) => v + delta[i]) });
  }

  /** steps задан для детерминированного offline capture; иначе — общий FixedClock. */
  async frame({ steps, capture = false } = {}) {
    if (this.closed) throw new Error('Native runtime is closed');
    if (this.busy) throw new Error('Native frames must not overlap');
    if (steps !== undefined && (!Number.isInteger(steps) || steps < 0 || steps > 1000)) throw new RangeError('steps must be in [0, 1000]');
    this.busy = true;
    this.frameDone = new Promise(resolve => { this.finishFrame = resolve; });
    try {
      if (this.host.needsResize()) await this.gpuFrames.drain();
      if (!this.host.syncSize()) { this.clock.reset(performance.now()); return null; }
      await this.gpuFrames.acquire();
      if (this.closed) return null;
      if (steps === undefined) this.clock.advance(performance.now(), () => this.tick());
      else for (let i = 0; i < steps; i++) this.tick();
      assertNativeScene(this.scene);
      this.renderer.setResolution(this.host.canvas.width, this.host.canvas.height);
      this.renderer.setTimelineFrame(this.frames);
      this.renderer.render(this.scene);
      this.gpuFrames.submittedFrame();
      // The swapchain image must be copied BEFORE present, not after swap().
      const pixels = capture ? await this.host.captureRGBA() : null;
      if (capture) { await this.gpuFrames.drain(); await this.renderer.flush(); }
      this.host.assertHealthy();
      const stats = this.renderer.inspect();
      if (stats.errors.length) throw new Error(stats.errors.join('\n'));
      this.host.present(); this.frames++;
      return { pixels, stats };
    } finally { this.busy = false; this.finishFrame(); this.frameDone = null; }
  }

  inspect() {
    return { runtime: 'bun', browser: false, mode: this.host.options.headless ? 'headless' : 'window', adapter: this.host.adapterInfo,
      nativeBinding: this.host.bindings.compatibility ?? null,
      frames: this.frames, gpuQueue: this.gpuFrames.inspect(), environmentWorker: this.environmentWorker?.inspect(), simulation: { tick: this.scene.tick, time: this.scene.time }, renderer: this.renderer.inspect() };
  }

  close() {
    if (this.closePromise) return this.closePromise;
    this.closed = true;
    return this.closePromise = this.closeResources();
  }
  async closeResources() {
    try { await this.frameDone; await this.gpuFrames.drain(); await this.renderer.flush(); }
    finally {
      try { this.renderer.dispose(); await this.environmentWorker?.termination; }
      finally { this.host.close(); }
    }
  }
}
