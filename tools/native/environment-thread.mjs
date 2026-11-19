import {parentPort} from 'node:worker_threads';
/** No GPU/SDL in this thread; transfer ownership of the exact baked buffers. */
export function runEnvironmentThread(bake) {
  if (!parentPort) throw new Error('Environment entry must run in a worker thread');
  parentPort.on('message', input => {
    const data = bake(input);
    parentPort.postMessage(data, [data.irradiance.buffer, ...data.mips.map(mip => mip.buffer)]);
  });
}
