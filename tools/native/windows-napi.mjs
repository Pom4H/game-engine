import { readFileSync, writeFileSync, mkdirSync, existsSync, renameSync, unlinkSync } from 'node:fs';
import { basename, dirname } from 'node:path';
import { createHash } from 'node:crypto';

const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const align = (n, a) => Math.ceil(n / a) * a;
const VERSION = 1;

// PE32+ import/export metadata only. Never execute code while inspecting a DLL.
// Format: https://learn.microsoft.com/en-us/windows/win32/debug/pe-format
function image(input) {
  const b = Buffer.from(input);
  const check = (p, n) => { if (!Number.isSafeInteger(p) || p < 0 || p + n > b.length) throw new Error('Truncated PE image'); };
  const u16 = p => { check(p, 2); return b.readUInt16LE(p); };
  const u32 = p => { check(p, 4); return b.readUInt32LE(p); };
  check(0, 64);
  if (u16(0) !== 0x5a4d) throw new Error('Not a Windows PE image');
  const pe = u32(0x3c), opt = pe + 24;
  if (u32(pe) !== 0x4550 || u16(opt) !== 0x20b || u16(pe + 4) !== 0x8664) throw new Error('Expected an x64 PE32+ image');
  const count = u16(pe + 6), table = opt + u16(pe + 20);
  if (count < 1 || count >= 96 || u16(pe + 20) < 240 || u32(opt + 108) < 16) throw new Error('Unsupported PE headers');
  check(table, count * 40);
  const sections = Array.from({ length: count }, (_, i) => {
    const p = table + i * 40, s = { va: u32(p + 12), size: u32(p + 8), rawSize: u32(p + 16), raw: u32(p + 20) };
    if (s.rawSize) check(s.raw, s.rawSize); return s;
  });
  const at = (rva, length = 1) => {
    const s = sections.find(s => rva >= s.va && rva - s.va + length <= s.rawSize);
    if (!s) throw new Error('PE RVA is not backed by file data');
    const p = s.raw + rva - s.va; check(p, length); return p;
  };
  const string = rva => {
    const p = at(rva), end = b.indexOf(0, p);
    if (end < p || end - p > 4096) throw new Error('Invalid PE string');
    at(rva, end - p + 1); return b.toString('ascii', p, end);
  };
  const directory = i => ({ rva: u32(opt + 112 + i * 8), size: u32(opt + 116 + i * 8) });
  return { b, pe, opt, count, table, sections, at, string, u32, directory };
}

export function windowsImports(bytes) {
  const p = image(bytes), dir = p.directory(1), imports = [];
  if (!dir.rva) return imports;
  if (dir.size < 20 || dir.size > 1024 * 1024) throw new Error('Invalid PE import directory');
  const start = p.at(dir.rva, dir.size);
  for (let offset = 0; offset + 20 <= dir.size; offset += 20) {
    const descriptor = start + offset, name = p.u32(descriptor + 12);
    if (!name) return imports;
    const thunk = p.u32(descriptor) || p.u32(descriptor + 16), symbols = [];
    for (let n = 0; ; n++) {
      if (n >= 4096) throw new Error('PE import symbol budget exceeded');
      const entry = p.b.readBigUInt64LE(p.at(thunk + n * 8, 8));
      if (entry === 0n) break;
      if (entry > 0xffffffffn) throw new Error('Ordinal or unsupported PE import');
      symbols.push(p.string(Number(entry) + 2));
    }
    imports.push({ dll: p.string(name), symbols, descriptor });
  }
  throw new Error('Unterminated PE import directory');
}

function exportsOf(bytes) {
  const p = image(bytes), dir = p.directory(0);
  if (!dir.rva) throw new Error('Host executable has no exports');
  const e = p.at(dir.rva, 40), count = p.u32(e + 24), names = p.u32(e + 32);
  if (count > 100000) throw new Error('PE export budget exceeded');
  return new Set(Array.from({ length: count }, (_, i) => p.string(p.u32(p.at(names + i * 4, 4)))));
}

/** Dawn's Windows prebuild imports node.exe directly. Bind ONLY its Node-API
 * imports to the actual Bun host, whose exports are checked before loading.
 * A fresh read-only data section holds the name, including longer compiled names.
 * Original installed/signed executables and the original addon remain untouched. */
export function relinkWindowsNodeApi(addon, executable, hostName) {
  if (!/^[A-Za-z0-9_. -]{1,120}\.exe$/i.test(hostName)) throw new Error('Invalid Windows host executable name');
  const p = image(addon), imports = windowsImports(addon), node = imports.filter(i => i.dll.toLowerCase() === 'node.exe');
  if (node.length !== 1) throw new Error('Expected one unmodified node.exe import');
  if (p.directory(4).rva || p.directory(4).size) throw new Error('Refusing to modify a signed addon');
  if (!node[0].symbols.length || node[0].symbols.some(s => !/^(napi_|node_api_)/.test(s))) throw new Error('Addon imports APIs beyond Node-API');
  const exports = exportsOf(executable), missing = node[0].symbols.filter(s => !exports.has(s));
  if (missing.length) throw new Error(`Bun host does not export required APIs: ${missing.join(', ')}`);
  const slot = p.table + p.count * 40, firstRaw = Math.min(...p.sections.filter(s => s.rawSize).map(s => s.raw));
  if (slot + 40 > firstRaw || p.b.subarray(slot, slot + 40).some(n => n !== 0)) throw new Error('No spare PE section header');
  const sectionAlign = p.u32(p.opt + 32), fileAlign = p.u32(p.opt + 36);
  if (fileAlign < 512 || fileAlign > 65536 || sectionAlign < fileAlign || sectionAlign > 0x1000000 || (fileAlign & (fileAlign - 1)) || (sectionAlign & (sectionAlign - 1))) throw new Error('Unsupported PE alignment');
  const name = Buffer.from(hostName + '\0', 'ascii'), raw = align(p.b.length, fileAlign), rawSize = align(name.length, fileAlign);
  const va = align(Math.max(...p.sections.map(s => s.va + Math.max(s.size, s.rawSize))), sectionAlign);
  const out = Buffer.alloc(raw + rawSize); p.b.copy(out); name.copy(out, raw);
  out.write('.bunapi', slot, 'ascii');
  out.writeUInt32LE(name.length, slot + 8); out.writeUInt32LE(va, slot + 12);
  out.writeUInt32LE(rawSize, slot + 16); out.writeUInt32LE(raw, slot + 20);
  out.writeUInt32LE(0x40000040, slot + 36); // initialized, readable, non-executable
  out.writeUInt16LE(p.count + 1, p.pe + 6);
  out.writeUInt32LE(align(va + name.length, sectionAlign), p.opt + 56);
  out.writeUInt32LE(p.u32(p.opt + 8) + rawSize, p.opt + 8);
  out.writeUInt32LE(0, p.opt + 64); // old checksum no longer describes this copy
  out.writeUInt32LE(va, node[0].descriptor + 12);
  out.writeUInt32LE(0, node[0].descriptor + 4); // resolve symbols in the host anew
  out.fill(0, p.opt + 112 + 11 * 8, p.opt + 112 + 12 * 8); // no stale bound imports
  return { bytes: out, metadata: { version: VERSION, hostName, sourceSha256: hash(p.b), sha256: hash(out), symbols: node[0].symbols } };
}

function writeAtomic(path, bytes) {
  const temp = path + `.${process.pid}.${Math.random().toString(16).slice(2)}.tmp`;
  try { writeFileSync(temp, bytes, { flag: 'wx' }); renameSync(temp, path); }
  finally { if (existsSync(temp)) unlinkSync(temp); }
}

/** Create/cache a separate compatibility copy; build calls this for its own exe. */
export function prepareWindowsDawn(addonPath, hostPath, outputPath) {
  const addon = readFileSync(addonPath), sourceSha256 = hash(addon), hostName = basename(hostPath);
  const manifestPath = outputPath + '.json';
  if (existsSync(outputPath) && existsSync(manifestPath)) {
    let m;
    try { m = JSON.parse(readFileSync(manifestPath, 'utf8')); } catch { /* rebuild an incomplete cache */ }
    if (m?.version === VERSION && m.sourceSha256 === sourceSha256 && m.hostName === hostName && Array.isArray(m.symbols) && m.symbols.length && m.sha256 === hash(readFileSync(outputPath))) {
      const exports = exportsOf(readFileSync(hostPath));
      if (m.symbols.every(s => exports.has(s))) return m;
    }
  }
  const result = relinkWindowsNodeApi(addon, readFileSync(hostPath), hostName);
  mkdirSync(dirname(outputPath), { recursive: true });
  writeAtomic(outputPath, result.bytes); writeAtomic(manifestPath, JSON.stringify(result.metadata, null, 2) + '\n');
  return result.metadata;
}

/** Packaged apps need no writable installation directory. Detect renames/tampering
 * before Windows can resolve a different executable's N-API functions. */
export function verifyWindowsDawn(path, hostPath) {
  const bytes = readFileSync(path), m = JSON.parse(readFileSync(path + '.json', 'utf8'));
  if (m.version !== VERSION || m.hostName.toLowerCase() !== basename(hostPath).toLowerCase() || m.sha256 !== hash(bytes)) throw new Error('Native Bun binding does not match this executable; rebuild native:compile after renaming');
  const bound = windowsImports(bytes).filter(i => i.dll.toLowerCase() === m.hostName.toLowerCase());
  if (bound.length !== 1 || windowsImports(bytes).some(i => i.dll.toLowerCase() === 'node.exe') && m.hostName.toLowerCase() !== 'node.exe') throw new Error('Invalid native Bun binding imports');
  const exports = exportsOf(readFileSync(hostPath));
  if (!bound[0].symbols.length || bound[0].symbols.some(s => !/^(napi_|node_api_)/.test(s) || !exports.has(s))) throw new Error('Native Bun binding requires unavailable host APIs');
  return m;
}
