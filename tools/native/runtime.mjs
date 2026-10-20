import { Scene } from '../../dist/scene/scene.js';
import { WebGPURenderer } from '../../dist/render/webgpu.js';
import { FixedClock } from '../../dist/core/fixed-clock.js';
import { assertNativeScene } from './core.mjs';
import { NativeHost } from './host.mjs';

/** Общие Scene, физика, fixed clock, WGSL и WebGPURenderer; меняется только host. */
export class NativeRuntime {
  static async create(spec, options) {
    const fps = options.fps ?? 60;
    if (!Number.isInteger(fps) || fps < 1 || fps > 240) throw new RangeError('Native tick rate must be an integer in [1, 240]');
    const scene = new Scene(structuredClone(spec));
    assertNativeScene(scene);
    const host = await NativeHost.create(options);
    let renderer;
    try {
      renderer = await WebGPURenderer.create(host.canvas, { profiling: false });
      renderer.setResolution(host.canvas.width, host.canvas.height);
      await renderer.prepareMaterials(scene);
      await renderer.flush();
      host.assertHealthy();
      return new NativeRuntime(scene, renderer, host, options.fps ?? 60);
    } catch (error) {
      try { renderer?.dispose(); } finally { host.close(); }
      throw error;
    }
  }

  constructor(scene, renderer, host, fps) {
    this.scene = scene; this.renderer = renderer; this.host = host;
    this.stepSeconds = 1 / fps; this.clock = new FixedClock(1000 / fps);
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
    try {
      if (!this.host.syncSize()) { this.clock.reset(performance.now()); return null; }
      if (steps === undefined) this.clock.advance(performance.now(), () => this.tick());
      else for (let i = 0; i < steps; i++) this.tick();
      assertNativeScene(this.scene);
      this.renderer.setResolution(this.host.canvas.width, this.host.canvas.height);
      this.renderer.setTimelineFrame(this.frames);
      this.renderer.render(this.scene);
      // The swapchain image must be copied BEFORE present, not after swap().
      const pixels = capture ? await this.host.captureRGBA() : null;
      await this.renderer.flush(); // bounds in-flight GPU work and surfaces validation errors
      this.host.assertHealthy();
      const stats = this.renderer.inspect();
      if (stats.errors.length) throw new Error(stats.errors.join('\n'));
      this.host.present(); this.frames++;
      return { pixels, stats };
    } finally { this.busy = false; }
  }

  inspect() {
    return { runtime: 'bun', browser: false, mode: this.host.options.headless ? 'headless' : 'window', adapter: this.host.adapterInfo,
      frames: this.frames, simulation: { tick: this.scene.tick, time: this.scene.time }, renderer: this.renderer.inspect() };
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    try { this.renderer.dispose(); } finally { this.host.close(); }
  }
}
