import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync, existsSync, mkdtempSync, writeFileSync, rmSync} from 'node:fs';
import {resolve, join} from 'node:path';
import {tmpdir} from 'node:os';
import {spawnSync} from 'node:child_process';
import {decodeTankContract, earliestGuaranteedReachUs, TankContractRuntime} from '../dist/world-ir/tank-contract.js';
const sourcePath = resolve('examples/world-contracts/tank-en.wcontract');
const canonical = JSON.parse(readFileSync('examples/world-contracts/tank.json', 'utf8'));
const clone = () => structuredClone(canonical);
const runtime = (c = canonical, initial = BigInt(c.observation.volumeUl), authorize = () => true) =>
  new TankContractRuntime(c, {initialVolumeUl: initial, authorize});
const fast = (r, t) => r.advance(t, 'event-driven', r.certify(t));

test('decoder freezes the canonical model without retaining mutable author input', () => {
  const c = clone(), decoded = decodeTankContract(c); c.observation.volumeUl = '1';
  assert.equal(decoded.observation.volumeUl, '70000000'); assert.ok(Object.isFrozen(decoded.observation));
});
test('untrusted JSON: unknown fields, schema, temporal operators and numeric coercions fail closed', () => {
  for (const mutate of [c => c.extra = true, c => c.schema = 'next', c => c.goal.kind = 'may',
    c => c.observation.volumeUl = 70, c => c.observation.volumeUl = '070', c => c.observation.errorUl = 'NaN',
    c => c.assumptions.flowUlPerSecond = '0', c => delete c.assumptions.startDelayUs,
    c => c.observation.errorUl = '80000000', c => c.goal.withinUs = '0']) {
    const c = clone(); mutate(c); assert.throws(() => decodeTankContract(c));
  }
});
test('observation interval requires an explicit simulated initial state', () => {
  assert.throws(() => new TankContractRuntime(canonical, {}));
  assert.throws(() => runtime(canonical, 68_000_000n));
  assert.equal(runtime(canonical, 69_000_000n).snapshot().volumePl, 69_000_000_000_000n);
});
test('goal and measurement do not start the pump', () => {
  const r = runtime(); fast(r, 10_000_000n);
  assert.equal(r.snapshot().volumePl, 70_000_000_000_000n); assert.equal(r.goalStatus(), 'pending');
});
test('denied requests leave state and causal journal unchanged; authorization is checked each time', () => {
  let allow = false; const r = runtime(canonical, 70_000_000n, () => allow), before = r.snapshot();
  assert.throws(() => r.requestStart(), /authorized/); assert.equal(r.snapshot(), before); assert.deepEqual(r.events(), []);
  allow = true; r.requestStart(); allow = false; assert.throws(() => r.requestStop(), /authorized/);
});
test('requests are not acknowledgements, including a delayed acknowledgement at the exact endpoint', () => {
  const c = clone(); c.assumptions.startDelayUs = '200001'; const r = runtime(c); r.requestStart();
  assert.equal(r.snapshot().running, false); fast(r, 200000n); assert.equal(r.snapshot().running, false);
  fast(r, 200001n); assert.equal(r.snapshot().running, true); assert.equal(r.snapshot().volumePl, 70_000_000_000_000n);
  assert.deepEqual(r.events().map(e => [e.kind, e.atUs]), [['start-requested', 0n], ['started', 200001n]]);
});
test('70 ± 1 L plus 5 L/s is 119..121 L at 10 s; guarantee is 10.2 s, not 10 s', () => {
  assert.equal(earliestGuaranteedReachUs(canonical), 10_200_000n);
  const values = [69n, 70n, 71n].map(v => {const r = runtime(canonical, v * 1_000_000n); r.requestStart(); fast(r, 10_000_000n); return r.snapshot().volumePl;});
  assert.deepEqual(values, [119n, 120n, 121n].map(v => v * 1_000_000_000_000n));
});
test('ordinary evolution keeps a certificate valid, including backend switches and pending actuator memory', () => {
  const c = clone(); c.assumptions.startDelayUs = '12001'; const a = runtime(c), b = runtime(c);
  a.requestStart(); b.requestStart(); const cert = a.certify(12_000_000n);
  a.advance(5000n, 'stepped'); a.advance(8000n, 'event-driven', cert); a.advance(12001n, 'stepped'); a.advance(12_000_000n, 'event-driven', cert);
  b.advance(12_000_000n, 'stepped'); assert.deepEqual(a.snapshot(), b.snapshot()); assert.deepEqual(a.events(), b.events());
  assert.equal(a.diagnostics.kernel.compiledPrograms, 2);
});
test('flow, failure, external volume and action changes invalidate certificates automatically', () => {
  for (const mutate of [r => r.setFlowUlPerSecond(4_000_000n), r => r.failPump(), r => r.applyVolumeDisturbanceUl(-1n), r => r.requestStop()]) {
    const r = runtime(); r.requestStart(); const cert = r.certify(10_000_000n); mutate(r);
    assert.throws(() => r.advance(1n, 'event-driven', cert), /certificate/);
  }
  const r = runtime(), cert = r.certify(1_000_000n); r.requestStart();
  assert.throws(() => r.advance(1n, 'event-driven', cert), /certificate/);
});
test('snapshots cannot mutate authority; stale, foreign and forged certificates fail closed', () => {
  const a = runtime(), b = runtime(), cert = a.certify(1_000_000n);
  assert.throws(() => a.snapshot().volumePl = 1n, TypeError);
  assert.throws(() => a.contract = canonical, TypeError);
  for (const candidate of [undefined, {...cert}, b.certify(1_000_000n)])
    assert.throws(() => a.advance(1n, 'event-driven', candidate), /certificate/);
  assert.throws(() => a.advance(1_000_001n, 'event-driven', cert), /certificate/);
});
test('unknown observables and unsafe certificate horizons cannot acquire a guarantee', () => {
  const r = runtime(); r.requestStart();
  assert.throws(() => r.certify(1_000_000n, ['wave-height']), /observable/);
  assert.throws(() => r.certify(30_000_000n), /capacity/);
});
test('capacity failure is atomic, never a hidden clamp or successful goal', () => {
  const r = runtime(); r.requestStart(); const before = r.snapshot(), events = r.events(), d = r.diagnostics;
  assert.throws(() => r.advance(30_000_000n), /Capacity/);
  assert.equal(r.snapshot(), before); assert.deepEqual(r.events(), events); assert.deepEqual(r.diagnostics, d);
});
test('pump failure cancels a pending acknowledgement without inventing flow', () => {
  const c = clone(); c.assumptions.startDelayUs = '1000000'; const r = runtime(c); r.requestStart(); r.failPump();
  fast(r, 30_000_000n); assert.equal(r.goalStatus(), 'missed'); assert.equal(r.snapshot().running, false);
  assert.equal(r.snapshot().volumePl, 70_000_000_000_000n); assert.ok(!r.events().some(e => e.kind === 'started'));
});
test('reach has historical semantics, not maintain; a late reach is missed', () => {
  const r = runtime(); r.requestStart(); fast(r, 10_000_000n); r.requestStop(); r.applyVolumeDisturbanceUl(-2_000_000n);
  assert.equal(r.goalStatus(), 'satisfied');
  const c = clone(); c.goal.withinUs = '9000000'; const late = runtime(c); late.requestStart(); fast(late, 10_000_000n);
  assert.equal(late.goalStatus(), 'missed');
});
test('already reached goals need no startup delay and are satisfied at the observation epoch', () => {
  const c = clone(); c.goal.volumeUl = '68000000'; c.assumptions.startDelayUs = '999999'; c.observation.atUs = '7000000';
  assert.equal(earliestGuaranteedReachUs(c), 7_000_000n); assert.equal(runtime(c).goalStatus(), 'satisfied');
});
test('invalid time and backend inputs do not mutate state', () => {
  const r = runtime(), before = r.snapshot();
  for (const t of [0n, -1n, 100_000_001n, NaN, 1]) assert.throws(() => r.advance(t));
  assert.throws(() => r.advance(1n, 'magic')); assert.equal(r.snapshot(), before);
});
test('128 non-round parameter cases preserve exact mass and event times in both kernel variants', () => {
  for (let i = 1; i <= 128; i++) {
    const c = clone(); c.assumptions.flowUlPerSecond = String(3_000_000 + i * 7919); c.assumptions.startDelayUs = String(i * 103);
    c.observation.atUs = String(i * 111); c.goal.volumeUl = String(70_000_001 + i * 333);
    const a = runtime(c), b = runtime(c); a.requestStart(); b.requestStart();
    const t = BigInt(c.observation.atUs) + 1_000_003n; a.advance(t); fast(b, t);
    const expected = 70_000_000_000_000n + BigInt(c.assumptions.flowUlPerSecond) * (1_000_003n - BigInt(c.assumptions.startDelayUs));
    assert.equal(a.snapshot().volumePl, expected); assert.deepEqual(a.snapshot(), b.snapshot()); assert.deepEqual(a.events(), b.events());
  }
});

// Ordinary engine tests remain usable without a native toolchain. The dedicated CI sets this
// path and therefore makes EVERY cross-language test mandatory (including a missing executable).
const compiler = process.env.WORLD_CONTRACT_COMPILER;
const runCompiler = args => {
  assert.ok(existsSync(compiler), 'WORLD_CONTRACT_COMPILER must point at the built executable');
  const p = spawnSync(compiler, args, {encoding: 'utf8', timeout: 15_000});
  assert.equal(p.status, 0, p.stderr || String(p.error)); return JSON.parse(p.stdout);
};
test('Rust EN/RU sources and typed JSON baseline produce identical canonical contracts', {skip: !compiler}, () => {
  assert.deepEqual(runCompiler([sourcePath]), canonical);
  assert.deepEqual(runCompiler([resolve('examples/world-contracts/tank-ru.wcontract')]), canonical);
});
test('independent Rust closed-form oracle agrees for interval endpoints and guarantee time', {skip: !compiler}, () => {
  for (const t of [1n, 123457n, 9_999_999n, 10_000_000n, 10_200_000n]) {
    const reference = runCompiler(['--oracle', sourcePath, String(t)]);
    for (const [v, key] of [[69n, 'lowerPl'], [70n, 'nominalPl'], [71n, 'upperPl']]) {
      const r = runtime(canonical, v * 1_000_000n); r.requestStart(); fast(r, t);
      assert.equal(r.snapshot().volumePl, BigInt(reference[key]));
    }
    assert.equal(earliestGuaranteedReachUs(canonical), BigInt(reference.guaranteedAtUs));
  }
});
test('Rust rejects contrastive semantic errors rather than picking a convenient interpretation', {skip: !compiler}, () => {
  const dir = mkdtempSync(join(tmpdir(), 'world-contract-'));
  try {
    const original = readFileSync(sourcePath, 'utf8');
    for (const [a, b] of [['reach', 'may'], ['reach', 'not'], ['flow: 5 L/s', 'flow: 5 L'], ['start_delay: 0 s\n', '']]) {
      const path = join(dir, 'bad.wcontract'); writeFileSync(path, original.replace(a, b));
      const p = spawnSync(compiler, [path], {encoding: 'utf8', timeout: 15_000});
      assert.equal(p.status, 2); assert.equal(p.stdout, ''); assert.ok(p.stderr.length > 0);
    }
  } finally {rmSync(dir, {recursive: true, force: true});}
});
