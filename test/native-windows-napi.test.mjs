import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { relinkWindowsNodeApi, windowsImports, prepareWindowsDawn, verifyWindowsDawn } from '../tools/native/windows-napi.mjs';

// Small independent PE32+ fixtures: one .rdata section and a named Node-API
// import/export. Hardware smoke tests exercise the actual pinned Dawn binary.
function pe(kind = 'addon', symbol = 'napi_get_global') {
  const b = Buffer.alloc(1024), coff = 0x84, opt = 0x98, table = opt + 240;
  b.write('MZ'); b.writeUInt32LE(0x80, 0x3c); b.write('PE\0\0', 0x80);
  b.writeUInt16LE(0x8664, coff); b.writeUInt16LE(1, coff + 2); b.writeUInt16LE(240, coff + 16);
  b.writeUInt16LE(0x20b, opt); b.writeUInt32LE(512, opt + 8);
  b.writeUInt32LE(4096, opt + 32); b.writeUInt32LE(512, opt + 36);
  b.writeUInt32LE(8192, opt + 56); b.writeUInt32LE(512, opt + 60); b.writeUInt32LE(16, opt + 108);
  b.write('.rdata', table); b.writeUInt32LE(512, table + 8); b.writeUInt32LE(4096, table + 12);
  b.writeUInt32LE(512, table + 16); b.writeUInt32LE(512, table + 20); b.writeUInt32LE(0x40000040, table + 36);
  if (kind === 'addon') {
    b.writeUInt32LE(4096, opt + 120); b.writeUInt32LE(40, opt + 124);
    b.writeUInt32LE(4224, 512); b.writeUInt32LE(4192, 512 + 12); b.writeUInt32LE(4224, 512 + 16);
    b.write('node.exe\0', 608); b.writeBigUInt64LE(4256n, 640); b.write(symbol + '\0', 674);
  } else {
    b.writeUInt32LE(4096, opt + 112); b.writeUInt32LE(40, opt + 116);
    b.writeUInt32LE(1, 512 + 24); b.writeUInt32LE(4224, 512 + 32);
    b.writeUInt32LE(4256, 640); b.write(symbol + '\0', 672);
  }
  return b;
}

test('Dawn N-API relinking supports a compiled executable name longer than node.exe', () => {
  const original = pe(), before = Buffer.from(original);
  const result = relinkWindowsNodeApi(original, pe('host'), 'the-engine.exe');
  assert.deepEqual(original, before); assert.equal(result.metadata.hostName, 'the-engine.exe');
  assert.deepEqual(windowsImports(result.bytes).map(i => [i.dll, i.symbols]), [['the-engine.exe', ['napi_get_global']]]);
  const opt = 0x98, section = opt + 240 + 40;
  assert.equal(result.bytes.readUInt16LE(0x86), 2);
  assert.equal(result.bytes.readUInt32LE(section + 36), 0x40000040, 'new section cannot execute or write');
  assert.equal(result.bytes.readUInt32LE(opt + 56), 12288);
  assert.equal(result.metadata.sourceSha256.length, 64); assert.equal(result.metadata.sha256.length, 64);
});
test('relinker rejects missing host APIs instead of loading an incompatible runtime', () => {
  assert.throws(() => relinkWindowsNodeApi(pe(), pe('host', 'napi_different'), 'bun.exe'), /does not export/);
  assert.throws(() => relinkWindowsNodeApi(pe('addon', 'v8_function'), pe('host', 'v8_function'), 'bun.exe'), /beyond Node-API/);
});
test('relinker preserves signatures and rejects signed DLLs, unknown formats and occupied headers', () => {
  const signed = pe(); signed.writeUInt32LE(100, 0x98 + 112 + 32);
  const full = pe(); full[0x98 + 240 + 40] = 1;
  const arm = pe(); arm.writeUInt16LE(0xaa64, 0x84);
  for (const input of [signed, full, arm, Buffer.alloc(20), Buffer.from('not a PE')]) {
    const before = Buffer.from(input); assert.throws(() => relinkWindowsNodeApi(input, pe('host'), 'bun.exe')); assert.deepEqual(input, before);
  }
  assert.throws(() => relinkWindowsNodeApi(pe(), pe('host'), '../bun.exe'), /executable name/);
  assert.throws(() => relinkWindowsNodeApi(pe(), pe('host'), 'kernel32.dll'), /executable name/);
});
test('relinker rejects an already relinked binary and truncated/out-of-range import data', () => {
  const linked = relinkWindowsNodeApi(pe(), pe('host'), 'bun.exe').bytes;
  assert.throws(() => relinkWindowsNodeApi(linked, pe('host'), 'bun.exe'), /unmodified/);
  const bad = pe(); bad.writeUInt32LE(0xffffff00, 512 + 12);
  assert.throws(() => windowsImports(bad), /RVA/);
  assert.throws(() => windowsImports(pe().subarray(0, 700)), /Truncated/);
});
test('prepared bindings cache reproducibly and reject a renamed host or modified payload', t => {
  const dir = mkdtempSync(join(tmpdir(), 'engine-napi-')); t.after(() => rmSync(dir, { recursive: true, force: true }));
  const addon = join(dir, 'dawn.node'), host = join(dir, 'the-engine.exe'), output = join(dir, 'runtime', 'dawn-bun.node');
  writeFileSync(addon, pe()); writeFileSync(host, pe('host'));
  const first = prepareWindowsDawn(addon, host, output);
  assert.deepEqual(prepareWindowsDawn(addon, host, output), first); assert.deepEqual(verifyWindowsDawn(output, host), first);
  const renamed = join(dir, 'renamed.exe'); writeFileSync(renamed, pe('host'));
  assert.throws(() => verifyWindowsDawn(output, renamed), /does not match/);
  const bytes = readFileSync(output); bytes[100] ^= 1; writeFileSync(output, bytes);
  assert.throws(() => verifyWindowsDawn(output, host), /does not match/);
  assert.deepEqual(prepareWindowsDawn(addon, host, output), first, 'source setup repairs a damaged cache');
  assert.deepEqual(readFileSync(addon), pe(), 'installed addon is never modified');
});
