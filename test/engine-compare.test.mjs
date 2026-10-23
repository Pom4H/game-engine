import test from 'node:test';
import assert from 'node:assert/strict';
import {writeBufferBytes, distribution, matrixError, requireHardware} from '../tools/engine-compare/metrics.mjs';
import {GPUJournal} from '../tools/engine-compare/gpu-journal.mjs';
import {createFixture, visibilityCamera, threeCubeFaces} from '../tools/engine-compare/fixture.mjs';
import {cameraProjection} from '../dist/render/calibrated-camera.js';
import {auditProfile,commonPostFeatures,engineFeatures,requireProfile} from '../tools/engine-compare/profiles.mjs';

test('comparison profiles reject mislabeled work and preserve the default full renderer',()=>{
  assert.equal(engineFeatures('native'),undefined);assert.throws(()=>requireProfile('fast'),/Invalid comparison profile/);
  const measured={pipeline:{features:commonPostFeatures,presentSource:'hdr'},visibility:{reflection:{batches:0}},preparation:{visibilityPlan:{passes:{reflection:{tests:0}}}}};
  auditProfile('common-post','engine',measured,{'render:render.main.opaque':{},'render:render.present':{}});
  for(const label of ['render:render.effects','render:render.taa','render:render.bloom.horizontal','render:render.reflection'])assert.throws(()=>auditProfile('common-post','engine',measured,{[label]:{}}),/Disabled render pass/);
  assert.throws(()=>auditProfile('common-post','engine',{...measured,pipeline:{features:{...commonPostFeatures,temporalAA:true},presentSource:'hdr'}},{}),/not applied/);
  assert.throws(()=>auditProfile('common-post','engine',{...measured,visibility:{reflection:{batches:1}}},{}),/visibility buffers/);
  assert.throws(()=>auditProfile('common-post','engine',{...measured,preparation:{visibilityPlan:{passes:{reflection:{tests:1}}}}},{}),/CPU clip tests/);
});

test('queue byte accounting respects typed-array element units, view offsets and DataView byte units', () => {
  const data = new Float32Array(new ArrayBuffer(128), 16, 12);
  assert.equal(writeBufferBytes(data), 48);
  assert.equal(writeBufferBytes(data, 2), 40);
  assert.equal(writeBufferBytes(data, 2, 3), 12);
  assert.equal(writeBufferBytes(new DataView(data.buffer, 16, 48), 2, 3), 3);
  assert.equal(writeBufferBytes(data.buffer, 16), 112);
  assert.equal(writeBufferBytes(new Uint16Array(24), 4, 8), 16);
});

test('percentiles and GPU evidence reject missing measurements and software adapters', () => {
  assert.equal(distribution(Array.from({length: 20}, (_, n) => n + 1)).p95, 19);
  assert.throws(() => distribution([]));assert.throws(() => distribution([NaN]));
  assert.throws(() => requireHardware({vendor: 'google', description: 'SwiftShader'}));
  assert.throws(() => requireHardware({vendor: 'amd', isFallbackAdapter: true}));
  requireHardware({vendor: 'amd', architecture: 'rdna-3', isFallbackAdapter: false});
  assert.throws(() => matrixError([1], [Infinity]));assert.throws(() => matrixError([1, 2], [1]));
});

function mockDevice() {
  globalThis.GPUBufferUsage = {QUERY_RESOLVE: 1, COPY_SRC: 2, COPY_DST: 4, MAP_READ: 8};globalThis.GPUMapMode = {READ: 1};
  const mappings = [], descriptors = [], listeners = new Map();
  const draws = () => ({draw() {}, drawIndexed() {}, drawIndirect() {}, drawIndexedIndirect() {}, executeBundles() {}, dispatchWorkgroups() {}, dispatchWorkgroupsIndirect() {}, end() {}});
  const queue = {writeBuffer() {}, writeTexture() {}, copyExternalImageToTexture() {}, submit() {}, async onSubmittedWorkDone() {}};
  const device = {
    queue, lost: new Promise(() => {}), addEventListener(name, callback) {listeners.set(name, callback);},
    createQuerySet: () => ({destroy() {}}),
    createBuffer: descriptor => {
      const bytes = new ArrayBuffer(descriptor.size);
      return {destroy() {}, unmap() {}, getMappedRange: (offset, size) => bytes.slice(offset, offset + size), mapAsync: () => new Promise(resolve => mappings.push(resolve)), bytes};
    },
    createCommandEncoder: () => ({
      beginRenderPass: descriptor => {descriptors.push(descriptor);return draws();}, beginComputePass: descriptor => {descriptors.push(descriptor);return draws();},
      resolveQuerySet(query, first, count, buffer) {const data = new BigUint64Array(buffer.bytes);for (let n = 0; n < count; n++) data[n] = BigInt(n + 1) * 1000000n;},
      copyBufferToBuffer(source, sourceOffset, dest, destOffset, size) {new Uint8Array(dest.bytes).set(new Uint8Array(source.bytes, sourceOffset, size), destOffset);},finish: () => ({}),
    }),
    createRenderBundleEncoder: () => ({...draws(), finish: () => ({})}),
  };
  return {device, mappings, descriptors, listeners};
}

test('GPU accounting counts cached bundles on execution and preserves one-shot iterators', async () => {
  const mock = mockDevice(), journal = new GPUJournal(mock.device, {vendor: 'amd'});
  const bundleEncoder = mock.device.createRenderBundleEncoder();bundleEncoder.drawIndexed(36, 5000);const bundle = bundleEncoder.finish();
  journal.beginFrame(0);
  mock.device.queue.writeBuffer({}, 0, new Float32Array(40), 4, 8);
  const pass = mock.device.createCommandEncoder().beginRenderPass({});
  pass.executeBundles((function*() {yield bundle;})());pass.drawIndexedIndirect({}, 0);pass.end();
  const result = journal.endFrame();
  assert.equal(result.drawCalls, 2);assert.equal(result.indirectDrawCalls, 1);assert.equal(result.trianglesDirect, 60000);assert.equal(result.bufferUploadBytes, 32);
  assert.equal(result.passes[0].drawCalls, 2);assert.equal(result.passes[0].indirectDrawCalls, 1);
  assert.equal(result.writeBufferCalls,1);
  mock.mappings.splice(0).forEach(resolve => resolve());await journal.flush();assert.equal(result.gpuMs, 1);
  journal.beginFrame(1);mock.device.createCommandEncoder().beginRenderPass({}).executeBundles([bundle]);
  const second = journal.endFrame();assert.equal(second.drawCalls, 1);
  assert.equal(second.writeBufferCalls,0);
  mock.mappings.splice(0).forEach(resolve => resolve());await journal.dispose();assert.equal(second.gpuMs, 1);
});

test('bounded timestamp ring drops busy frames and cannot assign stale results to a later frame', async () => {
  const mock = mockDevice(), journal = new GPUJournal(mock.device, {vendor: 'amd'}), frames = [];
  for (let n = 0; n < 9; n++) {journal.beginFrame(n);mock.device.createCommandEncoder().beginComputePass({}).dispatchWorkgroups(1);frames.push(journal.endFrame());}
  assert.equal(journal.slots.length, 8);assert.equal(journal.pending.size, 8);assert.equal(frames[8].timestampUnavailable, true);
  assert.equal(frames[8].gpuMs, undefined);assert.equal(frames[8].dispatches, 1);
  mock.mappings.splice(0).forEach(resolve => resolve());await journal.flush();assert.ok(frames.slice(0, 8).every(frame => frame.gpuMs === 1));assert.equal(frames[8].gpuMs, undefined);
  journal.beginFrame(9);mock.device.createCommandEncoder().beginRenderPass({});const reused = journal.endFrame();
  mock.mappings.splice(0).forEach(resolve => resolve());await journal.dispose();assert.equal(reused.gpuMs, 1);assert.equal(frames[8].gpuMs, undefined);
});

test('shared fixture preserves production geometry and replay, with the actual engine clip projection', async () => {
  const fixture = await createFixture(4), another = await createFixture(4);
  assert.equal(fixture.objectCount, 13);assert.equal(fixture.replayHash, another.replayHash);assert.equal(fixture.geometryHash, another.geometryHash);
  const camera = visibilityCamera(123, 'camera-motion');
  assert.equal(matrixError(fixture.projection(camera, 16 / 9), cameraProjection(camera, 1920, 1080).matrix), 0);
  for (const group of fixture.groups) {
    assert.equal(group.models.length, group.objects.length * 16);
    assert.equal(group.positions.length, group.normals.length);
    assert.ok(group.indices.every(index => index < group.positions.length / 3));
    group.objects.forEach((object, n) => assert.equal(matrixError(object.model, group.models.subarray(n * 16, n * 16 + 16)), 0));
  }
});

test('cubemap convention conversion preserves radiance while reflecting sampled X', () => {
  const size = 2, rgba16f = new Uint16Array(6 * size * size * 4);
  for (let face = 0; face < 6; face++) for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) rgba16f.fill(face * 100 + y * 10 + x, ((face * size + y) * size + x) * 4, ((face * size + y) * size + x + 1) * 4);
  const faces = threeCubeFaces({size, rgba16f});
  assert.deepEqual([...faces[0].filter((_, n) => n % 4 === 0)], [101, 100, 111, 110]);
  assert.deepEqual([...faces[1].filter((_, n) => n % 4 === 0)], [1, 0, 11, 10]);
  assert.deepEqual([...faces[2].filter((_, n) => n % 4 === 0)], [201, 200, 211, 210]);
  assert.deepEqual([...faces[5].filter((_, n) => n % 4 === 0)], [501, 500, 511, 510]);
});

test('repeated GPU validation failures keep bounded diagnostics and still fail the evidence gate', async () => {
  const mock = mockDevice(), journal = new GPUJournal(mock.device, {vendor: 'amd'});
  for (let n = 0; n < 100; n++) mock.listeners.get('uncapturederror')({error: {message: 'validation:' + n}});
  assert.equal(journal.errors.length, 64);assert.equal(journal.errorCount, 100);
  await assert.rejects(() => journal.flush(), /Additional GPU errors: 36/);
});

test('native CPU timing excludes nested calls once and preserves thrown native errors',()=>{
 const mock=mockDevice();let now=0;
 mock.device.queue.submit=()=>{now+=4;};mock.device.queue.writeBuffer=()=>{now++;mock.device.queue.submit([]);now+=2;throw new Error('native failure');};
 const journal=new GPUJournal(mock.device,{vendor:'amd'},{cpuApiTimings:true,clock:()=>now});journal.beginFrame(0);assert.throws(()=>mock.device.queue.writeBuffer({},0,new Float32Array(4)),/native failure/);const result=journal.endFrame();
 assert.equal(result.cpuApi.totalMs,7);assert.equal(result.cpuApi.methods.writeBuffer.exclusiveMs,3);assert.equal(result.cpuApi.methods.writeBuffer.inclusiveMs,7);assert.equal(result.cpuApi.methods.submit.exclusiveMs,4);assert.equal(journal.cpuApiStack.length,0);
 mock.device.queue.submit([]);assert.equal(result.cpuApi.totalMs,7);
});

test('native CPU timings cover encoder/pass calls and exclude the separate timestamp resolve',async()=>{
 const mock=mockDevice();let now=0;const create=mock.device.createCommandEncoder;
 mock.device.queue.submit=()=>{now+=7;};mock.device.createCommandEncoder=()=>{now+=2;const encoder=create(),begin=encoder.beginRenderPass;encoder.beginRenderPass=descriptor=>{now+=3;const pass=begin(descriptor);pass.draw=()=>{now+=4;};pass.end=()=>{now+=5;};return pass;};encoder.finish=()=>{now+=6;return{};};return encoder;};
 const journal=new GPUJournal(mock.device,{vendor:'amd'},{cpuApiTimings:true,clock:()=>now});journal.beginFrame(0);const encoder=mock.device.createCommandEncoder(),pass=encoder.beginRenderPass({});pass.draw(3);pass.end();mock.device.queue.submit([encoder.finish()]);const result=journal.endFrame();
 assert.equal(result.cpuApi.totalMs,27);assert.equal(result.cpuApi.methods.finish.exclusiveMs,6);assert.equal(result.cpuApi.methods.end.exclusiveMs,5);assert.equal(result.drawCalls,1);assert.equal(now,42,'timestamp encoder/finish/submit advance the native clock after render measurement');
 mock.mappings.splice(0).forEach(resolve=>resolve());await journal.dispose();assert.equal(result.cpuApi.totalMs,27);
});
