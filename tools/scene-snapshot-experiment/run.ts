import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { API, type Diagnostic, type Program } from 'typescript/sync';
import { createFileSystemLayer } from 'typescript/fs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const sourceDir = join(root, 'tools/scene-snapshot-experiment');
const output = join(root, 'artifacts/scene-snapshot71-20261021');
const projectDir = join(output, 'project');
const bridge = join(output, 'worldc-editor.exe');
const log = join(output, 'mapper-calls.jsonl');
const configFile = join(projectDir, 'tsconfig.json');
const mode = process.argv[2] ?? 'verify';
assert(['verify', 'benchmark'].includes(mode));
mkdirSync(projectDir, { recursive: true });
const compilerSource = join(root, 'compiler/src/lib.rs');
const sha = (value: string | Uint8Array) => createHash('sha256').update(value).digest('hex');
const rust = (source: string, repeat = 1) => {
  const result = spawnSync(bridge, [String(repeat)], { input: source, encoding: 'utf8', windowsHide: true, timeout: 10000, maxBuffer: 16 * 1024 * 1024 });
  assert.equal(result.status, 0, result.stderr || String(result.error));
  return JSON.parse(result.stdout) as { ok: boolean; bytesHex?: string; at?: number; message?: string; compileNanos: number[] };
};
const examples = ['array', 'collision', 'coupled-glass', 'physical-hearing'].map(name => ({ name, text: readFileSync(join(root, `examples/worlds/${name}.world`), 'utf8') }));
const fixtureText = `// UTF-16 mapping: 🌍 Привет\nworld Editor {\n  let spacing = 75cm\n  let radius = spacing / 2\n  entity pane { mesh: box(radius, 1m, 1m); material: glass; body: static }\n}\n`;
interface Fixture { name: string; text: string; ok: boolean; rustMessage?: string; tsCode?: number; token?: string }
const cases: Fixture[] = [
  { name: 'valid', text: fixtureText, ok: true },
  { name: 'valid-generated-name', text: 'world W { let __material0 = 1m; entity e { mesh:box(1m,1m,1m); material:glass } }', ok: true },
  { name: 'valid-semicolon-free', text: 'world W { let a = 1 let b = 2\nlet c = a\n}', ok: true },
  { name: 'valid-unicode-binding', text: 'world W {let élève=1\nlet c=élève\n}', ok: true },
  { name: 'valid-hyphen-binding', text: 'world W {let foo-bar=1\nlet c=foo-bar\n}', ok: true },
  { name: 'valid-strict-bindings', text: 'world W {let eval=1\nlet arguments=2\n}', ok: true },
  { name: 'valid-leading-zero', text: 'world W {let a=01\nlet b=000.1\nlet c=a/b\n}', ok: true },
  { name: 'unknown-symbol', text: fixtureText.replace('spacing / 2', 'missing / 2'), ok: false, rustMessage: 'unknown constant', tsCode: 2304, token: 'missing' },
  { name: 'material-type', text: fixtureText.replace('material: glass', 'material: banana'), ok: false, rustMessage: 'unknown material', tsCode: 2322, token: 'banana' },
  { name: 'dimension', text: fixtureText.replace('spacing / 2', 'spacing + 3kg'), ok: false, rustMessage: 'cannot add or subtract' },
  { name: 'division-zero', text: fixtureText.replace('spacing / 2', 'spacing / 0'), ok: false, rustMessage: 'division by zero' },
  { name: 'parse', text: fixtureText.replace('world Editor {', 'world Editor ('), ok: false, rustMessage: 'expected LBrace' },
  { name: 'coupling-cycle', text: 'world Cycle { coupling a {from: fluid.pressure to: acoustic.pressure after: b} coupling b {from: acoustic.pressure to: fluid.pressure} }', ok: false, rustMessage: 'cyclic' },
  { name: 'coupling-type', text: 'world Wrong { coupling bad {from: physics.contact.energy to: acoustic.pressure} }', ok: false, rustMessage: 'dimension mismatch' },
  { name: 'duplicate-id', text: 'world IDs { entity pane {mesh: sphere(1m)} entity pane {mesh: sphere(1m)} }', ok: false, rustMessage: 'duplicate' },
];
const files: Array<Fixture & { fileName: string }> = [...examples.map(value => ({ ...value, ok: true })), ...cases].map(value => ({ ...value, fileName: join(projectDir, `${value.name}.scene`) }));
for (const file of files) writeFileSync(file.fileName, file.text);
// This package is private to the experiment, not installed in the engine/game.
const mapperPackage = join(projectDir, 'node_modules/@engine/scene-editor-experiment');
mkdirSync(mapperPackage, { recursive: true });
writeFileSync(join(mapperPackage, 'package.json'), JSON.stringify({ name: '@engine/scene-editor-experiment', version: '0.0.0-experiment', typescript: { contentMapper: { exec: [process.execPath, join(sourceDir, 'mapper.mjs')], compilerOptions: [], dynamicConfig: true } } }, null, 2));
writeFileSync(configFile, JSON.stringify({ compilerOptions: { strict: true, noEmit: true, target: 'ES2022', module: 'ESNext', types: [], skipLibCheck: true }, files: files.map(file => file.fileName), contentMappers: [{ package: '@engine/scene-editor-experiment', extensions: ['.scene'], options: { bridge, compilerSource, log } }] }, null, 2));
writeFileSync(log, '');

const diagnostics = (program: Program): readonly Diagnostic[] => [
  ...program.getGlobalDiagnostics(), ...program.getProgramDiagnostics(),
  ...program.getSyntacticDiagnostics(), ...program.getSemanticDiagnostics(),
];
const plain = (diagnostic: Diagnostic) => ({ fileName: diagnostic.fileName, pos: diagnostic.pos, end: diagnostic.end, startPosition: diagnostic.startPosition, code: diagnostic.code, source: diagnostic.source, text: diagnostic.text });

const started = performance.now();
using api = new API({ cwd: projectDir, runExternalCode: true, collectTiming: true });
using before = api.createSnapshot({ openProjects: [configFile], ensurePrograms: true });
const beforeProject = before.getConfiguredProject(configFile);
assert(beforeProject, 'Configured experiment project must be loaded');
using beforeProgram = before.getProgram(beforeProject.id)!;
const beforeDiagnostics = diagnostics(beforeProgram);
const coldMs = performance.now() - started;
writeFileSync(join(output, 'diagnostics.json'), JSON.stringify(beforeDiagnostics.map(plain), null, 2));
const verify = files.map(file => {
  const baseline = rust(file.text);
  assert.equal(baseline.ok, file.ok, file.name);
  const own = beforeDiagnostics.filter(diagnostic => diagnostic.fileName?.replaceAll('\\', '/').toLowerCase() === file.fileName.replaceAll('\\', '/').toLowerCase());
  if (file.ok) assert.equal(own.length, 0, `${file.name}: ${JSON.stringify(own)}`);
  else {
    assert(baseline.message!.includes(file.rustMessage ?? ''));
    assert(own.some(diagnostic => diagnostic.source === 'worldc' && diagnostic.text === baseline.message), `${file.name}: preserve Rust diagnostic: ${JSON.stringify(own)}`);
  }
  if (file.tsCode !== undefined) {
    assert(file.token);
    const mapped = own.find(diagnostic => diagnostic.code === file.tsCode && !diagnostic.source);
    assert(mapped, `${file.name}: expected mapped TS diagnostic ${file.tsCode}: ${JSON.stringify(own)}`);
    const expected = file.text.indexOf(String(file.token));
    assert.equal(mapped.pos, expected, `${file.name}: mapped original UTF-16 offset`);
    assert.equal(mapped.end, expected + String(file.token).length, `${file.name}: mapped original token length`);
  }
  assert.equal(own.filter(diagnostic => !diagnostic.source).length, file.tsCode === undefined ? 0 : 1, `${file.name}: no manufactured TS diagnostics`);
  return { name: file.name, sourceSha: sha(file.text), rust: baseline.ok ? { ok: true, wscnSha: sha(Buffer.from(baseline.bytesHex!, 'hex')) } : { ok: false, at: baseline.at, message: baseline.message }, diagnostics: own.map(plain) };
});

const changedFile = files.find(file => file.name === 'unknown-symbol')!;
const fixedText = changedFile.text.replace('missing / 2', 'spacing / 2');
const logCount = readFileSync(log, 'utf8').trim().split('\n').length;
const updateStart = performance.now();
using after = before.update({ fileSystem: createFileSystemLayer([[changedFile.fileName, fixedText]]), ensurePrograms: [beforeProgram.id] });
using afterProgram = after.getProgram(beforeProgram.id)!;
const afterDiagnostics = diagnostics(afterProgram);
const updateMs = performance.now() - updateStart;
assert.equal(afterProgram.id, beforeProgram.id, 'Program identity survives snapshot update');
assert.equal(afterDiagnostics.length, beforeDiagnostics.length - 2, 'Only the one-file unknown-symbol diagnostics disappear');
assert.deepEqual(diagnostics(beforeProgram).map(plain), beforeDiagnostics.map(plain), 'Old snapshot remains immutable and readable');
const allLog = readFileSync(log, 'utf8').trim().split('\n').map(line => JSON.parse(line));
const updateLog = allLog.slice(logCount);
assert.equal(updateLog.length, 1, 'Exactly one .scene file should be remapped');
assert.equal(resolve(updateLog[0].fileName).toLowerCase(), changedFile.fileName.toLowerCase());
assert.equal(updateLog[0].wscnSha, sha(Buffer.from(rust(fixedText).bytesHex!, 'hex')), 'Editor mapper and Rust baseline emit identical WSCN');
for (const item of verify) if (item.rust.ok) {
  const recorded = allLog.find(itemLog => itemLog.sourceSha === item.sourceSha);
  assert.equal(recorded?.wscnSha, item.rust.wscnSha, `${item.name}: exact Rust WSCN output`);
}

const report: Record<string, unknown> = { mode, timestamp: new Date().toISOString(), node: process.version, typescript: JSON.parse(readFileSync(join(root, 'node_modules/typescript/package.json'), 'utf8')).version, compilerSourceSha: sha(readFileSync(compilerSource)), bridgeSourceSha: sha(readFileSync(join(sourceDir, 'bridge.rs'))), compilerArchitecture: 'Rust remains parser, semantic and WSCN authority. TS only checks a deliberately partial editor projection. No runtime import or emit.', coldApiAndDiagnosticsMs: coldMs, firstOneFileSnapshotUpdateMs: updateMs, cases: verify, incremental: { beforeSnapshot: before.id, afterSnapshot: after.id, stableProgramId: beforeProgram.id, oldSnapshotUnchanged: true, remappedFiles: updateLog.map(item => item.fileName), beforeDiagnosticCount: beforeDiagnostics.length, afterDiagnosticCount: afterDiagnostics.length } };
report.toolingSources = ['bridge.rs', 'mapper.mjs', 'projection.mjs', 'run.ts'].map(name => {
  const contents = readFileSync(join(sourceDir, name));
  return { name, sha256: sha(contents), lines: contents.toString().split('\n').length - 1 };
});
report.diagnosticCoverage = { invalidCases: verify.filter(item => !item.rust.ok).length, rustDetected: verify.filter(item => !item.rust.ok && item.diagnostics.some(diagnostic => diagnostic.source === 'worldc')).length, typescriptAloneDetected: verify.filter(item => !item.rust.ok && item.diagnostics.some(diagnostic => !diagnostic.source)).length, combinedDetected: verify.filter(item => !item.rust.ok && item.diagnostics.length > 0).length, validCases: verify.filter(item => item.rust.ok).length };
if (mode === 'benchmark') {
  const samples: Array<{ mode: string; ms: number; sourceSha: string; mapperCalls: number }> = [];
  // Cohorts alternate warm full-snapshot creation and one-file snapshot update.
  // Both force all diagnostics, including exactly one new transform. Distinct
  // source versions prevent the content-transform cache from hiding work.
  for (let round = 0; round < 12; round++) {
    for (const cohort of round % 2 ? ['update', 'fresh'] : ['fresh', 'update']) {
      const newText = fixedText.replace('75cm', `${75 + round / 10}cm`) + `// ${cohort} version ${round}\n`;
      const beforeCalls = readFileSync(log, 'utf8').trim().split('\n').length;
      const start = performance.now();
      if (cohort === 'fresh') {
        using fresh = api.createSnapshot({ fileSystem: createFileSystemLayer([[changedFile.fileName, newText]]), openProjects: [configFile], ensurePrograms: true });
        using program = fresh.getProgram(fresh.getConfiguredProject(configFile)!.id)!;
        assert.equal(diagnostics(program).length, afterDiagnostics.length);
      } else {
        using next = before.update({ fileSystem: createFileSystemLayer([[changedFile.fileName, newText]]), ensurePrograms: [beforeProgram.id] });
        using program = next.getProgram(beforeProgram.id)!;
        assert.equal(diagnostics(program).length, afterDiagnostics.length);
      }
      const elapsed = performance.now() - start;
      const calls = readFileSync(log, 'utf8').trim().split('\n').slice(beforeCalls).map(line => JSON.parse(line));
      assert.equal(calls.length, 1, `${cohort}: one new source version must cause exactly one transform`);
      assert.equal(calls[0].sourceSha, sha(newText));
      samples.push({ mode: cohort, ms: elapsed, sourceSha: sha(newText), mapperCalls: calls.length });
    }
  }
  const baselineSamples = [];
  for (let index = 0; index < 12; index++) {
    const start = performance.now();
    assert(rust(fixedText).ok);
    baselineSamples.push(performance.now() - start);
  }
  report.benchmark = { fixtureFiles: files.length, oneFileBytes: Buffer.byteLength(fixedText), samples, rustCliProcessAndCompileMs: baselineSamples, rustCompileOnlyNanos: rust(fixedText, 32).compileNanos, notes: 'Small editor experiment, not game FPS or a production-scale project. Fresh snapshots use the same live API process; coldApiAndDiagnosticsMs includes API startup. Rust compile-only values exclude process/JSON/projection/TS costs. Both warm cohorts get unique one-file semantic edits (spacing changed), confirmed by exactly one new mapper invocation. Each derives from the same before snapshot, not a typing time series.' };
}
writeFileSync(join(output, `${mode}-report.json`), JSON.stringify(report, null, 2));
appendFileSync(join(output, 'runs.jsonl'), JSON.stringify({ mode, timestamp: report.timestamp, coldMs, updateMs, passed: true }) + '\n');
console.log(JSON.stringify({ mode, passed: true, cases: verify.length, beforeDiagnostics: beforeDiagnostics.length, afterDiagnostics: afterDiagnostics.length, coldMs, updateMs, report: join(output, `${mode}-report.json`) }, null, 2));
