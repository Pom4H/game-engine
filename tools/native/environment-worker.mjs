import {Worker} from 'node:worker_threads';
import {dirname,join} from 'node:path';
import {pathToFileURL} from 'node:url';

export function nativeEnvironmentEntry(compiled = false) {
  return compiled ? pathToFileURL(join(dirname(process.execPath),'runtime/environment-worker.mjs')) : new URL('./environment-entry.mjs',import.meta.url);
}
/** EnvironmentMapWorker's narrow port, backed by Bun's node:worker_threads. */
export class NativeEnvironmentWorker {
  constructor(entry = nativeEnvironmentEntry(), onFailure = () => {}) {
    this.onmessage = null; this.onerror = null; this.disposed = false; this.posted = 0; this.completed = 0; this.transferredBytes = 0; this.failure = null;
    this.thread = new Worker(entry);
    const fail = error => {
      if (this.disposed || this.failure) return;
      this.failure = error instanceof Error ? error : new Error(String(error)); onFailure(this.failure);
      this.onerror?.({error:this.failure,message:this.failure.message,preventDefault(){}});
    };
    this.thread.on('message', data => {
      if (this.disposed) return;
      this.completed++; this.transferredBytes += data.irradiance.byteLength + data.mips.reduce((n,mip)=>n+mip.byteLength,0);
      this.onmessage?.({data});
    });
    this.thread.on('error', fail);
    this.thread.on('exit', code => { if (!this.disposed) fail(new Error(`Environment worker exited unexpectedly (${code})`)); });
  }
  postMessage(input) { if (this.disposed) throw new Error('Environment worker is disposed'); if (this.failure) throw this.failure; this.posted++; this.thread.postMessage(input); }
  terminate() { if (!this.disposed) { this.disposed = true; this.termination = this.thread.terminate(); } return this.termination; }
  inspect() { return {posted:this.posted,completed:this.completed,transferredBytes:this.transferredBytes,failed:!!this.failure,disposed:this.disposed}; }
}
