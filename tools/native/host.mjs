import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dimensions, hardwareInfo, installNativeGlobals, readbackLayout, unpackRGBA } from './core.mjs';
import { prepareWindowsDawn, verifyWindowsDawn } from './windows-napi.mjs';

/** Native addons остаются внешними файлами рядом с compiled executable. */
export function loadBindings(headless, compiled = false) {
  const require = createRequire(compiled
    ? join(dirname(process.execPath), 'runtime', 'package.json')
    : new URL('./package.json', import.meta.url));
  try {
    // Compiled Bun can fail bare-package resolution outside its embedded FS.
    // Resolve the pinned package's physical entry before loading its addon.
    const load = name => {
      if (!compiled) return require(name);
      const folder = join(dirname(process.execPath), 'runtime', 'node_modules', name);
      const metadata = JSON.parse(readFileSync(join(folder, 'package.json'), 'utf8'));
      return require(join(folder, metadata.main));
    };
    let gpu, compatibility = null;
    if (process.platform === 'win32') {
      const nativeDir = compiled ? join(dirname(process.execPath), 'runtime') : fileURLToPath(new URL('.', import.meta.url));
      const addon = join(nativeDir, 'node_modules', '@kmamal', 'gpu', 'dist', 'dawn.node');
      const prepared = compiled ? join(nativeDir, 'dawn-bun.node') : join(nativeDir, '.runtime', basename(process.execPath) + '.node');
      const metadata = compiled ? verifyWindowsDawn(prepared, process.execPath) : prepareWindowsDawn(addon, process.execPath, prepared);
      const raw = require(prepared);
      gpu = { ...raw, ...raw.globals };
      compatibility = { kind: 'windows-napi-import', version: metadata.version, hostName: metadata.hostName,
        sourceSha256: metadata.sourceSha256, sha256: metadata.sha256 };
    } else gpu = load('@kmamal/gpu');
    const sdl = headless ? null : load('@kmamal/sdl');
    return { gpu: gpu.default ?? gpu, sdl: sdl?.default ?? sdl, compatibility };
  } catch (cause) {
    throw new Error(`Native addons could not be loaded: ${cause?.message ?? String(cause)}. Run "bun run native:setup", or keep the executable beside its runtime/ directory.`, { cause });
  }
}

/** SDL3 window / offscreen GPU texture. Ни браузера, ни CPU rasterizer. */
export class NativeHost {
  static async create(options, bindings = loadBindings(options.headless, options.compiled)) {
    dimensions(options.width, options.height);
    const host = new NativeHost(options, bindings);
    try { await host.initialize(); return host; }
    catch (error) { host.close(); throw error; }
  }

  constructor(options, bindings) {
    this.options = options; this.bindings = bindings;
    this.device = null; this.window = null; this.surface = null; this.instance = null;
    this.target = null; this.frameTexture = null; this.targetSize = '';
    this.restoreGlobals = null; this.listeners = []; this.errors = []; this.keys = new Set();
    this.closed = false; this.shouldClose = false; this.resizePending = false;
    this.format = 'bgra8unorm';
    const host = this;
    this.canvas = {
      width: options.width, height: options.height,
      get clientWidth() { return host.canvas.width; },
      get clientHeight() { return host.canvas.height; },
      getContext(kind) { return kind === 'webgpu' ? host.context : null; },
    };
    this.context = {
      configure({ device, format }) {
        if (host.device !== device || format !== host.format) throw new Error('Native WebGPU device/format mismatch');
        if (host.window) {
          host.surface = host.bindings.gpu.renderGPUDeviceToWindow({
            device, window: host.window, format, presentMode: 'fifo', usage: 0x10 | 0x01,
          });
          if (host.surface.getPreferredFormat() !== format) throw new Error('Unexpected native surface format');
        }
      },
      getCurrentTexture() { return host.currentTexture(); },
    };
  }

  async initialize() {
    const platform = process.platform;
    const backend = platform === 'win32' ? 'd3d12' : platform === 'darwin' ? 'metal' : 'vulkan';
    this.instance = this.bindings.gpu.create([`backend=${backend}`]);
    const adapter = await this.instance.requestAdapter({ powerPreference: 'high-performance', forceFallbackAdapter: false });
    if (!adapter) throw new Error(`No native ${backend} GPU adapter`);
    this.adapterInfo = { ...hardwareInfo(adapter), backend };
    if (!this.options.headless) {
      this.window = this.bindings.sdl.video.createWindow({
        title: 'The Engine · Bun / SDL3 / Dawn', width: this.options.width, height: this.options.height,
        resizable: true, webgpu: true,
      });
      this.listen('beforeClose', event => { event.prevent(); this.shouldClose = true; });
      this.listen('close', () => { this.shouldClose = true; });
      this.listen('resize', () => { this.resizePending = true; });
      this.listen('keyDown', event => {
        const key = String(event.key ?? '').toLowerCase();
        if (key === 'escape') this.shouldClose = true;
        else this.keys.add(key);
      });
      this.listen('keyUp', event => this.keys.delete(String(event.key ?? '').toLowerCase()));
      this.listen('blur', () => this.keys.clear());
      dimensions(this.window.pixelWidth, this.window.pixelHeight);
      this.canvas.width = this.window.pixelWidth; this.canvas.height = this.window.pixelHeight;
    }
    // Existing renderer uses navigator.gpu only for device creation. No DOM shim.
    const gpuPort = {
      getPreferredCanvasFormat: () => this.format,
      requestAdapter: async () => ({
        features: adapter.features,
        requestDevice: async descriptor => {
          if (this.device) throw new Error('Native host already owns a GPU device');
          this.device = await adapter.requestDevice(descriptor ?? {});
          this.device.addEventListener?.('uncapturederror', event => this.errors.push(event.error?.message ?? String(event.error)));
          this.device.lost?.then(info => { if (!this.closed) this.errors.push(`GPU device lost: ${info.message ?? info.reason}`); });
          return this.device;
        },
      }),
    };
    this.restoreGlobals = installNativeGlobals(gpuPort);
  }

  listen(event, callback) {
    this.window.on(event, callback); this.listeners.push([event, callback]);
  }

  /** Нулевой размер/minimize не передаётся в GPU configure. */
  syncSize() {
    if (!this.window) return true;
    if (this.window.destroyed) { this.shouldClose = true; return false; }
    const { pixelWidth: width, pixelHeight: height } = this.window;
    if (width < 1 || height < 1 || this.window.minimized) return false;
    dimensions(width, height);
    if (width !== this.canvas.width || height !== this.canvas.height || this.resizePending) {
      this.canvas.width = width; this.canvas.height = height;
      this.surface?.resize(); this.frameTexture = null; this.resizePending = false;
    }
    return true;
  }

  currentTexture() {
    this.assertHealthy();
    if (!this.device) throw new Error('Native device has not been configured');
    if (this.frameTexture) return this.frameTexture;
    if (this.surface) return this.frameTexture = this.surface.getCurrentTexture();
    if (this.window) throw new Error('Native window surface has not been configured');
    const { width, height } = this.canvas;
    dimensions(width, height);
    const size = `${width}x${height}`;
    if (!this.target || size !== this.targetSize) {
      this.target?.destroy();
      this.target = this.device.createTexture({ label: 'native offscreen output', size: [width, height], format: this.format, usage: 0x10 | 0x01 });
      this.targetSize = size;
    }
    return this.frameTexture = this.target;
  }

  /** Readback только по явному запросу; обычный present остаётся GPU → window. */
  async captureRGBA() {
    this.assertHealthy();
    if (!this.frameTexture) throw new Error('Render a frame before capturing it');
    const { width, height } = this.canvas, { bytesPerRow, size } = readbackLayout(width, height);
    const buffer = this.device.createBuffer({ label: 'native readback', size, usage: 0x01 | 0x08 });
    let mapped = false;
    try {
      const encoder = this.device.createCommandEncoder();
      encoder.copyTextureToBuffer({ texture: this.frameTexture }, { buffer, bytesPerRow, rowsPerImage: height }, [width, height, 1]);
      this.device.queue.submit([encoder.finish()]);
      await buffer.mapAsync(1); mapped = true;
      const rgba = unpackRGBA(new Uint8Array(buffer.getMappedRange()), width, height, this.format);
      this.assertHealthy();
      return { rgba, width, height };
    } finally { if (mapped) buffer.unmap(); buffer.destroy(); }
  }

  present() {
    this.assertHealthy();
    if (!this.frameTexture) throw new Error('No rendered native frame to present');
    this.surface?.swap(); this.frameTexture = null;
  }

  assertHealthy() {
    if (this.closed) throw new Error('Native host is closed');
    if (this.errors.length) throw new Error(this.errors.join('\n'));
  }

  close() {
    if (this.closed) return;
    this.closed = true; this.shouldClose = true; this.keys.clear();
    // A Dawn surface must be released BEFORE destroying its SDL window.
    try { this.target?.destroy(); this.device?.destroy(); }
    finally {
      this.target = null; this.frameTexture = null; this.device = null; this.surface = null;
      try {
        for (const [event, callback] of this.listeners) this.window?.removeListener(event, callback);
        this.listeners.length = 0;
        if (this.window && !this.window.destroyed) this.window.destroy();
      } finally {
        this.window = null; this.instance = null;
        this.restoreGlobals?.(); this.restoreGlobals = null;
      }
    }
  }
}
