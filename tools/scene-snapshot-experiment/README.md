# World editor tooling experiment with TypeScript 7.1 Beta

This experiment keeps `compiler/src/lib.rs` as the sole parser, dimensional and
coupling checker, constant folder and WSCN producer. A `.scene` file contains the
existing World language with a different extension. No TypeScript projection is
executed or emitted; no engine/game runtime, world certificate or scene ABI is
changed. This does not implement a new Rust scene runtime.

The editor path is `.scene → content mapper → worldc::compile + partial TS
projection → TypeScript Snapshot API`. It uses the published 7.1.0-beta API, not
the legacy language service or a simulated snapshot. The mapper is a real
JSON-RPC subprocess started by TypeScript. Its material type union is extracted
from the current Rust catalog, with an exact literal-array guard. The bridge
embeds a source fingerprint and refuses stale Rust/compiler combinations.

`using` owns the API, snapshots and programs, including failure paths. These
handles retain bookkeeping in TypeScript's native process; disposal releases
that ownership. A `Project` is obtained from its owning snapshot and is not
declared with `using`, because the published type has no `Symbol.dispose`.

## Reproduce on Windows

From the engine root, with Rust, Bun and Node available:

```powershell
New-Item -ItemType Directory -Force artifacts/scene-snapshot71-20261021 | Out-Null
rustc --edition 2021 -O -A dead_code tools/scene-snapshot-experiment/bridge.rs -o artifacts/scene-snapshot71-20261021/worldc-editor.exe
bun build tools/scene-snapshot-experiment/run.ts --target node --packages external --outfile artifacts/scene-snapshot71-20261021/run.mjs
node --test tools/scene-snapshot-experiment/projection.test.mjs
node node_modules/typescript/bin/tsc -p tools/scene-snapshot-experiment/tsconfig.json
node artifacts/scene-snapshot71-20261021/run.mjs verify
node artifacts/scene-snapshot71-20261021/run.mjs benchmark
```

Only the generated experiment project enables `contentMappers`; only this API
instance opts into `runExternalCode`. The engine/game project configuration does
not enable external mappers. Generated config, private local mapper package,
source files, native bridge, diagnostics, calls and reports stay in the ignored
`artifacts/scene-snapshot71-20261021/` directory. Verification writes its report
separately from benchmark results. Rebuild the bridge after Rust compiler edits.

## What the 19-file experiment established

The input contains four existing World examples, seven additional valid edge
cases and eight invalid cases. All eleven valid WSCN SHA-256 values match direct
Rust compilation. The same Rust diagnostics are retained for every invalid
case; no valid case gains a TypeScript diagnostic.

| Invalid case | Rust baseline | TS projection alone | Combined editor |
| --- | --- | --- | --- |
| Unknown constant | Yes | TS2304, source identifier span | Yes |
| Unknown material | Yes | TS2322, source material span | Yes |
| Incompatible dimensions | Yes | No | Yes |
| Division by zero | Yes | No | Yes |
| World parse error | Yes | No | Yes |
| Coupling cycle | Yes | No | Yes |
| Coupling dimension mismatch | Yes | No | Yes |
| Duplicate entity ID | Yes | No | Yes |

Thus TS alone detects 2/8 tested errors; retaining Rust detects 8/8. This is a
small case matrix, not a completeness proof for the language. Rust remains
fail-fast, so the mapper preserves its first diagnostic rather than claiming
multi-error Rust recovery.

Real source mappings cover an astral character and Cyrillic before errors,
UTF-8 Rust offsets versus UTF-16 editor positions, CRLF and literal U+FFFD.
Unsupported constant spelling/layout leaves all constants in that file to Rust;
this avoids false missing bindings. Units and arithmetic values are never
evaluated by the projection. Numeric literals become number placeholders so
valid World spellings such as `01` do not become strict-JS octal errors.
Strict-JS binding names `eval` and `arguments` remain Rust-only. Material checks
use separate generated scopes to avoid collisions with valid World identifiers.

After one unknown constant is fixed, exactly that file is remapped. The program
ID survives, the old snapshot still returns its original diagnostics, and the
new snapshot removes the two corresponding Rust/TS diagnostics. No runtime
dependency or invalidation certificate is derived from a TypeScript snapshot.

## Bounded timings on 2026-10-21

Node 24.21.0, TypeScript 7.1.0-beta, the existing local computer. Final raw data:
`artifacts/scene-snapshot71-20261021/benchmark-report.json`, including source
hashes, all samples and exactly-one-transform assertions. This final benchmark
also executes the complete 19-case functional assertions. The older saved
`verify-report.json` is a 17-case pre-review run, retained as history.

| Cohort | Measurement |
| --- | --- |
| Cold API, mapper, 19 files and diagnostics | 618.54 ms, one observation |
| First one-file snapshot update | 28.62 ms, one observation |
| Warm fresh snapshot, one unique edited file | median 35.67 ms; 32.90–45.04 ms, 12 samples |
| Warm derived snapshot, one unique edited file | median 29.55 ms; 26.79–37.43 ms, 12 samples |
| Rust subprocess, compile and response transport | median 24.00 ms; 22.64–31.29 ms, 12 samples |
| Rust compile alone, first four iterations excluded | median 3.7 µs; 3.4–8.1 µs, 28 samples |

The two warm TS cohorts alternate order, use one live API process, force all
diagnostics and each introduce a different source SHA with a changed spacing
constant. Every sample confirms one new mapper transform. Fresh means a new
snapshot in that live process, not a cold compiler process. All derived samples
start from the same old snapshot; this is not a long typing-session benchmark.
Most time here is starting a Rust subprocess for a tiny file, so the numbers do
not demonstrate a faster Rust compiler, production-scale editor performance,
lower GC pause times or higher game FPS.

A preliminary smoke run reused the exact same edit and hit TypeScript's
content-transform cache. Its approximately 1.6 ms results were rejected as a
measurement of new edits. Pre-hardening unique-edit results are also not the
final result; the final report hashes the reviewed implementation.

## Maintenance cost and decision

The measured implementation has 55 physical lines of Rust bridge, 68 of mapper
protocol/lifecycle code and 104 of projection/mapping code: 227 lines of editor
glue, plus 155 lines of verification/benchmark harness. Counts include comments
and blank lines and are recorded beside hashes in the report. Five unit tests
cover boundaries that the end-to-end fixture matrix cannot isolate.

This small amount of glue already needs guards for catalog changes, stale
native binaries, source encodings, generated identifier scopes, unsupported
syntax, subprocess framing, permissions, snapshots and disposal. Maintaining a
second complete World parser in TypeScript would increase that burden.

Keep the experiment separate from runtime. A useful next editor step is for
Rust to expose a stable source-span/projection API and a bounded persistent
editor process, eliminating the narrow regex adapter and per-file process
startup. Own causal certificates should continue to decide world work; a TS
snapshot only decides editor analysis work. The existing runtime ABI and
language semantics do not need to move into TypeScript.

Sources: [official 7.1 Beta API and mapper announcement](https://devblogs.microsoft.com/typescript/announcing-typescript-7-1-beta/),
[Content Mapper protocol and span specification](https://github.com/microsoft/typescript-go/pull/4712),
[official linked example](https://github.com/DanielRosenwasser/content-mapper-sample).
