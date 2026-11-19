import test from 'node:test';
import assert from 'node:assert/strict';
import { runNativeProcess } from '../tools/native/process.mjs';

test('native supervisor captures both streams and a successful exit', async () => {
  const r = await runNativeProcess(process.execPath, ['-e', "console.log('ready');console.error('diagnostic')"], { echo: false });
  assert.equal(r.status, 'success'); assert.equal(r.exitCode, 0);
  assert.match(r.stdoutTail, /ready/); assert.match(r.stderrTail, /diagnostic/);
});
test('native supervisor retains a failed host exit before an application report exists', async () => {
  const r = await runNativeProcess(process.execPath, ['-e', "console.error('addon load failed');process.exit(3)"], { echo: false });
  assert.equal(r.status, 'failed'); assert.equal(r.exitCode, 3); assert.match(r.stderrTail, /addon load failed/);
  assert.equal(r.timedOut, false); assert.equal(r.launchError, null);
});
test('native supervisor reports an executable that could not be launched', async () => {
  const r = await runNativeProcess('engine-nonexistent-probe-executable', [], { echo: false });
  assert.equal(r.status, 'failed'); assert.ok(r.launchError); assert.equal(r.timedOut, false);
});
test('native supervisor kills a stuck host and reports the timeout', async () => {
  const r = await runNativeProcess(process.execPath, ['-e', 'setInterval(()=>{},1000)'], { timeoutMs: 100, echo: false });
  assert.equal(r.status, 'failed'); assert.equal(r.timedOut, true);
});
test('native supervisor bounds retained logs without losing the last diagnostic', async () => {
  const r = await runNativeProcess(process.execPath, ['-e', "console.log('x'.repeat(100000)+'TAIL')"], { logLimit: 128, echo: false });
  assert.equal(r.status, 'success'); assert.ok(r.stdoutTail.length <= 128); assert.match(r.stdoutTail, /TAIL/);
});
