# Latest main with bounded rendering admission

The integration merges main `2c2b257b65ead74e983a99a28f861358a9d972b1`
after the incremental triangle-stream commit
`73b2ddcb37f9860f012bedd86c3b676cd1030d53`.

Main adds `InfiniteWorld` cancellation/release ownership and an explicitly
optional structural distance SIMD profile. Its lifecycle changes include the
earlier integration retry/deferred-generation/flush fixes. The three conflicts
were resolved with incoming semantic versions, retaining the integration's line
endings and existing regression tests. Game uses its own prepared world source
and does not directly instantiate `InfiniteWorld`.

The final merged source passed:

- `npm run check`: 1031 pass, 19 skip, 0 fail; 1050 tests, 73.5643 s.
- Default structural Rust library: 2 pass; `simd-distance`: 11 pass.
- Default release WASM build and existing JS/WASM parity: 6 pass, 0 skip.
- `structure-simd-audit.py --wasm`: reference/SIMD release tests, native packed
  sqrt/div assembly, WASM f64x2 sqrt/div, and four 120-tick ABI scenarios pass.
  Maximum observed ABI error is 9.4436e-13. This optional numerical profile is
  not a bitwise replacement for the default backend.

Logs, exact runtime versions and source hashes are under
`artifacts/freeze-main-simd-20261021/summary.json`; full test log is
`engine-full-check.log`, audit is `audit/report.json` with `audit/benchmark.csv`.
The diagnostic benchmark overlapped correctness checks: independent-pair p50
6.87294→6.85272 ns and chain p50 17.95654→17.94472 ns do not establish a useful
gain; independent p95 worsened 7.305→10.229 ns. `default=[]` is retained, and
neither the production build nor Game enables `simd-distance`.

The graphics path remains the same source verified by the triangle-stream
native oracle in `artifacts/freeze-stream-glass-native-20261021/r3/report.json`.
Five complete 1280×720 PNG/HDR/depth cases, geometry/attributes and transparency
order match the canonical legacy path. Incremental uploads and expiry/return
create zero hot geometry/object buffers or bindings. These are correctness and
ownership proofs, not whole-game 60 FPS/no-freeze acceptance.
