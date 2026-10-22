import { spawn } from 'node:child_process';

/** Keep the supervisor alive when a native addon kills its JS host before catch(). */
export function runNativeProcess(executable, args, { cwd, timeoutMs = 180000, logLimit = 65536, echo = true } = {}) {
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || !Number.isSafeInteger(logLimit) || logLimit < 1) throw new RangeError('Invalid native process limits');
  return new Promise(resolveRun => {
    const started = performance.now();
    let stdout = '', stderr = '', timedOut = false, launchError = null;
    const child = spawn(executable, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'], shell: false, windowsHide: true });
    const timer = setTimeout(() => { timedOut = true; child.kill(); }, timeoutMs);
    child.stdout.on('data', data => { stdout = (stdout + data.toString()).slice(-logLimit); if (echo) process.stdout.write(data); });
    child.stderr.on('data', data => { stderr = (stderr + data.toString()).slice(-logLimit); if (echo) process.stderr.write(data); });
    child.once('error', error => { launchError = error.message; });
    child.once('close', (exitCode, signal) => {
      clearTimeout(timer);
      resolveRun({ status: exitCode === 0 && !timedOut && !launchError ? 'success' : 'failed',
        exitCode, signal, timedOut, launchError, durationMs: performance.now() - started, stdoutTail: stdout, stderrTail: stderr });
    });
  });
}
