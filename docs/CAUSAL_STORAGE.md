# Distributed causal storage

The engine distributes **bytes**, not truth. Only one small mutable `ScopeHead` exists per authority scope; everything below it is immutable and content-addressed.

```
ScopeHead (strongly consistent)
  owner / epoch / revision / tick
  checkpointHash / logTailHash
              |
              v
        immutable CAS graph
      /          |          \
 local NVMe    peer CAS    object store
```

## Implementation

- `src/content/index.ts` is now the engine-wide CAS implementation. Render IR uses the same hashing/storage implementation.
- `MemoryScopeHeadStore` proves compare-and-swap semantics for the mutable head.
- `CausalStorage.bootstrap()` creates initial state + checkpoint.
- `append()` writes immutable mutation payload + hash-linked log record, then CAS-advances only the head.
- `checkpoint()` compacts replay into a new immutable state root without advancing revision.
- `restore()` loads checkpoint state and the contiguous mutation tail.
- `replicate()` copies exactly the hot reachable state to another CAS and verifies hashes.
- `handoff()` changes owner/epoch only after a hydration proof matches the current head.

## Recovery invariant

```
restore(H) = checkpoint.state + mutations(checkpoint.logTail, H.logTail)
```

Mutation revisions must be contiguous and end exactly at `H.revision`.

## Migration invariant

```
owner A / epoch E / revision R
        |
        +-- replicate checkpoint + dependencies + mutation tail
        +-- target restore + hash verification
        +-- hydration proof
        +-- CAS ScopeHead
                |
                v
owner B / epoch E+1 / revision R
```

The new owner starts from the same state revision. Results from the old owner are fenced by epoch.

## Deployment

A production adapter can map the same interfaces to:

1. RAM — active materialized state.
2. local NVMe CAS — hot blobs and mutation log.
3. peer CAS replicas — failover and migration.
4. durable object storage — cold immutable checkpoints/blobs.
5. Postgres first, Raft/consensus KV later — only for `ScopeHeadStore`.

Strong consistency is required only for the tiny head compare-and-swap. Immutable blobs may be cached, deduplicated and replicated freely.

## Infinite world

Persist causes, not deterministic consequences:

```
World = ProceduralBase(seed, generatorVersion) + PersistentDeltas
```

A deterministically generated tree is disposable. “Tree #812 was cut down” is durable.
