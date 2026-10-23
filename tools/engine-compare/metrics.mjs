/** Units accepted by GPUQueue.writeBuffer: typed-array offsets/sizes are elements. */
export function writeBufferBytes(data, offset = 0, size) {
  const elementBytes = ArrayBuffer.isView(data) ? (data.BYTES_PER_ELEMENT ?? 1) : 1;
  return size === undefined ? data.byteLength - offset * elementBytes : size * elementBytes;
}

export function distribution(values) {
  if (!values.length || values.some(value => !Number.isFinite(value))) throw new Error('Missing or non-finite measurements');
  const sorted = [...values].sort((a, b) => a - b);
  const at = q => sorted[Math.ceil(sorted.length * q) - 1];
  return {samples: values.length, p50: at(.5), p95: at(.95), mean: values.reduce((sum, value) => sum + value, 0) / values.length};
}

export function matrixError(expected, actual) {
  if (expected.length !== actual.length) throw new Error('Matrix count mismatch');
  let error = 0;
  for (let n = 0; n < expected.length; n++) {
    if (!Number.isFinite(actual[n])) throw new Error('Non-finite transform');
    error = Math.max(error, Math.abs(expected[n] - actual[n]));
  }
  return error;
}

export function requireHardware(info) {
  if (info.isFallbackAdapter || !info.vendor || /swiftshader|lavapipe|llvmpipe|software|microsoft basic render/i.test(JSON.stringify(info))) {
    throw new Error('Native GPU required: ' + JSON.stringify(info));
  }
}

export function mergeWork(target, work) {
  for (const field of ['drawCalls', 'indirectDrawCalls', 'trianglesDirect', 'dispatches']) target[field] += work[field];
}

export function emptyWork() {
  return {drawCalls: 0, indirectDrawCalls: 0, trianglesDirect: 0, dispatches: 0};
}
