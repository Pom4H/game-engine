import assert from 'node:assert/strict';
import {readFileSync, writeFileSync, mkdirSync, existsSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {resolve} from 'node:path';
import {platform, arch} from 'node:os';
import {decodeTankContract, earliestGuaranteedReachUs, TankContractRuntime} from '../../dist/world-ir/tank-contract.js';
const compiler = process.env.WORLD_CONTRACT_COMPILER;
const jsonOnly = process.argv.slice(2).includes('--json-only');
if (!compiler && !jsonOnly) throw new Error('Set WORLD_CONTRACT_COMPILER, or explicitly select --json-only (not cross-language verification)');
const source = resolve('examples/world-contracts/tank-en.wcontract');
const compile = args => {
  assert.ok(existsSync(compiler), 'Native compiler executable is missing');
  const p = spawnSync(compiler, args, {encoding: 'utf8', timeout: 15_000});
  assert.equal(p.status, 0, p.stderr || String(p.error)); return JSON.parse(p.stdout);
};
const baseline = JSON.parse(readFileSync('examples/world-contracts/tank.json', 'utf8'));
const model = decodeTankContract(compiler ? compile([source]) : baseline);
assert.deepEqual(model, baseline);
if (compiler) assert.deepEqual(compile([resolve('examples/world-contracts/tank-ru.wcontract')]), model);
const make = initial => new TankContractRuntime(model, {initialVolumeUl: initial, authorize: () => true});
const rows = [];
for (const elapsed of [10_000_000n, 10_200_000n]) {
  const reference = compiler ? compile(['--oracle', source, String(elapsed)]) : null;
  for (const [initial, label, key] of [[69n, 'lower', 'lowerPl'], [70n, 'nominal', 'nominalPl'], [71n, 'upper', 'upperPl']]) {
    const stepped = make(initial * 1_000_000n), eventDriven = make(initial * 1_000_000n);
    stepped.requestStart(); eventDriven.requestStart();
    stepped.advance(elapsed); eventDriven.advance(elapsed, 'event-driven', eventDriven.certify(elapsed));
    assert.deepEqual(stepped.snapshot(), eventDriven.snapshot());
    assert.deepEqual(stepped.events(), eventDriven.events());
    if (reference) assert.equal(eventDriven.snapshot().volumePl, BigInt(reference[key]));
    rows.push({initial: label, elapsedUs: elapsed, volumePl: stepped.snapshot().volumePl,
      steppedSegments: stepped.diagnostics.segments, eventDrivenSegments: eventDriven.diagnostics.segments,
      reachedAtUs: stepped.snapshot().reachedAtUs, status: stepped.goalStatus()});
  }
}
const report = {
  schema: 'world-contract-proof@1', commit: process.env.GITHUB_SHA ?? null,
  runner: process.env.RUNNER_NAME ?? 'local-sandbox', platform: platform(), arch: arch(), node: process.version,
  checks: {kernelVariantsAgree: true, canonicalJsonAgrees: true, russianEnglishAgree: Boolean(compiler),
    independentRustOracle: Boolean(compiler), llmEvaluation: false, gpuBenchmark: false},
  guaranteeAtUs: earliestGuaranteedReachUs(model), rows,
  limitation: 'Exact affine scalar tank and 1 us event lattice. Two temporal execution strategies, NOT CFD LOD, rendering FPS, or a machine-checked theorem.',
};
const json = JSON.stringify(report, (_key, value) => typeof value === 'bigint' ? String(value) : value, 2) + '\n';
mkdirSync('artifacts/world-contracts', {recursive: true});
writeFileSync('artifacts/world-contracts/proof.json', json);
console.log(json);
