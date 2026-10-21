# TypeScript 7.1 Beta: tooling and explicit resource ownership

Verified on 2026-10-21 using TypeScript **7.1.0-beta**, Bun 1.4.3 and Node 24.21.0. Both Engine and companion Game pin the exact beta version. Separate dependency directories replace the task workspace's former junctions; the original running checkouts retain TypeScript 7.0.2. The only changed dependency family in the lockfiles is TypeScript and its platform compiler packages. Beta status is deliberate; this is not a claim of stable 7.1 availability.

## Production ownership changes

Engine commit `b18527e` bounds temporary GPU buffer ownership with `using`. Failed readback encoding, submit, mapping, decode and unmap now release the allocated buffer. Failed mesh creation releases every acquired buffer, including partial uploads and failed cache admission. Successful meshes transfer ownership only after both caches accept the complete mesh; normal residency still owns their lifetime. Disposal attempts every owned buffer even if another destroy fails.

Both mesh cache returns precede a separate lexical `using` block. This matters because ES2022 lowering creates its disposal environment at lexical block entry. Instrumentation of the actual TypeScript output and actual Bun Game bundle confirms 400 cache hits add **zero** scope objects, disposal environments or GPU buffers. A cold miss adds one scope/environment and three buffers. A miss may occur during gameplay; this is not a claim of no per-frame allocation.

Companion Game commit `de8bc04` adds a small `ReaderLock<T>` owner to Office request parsing and native causal command input. It releases the Office reader on success, parse/read errors and awaited oversized-body cancellation. It also releases a command reader if acquiring its writer fails. Cancellation, writer ownership, transport closure and authority/Office queue order remain with the existing owners. Six new real-stream regression cases cover these paths; the old implementation reproduces three failures.

The language feature predates 7.1. Explicit disposal controls external resource lifetime; it does not replace JavaScript GC or prove shorter GC pauses. We did not add ownership wrappers to frame or physics hot loops.

## Validation and evidence

| Check | Actual outcome |
| --- | --- |
| Engine `npm run check`, including typecheck/build | 947 pass, 19 skip, 0 fail; 966 cases, 69.75 s |
| Game stream/adapter/Office group | 22 pass, 0 fail; 88 assertions, three files, 6.13 s |
| Game `bun run typecheck` and `bun run build` | Pass with 7.1.0-beta |
| Actual TypeScript and Bun emitted mesh method | Zero added disposal work on all 400 hits; correct cold transfer |
| Native Radeon, four scenes × two Game geometry variants | Eight outputs match the preserved native oracle: complete PNG, HDR, depth, callbacks and geometry; zero GPU errors |
| Editor projection units and own strict typecheck | Five pass; TypeScript check exits 0 |
| Real mapper/Snapshot matrix | 19 files, 11 valid WSCN hashes exact, eight Rust errors retained |

Game focused command:

```powershell
bun test test/stream-reader-lifetime.test.ts test/causal-network/adapters.test.ts test/office-installation.test.ts --timeout 30000
bun run typecheck
bun run build
```

The full Game suite's earlier 2,219 pass/7 skip baseline is historical, not rerun for this change. Native image equality is a bounded renderer compatibility check, not a whole-world playthrough or FPS acceptance. The pre-existing freeze-free 720p60 requirement remains unmet.

Durable reports: [TS emission](tooling-evidence/using-ts-emission-20261021.json), [Bun emission](tooling-evidence/using-bun-emission-20261021.json), [native outputs](tooling-evidence/using-native-20261021.json), [native baseline comparison](tooling-evidence/using-native-baseline-20261021.json). Full logs and probe sources remain in the task's hashed evidence backup. The browser proof uses the current Game bundle SHA-256 `41a20daaee2c79ea316eda0cd85cee7cbd8ee81ad5f631ad41f5fb35189d0a45` for Bun control-flow inspection; the native fixture independently bundles the production Engine renderer.

## Editor architecture experiment

[Experiment source, reproduction and decision](../tools/scene-snapshot-experiment/README.md). Rust's existing `worldc::compile` remains the parser, semantic/dimensional/coupling checker and WSCN producer. The experiment uses real 7.1 Content Mapper and immutable Snapshot APIs, with a deliberately partial numeric/material TS projection. Production compiler, runtime, certificates and scene ABI are unchanged; no projected TypeScript executes.

Final diagnostic coverage is Rust 8/8, TS alone 2/8, combined 8/8. All 11 valid scene outputs match direct Rust hashes, with no added TS diagnostics. The new snapshot remaps one edited file, retains program identity and leaves old diagnostics immutable. UTF-8/UTF-16 spans include emoji, Cyrillic, CRLF and literal U+FFFD. Numeric atoms use source-mapped zero placeholders to avoid imposing TypeScript literal syntax on Rust values; strict-module binding names defer all constants in that file to Rust. Generated names, omitted bindings, material extraction and stale bridge versions have regression guards and independent source review.

| Timing | Final bounded result |
| --- | --- |
| Cold API, mapper and all 19 files | 618.54 ms, one observation |
| First changed-file update | 28.62 ms, one observation |
| Warm new snapshot in the same live API | median 35.67 ms, 12 unique edits |
| Derived snapshot, changed file | median 29.55 ms, 12 unique edits |
| Rust subprocess plus compile/transport | median 24.00 ms, 12 samples |
| Rust compile inside one process | median 3.7 µs, 28 samples after four warmups |

Each warm sample forces diagnostics and one new transform for a unique source SHA; order alternates. Derived snapshots share one old snapshot rather than simulating a long editing session. Warm new snapshots reuse the live API and unaffected content transforms. The preliminary identical-edit cache smoke was rejected. These numbers do not demonstrate faster Rust compilation or production editor scalability.

The implementation costs 227 physical lines of bridge/mapper/projection plus 155 harness lines. The experiment supports keeping TS as editor infrastructure. A persistent Rust editor bridge and stable Rust source-span/projection interface would remove process-start cost and fragile syntax extraction before wider adoption. Own causal certificates must continue to determine world invalidation.

[Final benchmark and source hashes](tooling-evidence/scene-snapshot71-benchmark-20261021.json), [functional matrix extracted from that same final benchmark run](tooling-evidence/scene-snapshot71-verify-20261021.json), [all eight Rust offsets](tooling-evidence/scene-snapshot71-offsets-20261021.json), [retrospective subprocess inventory](tooling-evidence/scene-snapshot71-lifecycle-20261021.json). The inventory finds no matching remaining mapper/API/bridge process; child PIDs were not captured at launch, so it is not a handle/heap leak proof.

Sources: [Microsoft's 7.1 Beta announcement](https://devblogs.microsoft.com/typescript/announcing-typescript-7-1-beta/) and [5.2 explicit resource management documentation](https://www.typescriptlang.org/docs/handbook/release-notes/typescript-5-2.html).
