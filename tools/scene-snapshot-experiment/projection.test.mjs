import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { compilerFingerprint, materialNamesFromRust, project, rustByteToUtf16 } from './projection.mjs';

const compiler = readFileSync(new URL('../../compiler/src/lib.rs', import.meta.url), 'utf8');
const materials = materialNamesFromRust(compiler);

test('build-time compiler fingerprint is deterministic and changes after an edit', () => {
  assert.equal(compilerFingerprint(Buffer.from('')), 'cbf29ce484222325');
  assert.equal(compilerFingerprint(Buffer.from('a')), 'af63dc4c8601ec8c');
  assert.notEqual(compilerFingerprint(Buffer.from(compiler)), compilerFingerprint(Buffer.from(compiler + '\n')));
});

test('material catalog is extracted from Rust and fails closed after declaration changes', () => {
  assert.equal(materials.length, 11);
  assert(materials.includes('glass'));
  assert.throws(() => materialNamesFromRust(compiler.replace('const MATERIALS:', 'const NEW_MATERIALS:')));
  assert.throws(() => materialNamesFromRust(compiler.replace('[&str; 11]', '[&str; 12]')));
  assert.throws(() => materialNamesFromRust('// const MATERIALS: [&str; 1] = ["fake"];\n' + compiler));
  assert.throws(() => materialNamesFromRust(compiler.replace('"default", "glass"', '"default", /* "glass" */')));
});

test('Rust byte offsets map astral Unicode, Cyrillic, CRLF and literal replacement characters', () => {
  const source = '// 🌍 Привет �\r\nworld X { let x = missing }';
  for (const value of ['Привет', '�', 'world', 'missing']) {
    const expected = source.indexOf(value);
    assert.equal(rustByteToUtf16(source, Buffer.byteLength(source.slice(0, expected))), expected);
  }
  assert.equal(rustByteToUtf16(source, Buffer.byteLength(source)), source.length);
  const astralByte = Buffer.byteLength(source.slice(0, source.indexOf('🌍')));
  assert.throws(() => rustByteToUtf16(source, astralByte + 1));
  assert.throws(() => rustByteToUtf16(source, -1));
});

test('verbatim identifier and material alias spans retain original UTF-16 offsets', () => {
  const source = '// 🌍\nworld X {\nlet a = 1m\nlet b = missing / 2\nmaterial: banana\n}';
  const output = project(source, materials);
  assert(output.text.includes('const b: number = missing / 0'));
  const missing = output.mappings.find(span => output.text.slice(span[0], span[0] + span[1]) === 'missing');
  assert.deepEqual(missing.slice(2), [source.indexOf('missing'), 7, 0]);
  const aliases = output.mappings.filter(span => span[4] === 2);
  assert.equal(aliases.length, 1);
  assert.deepEqual(aliases[0].slice(2), [source.indexOf('banana'), 6, 2]);
  for (let index = 1; index < output.mappings.length; index++) {
    assert(output.mappings[index - 1][0] + output.mappings[index - 1][1] <= output.mappings[index][0], 'virtual spans must not overlap');
  }
});

test('unsupported World authoring stays Rust-only without manufactured TS syntax', () => {
  for (const source of [
    'world X {let a=1 let b=2}',
    'world X {let a=1 seed: 2}',
    'world X {let class=1}',
    'world X {let élève=1}',
    'world X {let foo-bar=1}',
    'world X {let a=foo-bar / 2}',
    'world X {let a=class / 2}',
    'world X {let a=1 let b=2\nlet c=a}',
    'world X {let eval=1\nlet arguments=2}',
  ]) assert.equal(project(source, materials).mappings.length, 0, source);
  assert.equal(project('// let missing=absent\n# material: banana\nworld X {}', materials).mappings.length, 0);
  const collision = project('world X {let __material0=1m; entity e {material:glass}}', materials);
  assert(collision.text.includes('const __material0: number'));
  assert(collision.text.includes('{ const __material0: __WorldMaterial'));
  const leadingZero = project('world X {let a=01\nlet b=000.1\nlet c=a/b}', materials);
  assert(leadingZero.text.includes('const a: number = 0'));
  assert(leadingZero.text.includes('const b: number = 0'));
});
