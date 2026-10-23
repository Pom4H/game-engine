import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { appendFileSync, readFileSync } from 'node:fs';
import { compilerFingerprint, materialNamesFromRust, project, rustByteToUtf16 } from './projection.mjs';

const projects = new Map();
const sha = value => createHash('sha256').update(value).digest('hex');
function handle(method, params) {
  switch (method) {
    case 'initialize':
      if (!params.positionEncodings.includes('utf-16')) throw new Error('UTF-16 mapping support required');
      return { positionEncoding: 'utf-16', diagnosticSource: 'worldc' };
    case 'openProject': {
      const { bridge, compilerSource, log } = params.options ?? {};
      if (typeof bridge !== 'string' || typeof compilerSource !== 'string') throw new Error('bridge and compilerSource paths required');
      const bytes = readFileSync(compilerSource);
      const source = bytes.toString('utf8');
      projects.set(params.projectHandle, { bridge, log, compilerFingerprint: compilerFingerprint(bytes), materials: materialNamesFromRust(source) });
      return { configIdentity: sha(source + sha(readFileSync(bridge))), watchedFiles: [compilerSource, bridge] };
    }
    case 'transform': {
      const state = projects.get(params.projectHandle);
      if (!state) throw new Error('Unknown project handle');
      const start = performance.now();
      const processResult = spawnSync(state.bridge, [], { input: params.content, encoding: 'utf8', windowsHide: true, timeout: 10000, maxBuffer: 16 * 1024 * 1024 });
      if (processResult.status !== 0) throw new Error(`Rust bridge failed: ${processResult.error?.message ?? processResult.stderr}`);
      const result = JSON.parse(processResult.stdout);
      if (result.compilerFingerprint !== state.compilerFingerprint) throw new Error('Rust bridge is stale; rebuild after changing compiler/src/lib.rs');
      const output = project(params.content, state.materials);
      if (!result.ok) {
        const at = rustByteToUtf16(params.content, result.at);
        const character = String.fromCodePoint(params.content.codePointAt(at) ?? 0);
        output.diagnostics = [{ start: at, length: at === params.content.length ? 0 : character.length, code: 1, messageText: result.message }];
      }
      if (typeof state.log === 'string') appendFileSync(state.log, JSON.stringify({ fileName: params.fileName, sourceSha: sha(params.content), ok: result.ok, rust: result.ok ? undefined : { at: result.at, message: result.message }, wscnSha: result.ok ? sha(Buffer.from(result.bytesHex, 'hex')) : undefined, rustNanos: result.compileNanos[0], elapsedMs: performance.now() - start }) + '\n');
      return output;
    }
    case 'closeProject': projects.delete(params.projectHandle); return null;
    default: throw new Error(`Unsupported method ${method}`);
  }
}

// The published Content Mapper JSON-RPC protocol uses Content-Length framing.
// Restrict input sizes so a malformed editor request cannot grow this buffer.
let pending = Buffer.alloc(0);
process.stdin.on('data', chunk => {
  pending = Buffer.concat([pending, chunk]);
  if (pending.length > 16 * 1024 * 1024) throw new Error('Mapper request exceeds 16 MiB');
  for (;;) {
    const headerEnd = pending.indexOf('\r\n\r\n');
    if (headerEnd < 0) break;
    const header = pending.subarray(0, headerEnd).toString('ascii');
    const lengthMatch = header.match(/^Content-Length:\s*(\d+)$/im);
    if (!lengthMatch) throw new Error('Missing Content-Length');
    const length = Number(lengthMatch[1]);
    if (!Number.isSafeInteger(length) || length > 16 * 1024 * 1024) throw new Error('Invalid Content-Length');
    const start = headerEnd + 4;
    if (pending.length < start + length) break;
    const request = JSON.parse(pending.subarray(start, start + length).toString('utf8'));
    pending = pending.subarray(start + length);
    let response;
    try { response = { jsonrpc: '2.0', id: request.id, result: handle(request.method, request.params) }; }
    catch (error) { response = { jsonrpc: '2.0', id: request.id, error: { code: -32603, message: String(error.message ?? error) } }; }
    const body = Buffer.from(JSON.stringify(response));
    process.stdout.write(`Content-Length: ${body.length}\r\n\r\n`);
    process.stdout.write(body);
  }
});
