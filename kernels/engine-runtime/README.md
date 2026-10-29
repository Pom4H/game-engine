# ROM4 Rust kernel runtime

Start of the engine migration, **not a complete rewritten engine**.
See [the status, exact scope and verification record](../../docs/RUST_MIGRATION.md).

No dependencies, no host imports, f64 calculations, persistent bounded buffers,
one native call per requested batch. Build and test from the repository root:

```sh
bun run rust:verify
bun run rust:bench
```

ABI v1 exports `rom4_create`, `rom4_free`, `rom4_execute`, field pointer/length/kind
queries, error and live-memory statistics. A successful mutation returns 1;
a failed mutation returns 0 and a nonzero `rom4_last_error()`.
Creation returns a nonzero generational handle, or 0 on error.

Fields: 1 wheel inputs f64, 2 wheel outputs f64, 3 node positions f64,
4 hinge indices u32, 5 angles f64 (NaN for degenerate hinges), 6 gradients f64,
7 skin rest f64, 8 node rest f64, 9 skin node indices u32, 10 weights f64,
11 projected skin positions f64, 12 triangle indices u32, 13 normals f64,
14 dent records f64, 15 interleaved position/normal f32.

Pass bits: wheels=1, hinges=2, skin=4, dents=8, normals=16, pack=32.
Dents/normals/pack require skin in the same call; pack also requires normals.
All requested inputs are validated before any output is changed.

Wheel rows have 15 inputs and 7 outputs; see `src/wheel.rs`.
Dent rows have 9 values: point[3], normal[3], radius, depth, mode.
Mode 0 projects a positive inward permanent dent; mode 1 projects a signed
elastic+plastic panel displacement. Normals must be unit length. Coordinates
and finite scalar inputs are bounded to magnitude 1e12; wheel dt is (0,1/30].

The buffer API permits zero-copy access but does not automatically connect
existing Scene/Vehicle/StructuralBody objects. Passing node positions from a TS
physical owner requires a transfer; the M3 benchmark includes it explicitly.
