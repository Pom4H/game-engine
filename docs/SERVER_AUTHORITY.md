# Server authority

The server is the owner of truth, not the place where every calculation must run.

```
                         authoritative clock
                                |
                         CausalAuthority
                    epoch / owner / revision
                                |
             +------------------+------------------+
             |                  |                  |
           CPU work           GPU work           NPU work
             |                  |                  |
             +-------- immutable proposals --------+
                                |
                        invariant validation
                                |
                              commit
                                |
                        authoritative state
                                |
                          projections/ledger
```

## Boundary with Meshwork

Meshwork answers **where work runs**. `CausalAuthority` answers **whether a result may still change state**. They deliberately do not import each other.

A worker never owns a mutable pointer into world state. It receives an immutable observation/checkpoint plus an authority grant and returns a proposal.

## Scope

Authority is granular. A scope is `{domain,id}`, for example:

- `physics / region:41`
- `agents / city:amsterdam`
- `economics / nl`
- `world / tile:0:18:22`

Exactly one owner exists for every claimed scope.

Each scope has two fences:

- **epoch** changes on owner handoff. Every result produced by the previous owner becomes stale.
- **revision** changes on every accepted mutation. Concurrent results based on the previous state become stale.

Unrelated scopes have independent revisions, so a commit to one city does not invalidate work in another city.

## Commit protocol

```
observation at revision R
          |
       worker
          |
 proposal(epoch E, baseRevision R)
          |
          v
 owner == current owner?
 epoch == E?
 revision == R?
 deadline valid?
 domain invariant valid?
          |
          v
    atomic apply
          |
          v
 revision = R + 1
 causal ledger record
```

The adapter's `validate` phase is pure. `apply` runs only after all gates pass and must itself be atomic.

## NPU

NPU is not special to authority. An owner id can be `npu:0`, `cpu:fallback` or a remote worker. Hardware placement is execution metadata, never world semantics.

A late NPU decision after handoff is rejected by epoch. Two NPC/economy decisions made from the same revision cannot both commit. This lets speculative decision workers fail without corrupting the world.

## Server hot path

The intended central path is small:

```
collect player inputs
collect worker proposals
validate + commit
publish projections
advance authoritative tick
```

Rendering, neural inference, world generation, aggregate NPC decisions and even scoped physics may move to workers. The server keeps ordering, ownership, invariants and the causal ledger.


## Persistence

Authority handoff is only complete when the target has restored the same causal revision. The immutable checkpoint/log storage contract is defined in [Distributed causal storage](./CAUSAL_STORAGE.md).
