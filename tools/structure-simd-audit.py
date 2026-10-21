#!/usr/bin/env python3
"""Local-only validation; never dispatches CI or installs a toolchain.

python tools/structure-simd-audit.py [--wasm]
Missing prerequisites are BLOCKED, not a successful test or benchmark.
"""
from __future__ import annotations
import argparse
import json
import os
from pathlib import Path
import platform
import re
import shutil
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[1]
MANIFEST = ROOT / 'kernels/world-structure/Cargo.toml'


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--wasm', action='store_true', help='Also build both WASM variants and run Node ABI parity')
    parser.add_argument('--out', type=Path, default=MANIFEST.parent / 'target/simd-audit')
    args = parser.parse_args()
    out = args.out.resolve()
    out.mkdir(parents=True, exist_ok=True)
    report = {'status': 'running', 'scope': 'XPBD distance projections, not engine FPS',
              'machine': platform.platform(), 'processor': platform.processor(),
              'commands': [], 'native_tests': 'not_run', 'native_benchmark': 'not_run',
              'native_assembly': 'not_run', 'wasm_parity': 'not_run', 'wasm_assembly': 'not_run'}

    def save() -> None:
        (out / 'report.json').write_text(json.dumps(report, indent=2)+'\n', encoding='utf-8')

    def run(command: list[str], name: str, env: dict[str, str]) -> str:
        report['commands'].append(command)
        result = subprocess.run(command, cwd=ROOT, env=env, capture_output=True, text=True,
                                encoding='utf-8', errors='replace', timeout=240)
        (out / (name+'.stdout')).write_text(result.stdout, encoding='utf-8')
        (out / (name+'.stderr')).write_text(result.stderr, encoding='utf-8')
        if result.returncode:
            raise RuntimeError(f'{name}: exit {result.returncode}; inspect {out / (name+".stderr")}')
        return result.stdout

    required = ['cargo', 'rustc'] + (['node'] if args.wasm else [])
    missing = [tool for tool in required if shutil.which(tool) is None]
    if missing:
        report.update(status='blocked', reason='Missing tools: '+', '.join(missing))
        save(); print(json.dumps(report, indent=2)); return 2
    env = os.environ.copy()
    # A reproducible baseline: do not inherit user fast-math/ISA overrides.
    env.pop('CARGO_ENCODED_RUSTFLAGS', None)
    env['RUSTFLAGS'] = ''
    env['CARGO_TARGET_DIR'] = str(out / 'native')
    try:
        version = run(['rustc', '-vV'], 'rustc', env)
        report['rustc'] = version
        host = next(line.split(': ', 1)[1] for line in version.splitlines() if line.startswith('host: '))
        if not host.startswith('x86_64-'):
            report.update(status='blocked', reason=f'Native assembly gate currently targets x86_64, got {host}')
            save(); print(json.dumps(report, indent=2)); return 2
        env['RUSTFLAGS'] = '-C target-feature=-fma'
        report['native_rustflags'] = env['RUSTFLAGS']
        common = ['--manifest-path', str(MANIFEST), '--release']
        run(['cargo', 'test', *common, '--lib'], 'native-reference-tests', env)
        run(['cargo', 'test', *common, '--lib', '--features', 'simd-distance'], 'native-simd-tests', env)
        report['native_tests'] = 'passed'
        csv = run(['cargo', 'run', *common, '--features', 'simd-distance', '--example', 'distance_bench'], 'native-benchmark', env)
        (out / 'benchmark.csv').write_text(csv, encoding='utf-8')
        report['native_benchmark'] = 'passed; measurements in benchmark.csv'
        run(['cargo', 'rustc', *common, '--features', 'simd-distance', '--example', 'distance_bench', '--', '--emit=asm'], 'native-asm-build', env)
        candidates = list((out / 'native/release/examples').glob('distance_bench*.s'))
        if not candidates:
            raise RuntimeError('Compiler produced no benchmark assembly')
        assembly = max(candidates, key=lambda p: p.stat().st_mtime).read_text(encoding='utf-8')
        match = re.search(r'^structure_simd_sweep:[^\n]*\n', assembly, re.M)
        if match is None:
            raise RuntimeError('Missing named structure_simd_sweep assembly symbol')
        tail = assembly[match.start():]
        end = re.search(r'^\s*(?:\.Lfunc_end\d+:|\.seh_endproc\b|\.size\s+structure_simd_sweep\b)', tail, re.M)
        if end is None:
            raise RuntimeError('Cannot isolate SIMD symbol; refusing a whole-file false positive')
        body = tail[:end.end()]
        for opcode in [r'\bv?sqrtpd\b', r'\bv?divpd\b']:
            if re.search(opcode, body) is None:
                raise RuntimeError(f'Missing packed operation {opcode} inside SIMD hot function')
        if re.search(r'\bv?fn?m(?:add|sub)\w*\b', body):
            raise RuntimeError('Unexpected fused multiply-add in reproducible path')
        (out / 'structure_simd_sweep.s').write_text(body, encoding='utf-8')
        report['native_assembly'] = 'passed; packed sqrt/div found inside named hot function'
        if args.wasm:
            wasm_files = []
            for fast in [False, True]:
                tag = 'wasm-simd' if fast else 'wasm-reference'
                we = env.copy(); we['CARGO_TARGET_DIR'] = str(out / tag)
                we['RUSTFLAGS'] = '-C link-arg=--export-memory' + (' -C target-feature=+simd128' if fast else '')
                features = ['--features', 'simd-distance'] if fast else []
                command = ['cargo', 'rustc', *common, '--lib', '--target', 'wasm32-unknown-unknown', *features, '--', '--emit=link,asm']
                run(command, tag+'-build', we)
                directory = out / tag / 'wasm32-unknown-unknown/release'
                wasm_files.append(str(directory / 'world_structure_kernel.wasm'))
                if fast:
                    texts = [p.read_text(encoding='utf-8') for p in (directory / 'deps').glob('world_structure_kernel*.s')]
                    if not any('f64x2.sqrt' in text and 'f64x2.div' in text for text in texts):
                        raise RuntimeError('SIMD WASM library has no packed sqrt/div evidence')
                    report['wasm_assembly'] = 'passed; f64x2.sqrt/div in compiled production library'
            result = run(['node', str(ROOT / 'tools/structure-simd-wasm-parity.mjs'), *wasm_files], 'wasm-parity', env)
            report['wasm_parity'] = json.loads(result)
        report['status'] = 'passed'
        save(); print(json.dumps(report, indent=2)); return 0
    except (OSError, RuntimeError, subprocess.TimeoutExpired, StopIteration, ValueError) as error:
        report.update(status='failed', reason=str(error))
        save(); print(json.dumps(report, indent=2)); return 1


if __name__ == '__main__':
    sys.exit(main())
