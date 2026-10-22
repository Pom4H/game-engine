import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { inflateSync } from 'node:zlib';
import { dimensions, hardwareInfo, assertNativeScene, installNativeGlobals, readbackLayout, unpackRGBA, encodePNG, pixelEvidence, parseArgs, resolveBackend } from '../tools/native/core.mjs';
import { NativeHost } from '../tools/native/host.mjs';

// Эти тесты проверяют контракт host, НЕ являются доказательством GPU-рендера.
// Реальные Dawn/SDL/Bun проверяет отдельный native-bun hardware workflow.
test('dimensions are bounded before CPU/GPU allocations', () => {
  assert.deepEqual(dimensions(4096, 1), { width: 4096, height: 1 });
  for (const n of [0, -1, 4097, 1.5, NaN, Infinity]) assert.throws(() => dimensions(n, 1));
});
test('CLI defaults and finite headless capture', () => {
  assert.equal(parseArgs([]).frames, 0);
  const opts = parseArgs(['--', '--headless', '--width', '65', '--height', '2']);
  assert.equal(opts.frames, 1); assert.equal(opts.width, 65); assert.ok(opts.output.endsWith('.png'));
  assert.equal(parseArgs(['--frames', '24', '--fps', '30']).frames, 24);
  assert.equal(parseArgs(['--render-fps','0','--fps','60']).renderFps,0);
  assert.equal(parseArgs(['--render-fps','144']).fps,60);
  assert.throws(()=>parseArgs(['--render-fps','-1']),/render-fps/);
  for (const args of [['--x'], ['--width'], ['--width', '--height'], ['--fps', '0'], ['--frames', '-1'], ['--frames', '1.5'], ['--width', 'NaN']]) assert.throws(() => parseArgs(args));
});

test('backend selection preserves platform defaults and rejects typos or unsupported choices', () => {
  assert.equal(resolveBackend('auto', 'win32'), 'd3d12');
  assert.equal(resolveBackend('vulkan', 'win32'), 'vulkan');
  assert.equal(resolveBackend('auto', 'darwin'), 'metal');
  assert.equal(resolveBackend('auto', 'linux'), 'vulkan');
  for (const [backend, platform] of [['vulcan','win32'],['metal','win32'],['d3d12','linux'],['vulkan','darwin'],['auto','unknown']]) assert.throws(() => resolveBackend(backend,platform), RangeError);
  assert.equal(parseArgs(['--backend', 'auto']).backend, 'auto');
  assert.throws(() => parseArgs(['--backend', 'vulcan']), /backend/);
});
test('hardware guard rejects software, fallback and unverifiable adapters', () => {
  for (const description of ['SwiftShader', 'llvmpipe', 'lavapipe', 'Microsoft Basic Render Driver', 'WARP', 'CPU rasterizer']) {
    assert.throws(() => hardwareInfo({ info: { description } }), /Hardware GPU required/);
  }
  assert.throws(() => hardwareInfo({ isFallbackAdapter: true, info: { description: 'Vendor GPU' } }));
  assert.throws(() => hardwareInfo({ info: {} }), /identity is empty/);
  assert.equal(hardwareInfo({ info: { vendor: 'nvidia', description: 'RTX' } }).vendor, 'nvidia');
});
test('native globals restore exact descriptors and enforce a single lease', () => {
  const scope = {}, getter = () => ({ userAgent: 'original' });
  Object.defineProperty(scope, 'navigator', { get: getter, configurable: true, enumerable: true });
  const before = Object.getOwnPropertyDescriptor(scope, 'navigator'), gpu = {};
  const restore = installNativeGlobals(gpu, scope);
  assert.equal(scope.navigator.gpu, gpu); assert.equal(scope.devicePixelRatio, 1);
  assert.equal('window' in scope, false); assert.equal('document' in scope, false);
  assert.throws(() => installNativeGlobals({}, scope), /one native GPU/);
  restore(); restore();
  assert.deepEqual(Object.getOwnPropertyDescriptor(scope, 'navigator'), before);
  assert.equal('devicePixelRatio' in scope, false);
  installNativeGlobals({}, scope)();
});
test('native globals reject DOM and nonconfigurable properties without mutation', () => {
  assert.throws(() => installNativeGlobals({}, { document: {} }), /outside a browser/);
  const scope = {};
  Object.defineProperty(scope, 'devicePixelRatio', { value: 2, configurable: false });
  assert.throws(() => installNativeGlobals({}, scope), /Cannot install/);
  assert.equal('navigator' in scope, false); assert.equal(scope.devicePixelRatio, 2);
});
test('unported image/text materials fail explicitly rather than disappear', () => {
  const scene = material => ({ entities: new Map([['test', { id: 'test', material }]]) });
  assert.doesNotThrow(() => assertNativeScene(scene({ kind: 'steel' })));
  for (const material of [{ label: 'hello' }, { texture: { url: 'x.png' } }, { texture: { normalUrl: 'x.png' } }, { texture: { ormUrl: 'x.png' } }]) {
    assert.throws(() => assertNativeScene(scene(material)), /browser image\/text adapter/);
  }
});
test('GPU readback strips 256-byte padding and swizzles BGRA across rows', () => {
  const { bytesPerRow, size } = readbackLayout(65, 2);
  assert.equal(bytesPerRow, 512); assert.equal(size, 1024);
  const bytes = new Uint8Array(size).fill(240);
  bytes.set([3, 2, 1, 255], 0); bytes.set([6, 5, 4, 255], 512);
  const rgba = unpackRGBA(bytes, 65, 2);
  assert.equal(rgba.length, 520); assert.deepEqual([...rgba.slice(0, 4)], [1, 2, 3, 255]);
  assert.deepEqual([...rgba.slice(260, 264)], [4, 5, 6, 255]);
  assert.deepEqual([...unpackRGBA(bytes, 65, 2, 'rgba8unorm').slice(0, 4)], [3, 2, 1, 255]);
  bytes.fill(0); assert.equal(rgba[0], 1, 'copied pixels outlive GPU map');
  assert.throws(() => unpackRGBA(new Uint8Array(4), 65, 2));
  assert.throws(() => unpackRGBA(new Uint8Array(1024), 65, 2, 'rgba16float'));
});
test('PNG encoder preserves pixels, dimensions, chunk CRCs and filter bytes', () => {
  const rgba = Uint8Array.from([255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255, 1, 2, 3, 255]);
  const png = encodePNG(rgba, 2, 2);
  assert.deepEqual([...png.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  const chunks = [];
  for (let pos = 8; pos < png.length;) {
    const length = png.readUInt32BE(pos), body = png.subarray(pos + 4, pos + 8 + length);
    // Independent bitwise CRC implementation (not the encoder's table).
    let crc = 0xffffffff;
    for (const byte of body) { crc ^= byte; for (let b = 0; b < 8; b++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0); }
    assert.equal((crc ^ 0xffffffff) >>> 0, png.readUInt32BE(pos + 8 + length));
    chunks.push({ type: body.subarray(0, 4).toString(), data: body.subarray(4) }); pos += length + 12;
  }
  assert.deepEqual(chunks.map(c => c.type), ['IHDR', 'IDAT', 'IEND']);
  assert.equal(chunks[0].data.readUInt32BE(0), 2); assert.equal(chunks[0].data.readUInt32BE(4), 2);
  const pixels = inflateSync(chunks[1].data);
  assert.deepEqual([...pixels], [0, ...rgba.slice(0, 8), 0, ...rgba.slice(8)]);
  assert.throws(() => encodePNG(new Uint8Array(1), 2, 2));
});
test('pixel evidence rejects empty/flat frames', () => {
  assert.throws(() => pixelEvidence(new Uint8Array()));
  assert.equal(pixelEvidence(new Uint8Array(80)).nonUniform, false);
  const rgba = Uint8Array.from({ length: 256 * 4 }, (_, i) => i % 4 === 3 ? 255 : Math.floor(i / 4));
  assert.equal(pixelEvidence(rgba).nonUniform, true);
});

function fakeBindings({ mapFails = false, noAdapter = false, surfaceFormat = 'bgra8unorm' } = {}) {
  const calls = [], window = new EventEmitter();
  Object.assign(window, { pixelWidth: 65, pixelHeight: 2, destroyed: false, minimized: false,
    destroy() { calls.push('window.destroy'); this.destroyed = true; } });
  let deviceError;
  const makeTexture = () => ({ destroy() { calls.push('texture.destroy'); } });
  const device = {
    queue: { submit() { calls.push('submit'); } },
    addEventListener(type, callback) { if (type === 'uncapturederror') deviceError = callback; },
    destroy() { calls.push('device.destroy'); },
    createTexture() { calls.push('texture.create'); return makeTexture(); },
    createBuffer({ size }) {
      calls.push('buffer.create');
      return {
        async mapAsync() { calls.push('map'); if (mapFails) throw new Error('map rejected'); },
        getMappedRange() { return new Uint8Array(size).fill(15).buffer; },
        unmap() { calls.push('unmap'); }, destroy() { calls.push('buffer.destroy'); },
      };
    },
    createCommandEncoder() { return {
      copyTextureToBuffer() { calls.push('copy'); }, finish() { return {}; },
    }; },
  };
  const adapter = { info: { vendor: 'test-vendor', description: 'Fake GPU for contract tests only' }, features: new Set(), async requestDevice() { return device; } };
  const surface = { getPreferredFormat: () => surfaceFormat, getCurrentTexture() { calls.push('surface.acquire'); return makeTexture(); }, swap() { calls.push('swap'); }, resize() { calls.push('resize'); } };
  const bindings = {
    gpu: { create(flags) { calls.push(...flags);return { async requestAdapter() { return noAdapter ? null : adapter; } }; }, renderGPUDeviceToWindow() { calls.push('surface.create'); return surface; } },
    sdl: { video: { createWindow() { calls.push('window.create'); return window; } } },
  };
  return { bindings, calls, window, device, error: message => deviceError({ error: { message } }) };
}
test('explicit Vulkan reaches Dawn without substituting a platform default', {skip:process.platform!=='win32'&&process.platform!=='linux'}, async()=>{
  const fake=fakeBindings(),host=await NativeHost.create({width:65,height:2,headless:true,backend:'vulkan'},fake.bindings);
  try {assert.ok(fake.calls.includes('backend=vulkan'));assert.equal(host.adapterInfo.backend,'vulkan');}finally{host.close();}
  const missing=fakeBindings({noAdapter:true});await assert.rejects(()=>NativeHost.create({width:65,height:2,headless:true,backend:'vulkan'},missing.bindings),/No native vulkan GPU adapter/);
  assert.equal(missing.calls.filter(c=>c.startsWith('backend=')).length,1);
});
async function configured(fake, headless = true) {
  const host = await NativeHost.create({ width: 65, height: 2, headless }, fake.bindings);
  try {
    const adapter = await globalThis.navigator.gpu.requestAdapter();
    const device = await adapter.requestDevice();
    host.context.configure({ device, format: 'bgra8unorm' }); return host;
  } catch (error) { host.close(); throw error; }
}

test('headless host never opens SDL, reuses texture and releases GPU maps', async () => {
  const fake = fakeBindings(), previous = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  const host = await configured(fake);
  try {
    assert.equal(fake.calls.includes('window.create'), false);
    assert.throws(() => host.present(), /No rendered/);
    await assert.rejects(() => host.captureRGBA(), /Render a frame/);
    assert.equal(host.currentTexture(), host.currentTexture());
    const capture = await host.captureRGBA(); assert.equal(capture.rgba.length, 520);
    assert.ok(fake.calls.indexOf('unmap') < fake.calls.indexOf('buffer.destroy'));
    host.present(); host.currentTexture(); host.present();
    assert.equal(fake.calls.filter(c => c === 'texture.create').length, 1);
    host.canvas.width = 66; host.currentTexture(); assert.equal(fake.calls.filter(c => c === 'texture.create').length, 2);
  } finally { host.close(); host.close(); }
  assert.deepEqual(Object.getOwnPropertyDescriptor(globalThis, 'navigator'), previous);
  assert.equal(fake.calls.filter(c => c === 'device.destroy').length, 1);
  assert.throws(() => host.currentTexture(), /closed/);
});
test('window render remains GPU-only except explicit capture; correct destruction order', async () => {
  const fake = fakeBindings(), host = await configured(fake, false);
  try {
    host.currentTexture(); host.present();
    assert.equal(fake.calls.includes('swap'), true); assert.equal(fake.calls.includes('buffer.create'), false);
    fake.window.pixelWidth = 66; fake.window.emit('resize'); assert.equal(host.syncSize(), true);
    assert.equal(host.canvas.width, 66); assert.ok(fake.calls.includes('resize'));
    fake.window.minimized = true; assert.equal(host.syncSize(), false);
    fake.window.minimized = false; fake.window.pixelWidth = 0; assert.equal(host.syncSize(), false);
    fake.window.emit('keyDown', { key: 'W' }); assert.ok(host.keys.has('w'));
    fake.window.emit('keyUp', { key: 'w' }); assert.equal(host.keys.size, 0);
    fake.window.emit('keyDown', { key: 'a' }); fake.window.emit('blur'); assert.equal(host.keys.size, 0);
    let prevented = false; fake.window.emit('beforeClose', { prevent() { prevented = true; } });
    assert.ok(prevented); assert.ok(host.shouldClose); assert.equal(fake.window.destroyed, false);
  } finally { host.close(); }
  assert.ok(fake.calls.indexOf('device.destroy') < fake.calls.indexOf('window.destroy'));
  assert.equal(fake.window.listenerCount('resize'), 0);
});
test('failed readback releases buffer without unmapping unmapped memory', async () => {
  const fake = fakeBindings({ mapFails: true }), host = await configured(fake);
  try { host.currentTexture(); await assert.rejects(() => host.captureRGBA(), /map rejected/); }
  finally { host.close(); }
  assert.ok(fake.calls.includes('buffer.destroy')); assert.equal(fake.calls.includes('unmap'), false);
});
test('device errors fail closed instead of claiming successful frames', async () => {
  const fake = fakeBindings(), host = await configured(fake);
  try { fake.error('validation failed'); assert.throws(() => host.currentTexture(), /validation failed/); }
  finally { host.close(); }
});
test('initialization failures clean resources and do not leak global ownership', async () => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  await assert.rejects(() => NativeHost.create({ width: 65, height: 2, headless: true }, fakeBindings({ noAdapter: true }).bindings), /No native/);
  const fake = fakeBindings({ surfaceFormat: 'bgra8unorm-srgb' });
  await assert.rejects(() => configured(fake, false), /Unexpected native surface format/);
  assert.ok(fake.window.destroyed); assert.deepEqual(Object.getOwnPropertyDescriptor(globalThis, 'navigator'), previous);
});
