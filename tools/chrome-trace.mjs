import {mkdir,open,rm} from 'node:fs/promises';
import {dirname} from 'node:path';

// Tooling only: reuse the harness CDP connection, never import into the engine.
const categories = [
  'devtools.timeline', 'v8', 'blink.user_timing', 'loading', 'latencyInfo',
  'disabled-by-default-devtools.timeline',
  'disabled-by-default-devtools.timeline.frame',
  'disabled-by-default-v8.cpu_profiler',
  'disabled-by-default-devtools.screenshot',
];

/** Record native Chrome samples + filmstrip around an existing harness action.
 * Sampling is not an exhaustive call log; screenshots are not simulation replay.
 * A dedicated harness browser prevents capturing unrelated personal tabs.
 */
export async function recordChromeTrace(send, socket, output, run, {
  timeoutMs = 30000, maxBytes = 64 * 1024 * 1024,
} = {}) {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0 || !Number.isSafeInteger(maxBytes) || maxBytes < 1)
    throw new RangeError('Invalid trace limits');
  let finish, fail, stream, file, bytes = 0, created = false, started = false;
  const complete = new Promise((resolve, reject) => { finish = resolve; fail = reject; });
  // A socket can close while the scenario still runs. Observe rejection immediately.
  complete.catch(() => {});
  const message = ({data}) => {
    const event = JSON.parse(String(data));
    if (event.method === 'Tracing.tracingComplete') {
      stream = event.params?.stream;
      finish(event.params ?? {});
    }
  };
  const closed = () => fail(new Error('Chrome disconnected during trace'));
  socket.addEventListener('message', message);
  socket.addEventListener('close', closed);
  const bounded = async promise => {
    let timer;
    try { return await Promise.race([promise, new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error('Chrome trace timed out')), timeoutMs);
    })]); } finally { clearTimeout(timer); }
  };
  try {
    await bounded(send('Tracing.start', {
      transferMode: 'ReturnAsStream', streamFormat: 'json',
      traceConfig: {recordMode: 'recordUntilFull', traceBufferSizeInKb: 16384,
        includedCategories: categories, excludedCategories: ['*']},
    }));
    started = true;
    // End tracing even if the scenario fails. It must not survive this tool action.
    let result, scenarioError, scenarioFailed = false;
    try { result = await bounded(run()); } catch (error) { scenarioFailed = true; scenarioError = error; }
    await bounded(send('Tracing.end')); started = false;
    const completion = await bounded(complete);
    if (scenarioFailed) throw scenarioError;
    if (!stream) throw new Error('Chrome did not return a trace stream');
    if (completion.dataLossOccurred) throw new Error('Chrome trace buffer overflow; record a shorter interval');
    await mkdir(dirname(output), {recursive: true});
    file = await open(output, 'wx'); created = true;
    while (true) {
      const chunk = await bounded(send('IO.read', {handle: stream, size: 256 * 1024}));
      const data = Buffer.from(chunk.data, chunk.base64Encoded ? 'base64' : 'utf8');
      bytes += data.length;
      if (bytes > maxBytes) throw new RangeError('Chrome trace exceeds output limit');
      await file.writeFile(data);
      if (chunk.eof) break;
    }
    await file.close(); file = null;
    return {output, bytes, result};
  } catch (error) {
    if (file) await file.close().catch(() => {});
    if (created) await rm(output, {force: true});
    throw error;
  } finally {
    if (started) await bounded(send('Tracing.end')).catch(() => {});
    if (stream) await bounded(send('IO.close', {handle: stream})).catch(() => {});
    socket.removeEventListener('message', message);
    socket.removeEventListener('close', closed);
  }
}
