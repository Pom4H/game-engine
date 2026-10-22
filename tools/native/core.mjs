import { deflateSync } from 'node:zlib';

/** Explicit backends never silently fall back to another graphics API. */
export function resolveBackend(requested = 'auto', platform = process.platform) {
  const supported = platform === 'win32' ? ['d3d12', 'vulkan'] : platform === 'darwin' ? ['metal'] : platform === 'linux' ? ['vulkan'] : [];
  if (!['auto', 'd3d12', 'vulkan', 'metal'].includes(requested)) throw new RangeError('GPU backend must be auto, d3d12, vulkan or metal');
  const backend = requested === 'auto' ? supported[0] : requested;
  if (!supported.includes(backend)) throw new RangeError(`GPU backend ${requested} is unsupported on ${platform}`);
  return backend;
}

/** Проверка размеров до выделения памяти CPU/GPU. */
export function dimensions(width, height) {
  for (const value of [width, height]) {
    if (!Number.isSafeInteger(value) || value < 1 || value > 4096) {
      throw new RangeError('Native render dimensions must be integers in [1, 4096]');
    }
  }
  return { width, height };
}

/** Не допускаем скрытый переход Dawn на WARP/SwiftShader/lavapipe. */
export function hardwareInfo(adapter) {
  const info = adapter.info ?? {};
  const result = Object.fromEntries(['vendor', 'architecture', 'device', 'description']
    .map(key => [key, String(info[key] ?? '')]));
  const identity = Object.values(result).join(' ').trim();
  if (adapter.isFallbackAdapter || info.isFallbackAdapter ||
      /swiftshader|llvmpipe|lavapipe|software|microsoft basic|\bwarp\b|\bcpu\b/i.test(identity)) {
    throw new Error(`Hardware GPU required; software/fallback adapter rejected: ${identity}`);
  }
  if (!identity) throw new Error('GPU adapter identity is empty; hardware execution cannot be verified');
  return Object.freeze({ ...result, isFallbackAdapter: false });
}

/** Первый native host не эмулирует DOM, Canvas2D или Web Audio. */
export function assertNativeScene(scene) {
  for (const entity of scene.entities.values()) {
    const material = entity.material;
    if (material?.label || material?.texture?.url || material?.texture?.normalUrl || material?.texture?.ormUrl) {
      throw new Error(`Entity "${entity.id}" needs a browser image/text adapter. Native v1 supports procedural materials, not image maps or painted labels.`);
    }
  }
}

const lease = Symbol.for('@rom4/game-engine/native-gpu-lease');
/** Узкий адаптер для существующего renderer: только GPU provider и pixel ratio.
 * Не создаёт window/document, не загружает браузер. Владение — одно на процесс.
 * Дескрипторы globals восстанавливаются даже при ошибке инициализации. */
export function installNativeGlobals(gpu, scope = globalThis) {
  if (scope[lease]) throw new Error('Only one native GPU session per process is supported');
  if (typeof scope.document !== 'undefined') throw new Error('Native runtime must run outside a browser');
  const keys = ['navigator', 'devicePixelRatio'];
  const previous = keys.map(key => Object.getOwnPropertyDescriptor(scope, key));
  for (let i = 0; i < keys.length; i++) {
    if (previous[i]?.configurable === false) throw new Error(`Cannot install native ${keys[i]} adapter`);
  }
  scope[lease] = true;
  const restore = () => {
    for (let i = 0; i < keys.length; i++) {
      if (previous[i]) Object.defineProperty(scope, keys[i], previous[i]);
      else delete scope[keys[i]];
    }
    delete scope[lease];
  };
  try {
    Object.defineProperty(scope, 'navigator', { configurable: true, value: { gpu } });
    Object.defineProperty(scope, 'devicePixelRatio', { configurable: true, value: 1 });
  } catch (error) { restore(); throw error; }
  let released = false;
  return () => { if (!released) { released = true; restore(); } };
}

/** WebGPU copyTextureToBuffer требует выравнивание строки по 256 байтам. */
export function readbackLayout(width, height) {
  dimensions(width, height);
  const bytesPerRow = Math.ceil(width * 4 / 256) * 256;
  return { bytesPerRow, size: bytesPerRow * height };
}

export function unpackRGBA(bytes, width, height, format = 'bgra8unorm') {
  const { bytesPerRow, size } = readbackLayout(width, height);
  if (bytes.byteLength !== size) throw new RangeError('Readback byte length does not match padded dimensions');
  if (!['bgra8unorm', 'rgba8unorm'].includes(format)) throw new Error(`Unsupported capture format: ${format}`);
  const out = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    const row = bytes.subarray(y * bytesPerRow, y * bytesPerRow + width * 4);
    out.set(row, y * width * 4);
  }
  if (format === 'bgra8unorm') {
    for (let i = 0; i < out.length; i += 4) [out[i], out[i + 2]] = [out[i + 2], out[i]];
  }
  return out;
}

const crcTable = Uint32Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : c >>> 1;
  return c >>> 0;
});
function chunk(type, payload) {
  const name = Buffer.from(type, 'ascii'), body = Buffer.concat([name, payload]);
  let crc = 0xffffffff;
  for (const b of body) crc = crcTable[(crc ^ b) & 255] ^ (crc >>> 8);
  const prefix = Buffer.alloc(4), suffix = Buffer.alloc(4);
  prefix.writeUInt32BE(payload.length); suffix.writeUInt32BE((crc ^ 0xffffffff) >>> 0);
  return Buffer.concat([prefix, body, suffix]);
}
/** PNG-кодирование уже отрендеренных GPU пикселей; не CPU-рендерер. */
export function encodePNG(rgba, width, height) {
  dimensions(width, height);
  if (rgba.byteLength !== width * height * 4) throw new RangeError('Invalid RGBA byte length');
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0); header.writeUInt32BE(height, 4); header[8] = 8; header[9] = 6;
  const rows = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) rows.set(rgba.subarray(y * width * 4, (y + 1) * width * 4), y * (width * 4 + 1) + 1);
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), chunk('IDAT', deflateSync(rows)), chunk('IEND', Buffer.alloc(0))]);
}

export function pixelEvidence(rgba) {
  if (!rgba.length || rgba.length % 4) throw new RangeError('Invalid RGBA pixels');
  let min = 255, max = 0, sum = 0, sum2 = 0;
  const colors = new Set();
  for (let i = 0; i < rgba.length; i += 4) {
    const value = (rgba[i] + rgba[i + 1] + rgba[i + 2]) / 3;
    min = Math.min(min, value); max = Math.max(max, value); sum += value; sum2 += value * value;
    if (colors.size < 4096) colors.add((rgba[i] << 16) | (rgba[i + 1] << 8) | rgba[i + 2]);
  }
  const n = rgba.length / 4, variance = Math.max(0, sum2 / n - (sum / n) ** 2);
  return { min, max, variance, uniqueColorsAtLeast: colors.size, nonUniform: max - min > 8 && variance > 4 && colors.size > 16 };
}

export function parseArgs(args) {
  const options = { headless: false, width: 960, height: 540, frames: 0, fps: 60, renderFps: null, output: null, report: null, scene: null, backend: 'auto', help: false };
  const values = new Set(['width', 'height', 'frames', 'fps', 'render-fps', 'output', 'report', 'scene', 'backend']);
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--' && i === 0) continue;
    const key = args[i].replace(/^--/, '');
    if (args[i] === '--headless') { options.headless = true; continue; }
    if (args[i] === '--help' || args[i] === '-h') { options.help = true; continue; }
    if (!args[i].startsWith('--') || !values.has(key)) throw new Error(`Unknown argument: ${args[i]}`);
    const value = args[++i];
    if (value === undefined || value.startsWith('--')) throw new Error(`Missing value for --${key}`);
    options[key === 'render-fps' ? 'renderFps' : key] = ['width', 'height', 'frames', 'fps', 'render-fps'].includes(key) ? Number(value) : value;
  }
  dimensions(options.width, options.height);
  resolveBackend(options.backend);
  if (options.renderFps !== null && (!Number.isInteger(options.renderFps) || options.renderFps < 0 || options.renderFps > 240)) throw new RangeError('--render-fps must be an integer in [0, 240] (0 = uncapped)');
  if (!Number.isInteger(options.fps) || options.fps < 1 || options.fps > 240) throw new RangeError('--fps must be an integer in [1, 240]');
  if (!Number.isInteger(options.frames) || options.frames < 0 || options.frames > 1_000_000) throw new RangeError('--frames must be an integer in [0, 1000000]');
  if (options.headless && options.frames === 0) options.frames = 1;
  if (options.headless && !options.output) options.output = 'artifacts/native/frame.png';
  return options;
}
