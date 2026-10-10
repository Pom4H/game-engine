// Seed/spawn stays in upstream Sim3D. Only its update runs in Rust WASM.
export const FIELDS = Object.freeze([
  'x','y','z','vx','vy','vz','rx','ry','rz','sx','sy','sz','r','g','b'
]);
export const RUST_CAPACITY = 300_000;
export async function useRustMotion(sim, url = '/rom4/bench_motion.wasm') {
  let wasmBytes = url;
  if (typeof url === 'string') {
    const response = await fetch(url);
    if (!response.ok) throw new Error('Rust motion WASM fetch: HTTP ' + response.status);
    wasmBytes = await response.arrayBuffer();
  }
  const { instance } = await WebAssembly.instantiate(wasmBytes);
  const { memory, reserve, step } = instance.exports;
  if (!memory || typeof reserve !== 'function' || typeof step !== 'function')
    throw new Error('Rust motion ABI requires memory, reserve, step');
  const offset = reserve(RUST_CAPACITY);
  if (!Number.isInteger(offset) || offset <= 0 ||
      offset + RUST_CAPACITY * FIELDS.length * 4 > memory.buffer.byteLength)
    throw new Error('Invalid Rust motion allocation');
  for (let k = 0; k < FIELDS.length; k++)
    sim[FIELDS[k]] = new Float32Array(memory.buffer, offset + k * RUST_CAPACITY * 4, RUST_CAPACITY);
  sim.capacity = RUST_CAPACITY;
  sim.count = 0;
  sim.update = () => {
    if (step(sim.count) !== 1) throw new Error('Rust motion rejected count ' + sim.count);
  };
  return { wasm: true, fields: FIELDS.length, capacity: RUST_CAPACITY };
}
