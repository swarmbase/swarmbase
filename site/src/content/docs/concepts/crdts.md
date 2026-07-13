---
title: CRDTs
description: How Swarmbase achieves convergence without consensus — operation-based CRDTs, the Yjs golden path, Automerge support, and the cost of unbounded history.
---

Swarmbase documents are Conflict-free Replicated Data Types (CRDTs). This single design decision is what makes [local-first](../local-first/) operation possible: every replica can accept writes independently, and all replicas still converge to the same state.

## Why no consensus mechanism is needed

Distributed databases traditionally keep replicas consistent by *coordinating before writing* — a leader orders the writes, or a quorum votes on them (Paxos, Raft). Consensus protocols are complex, expensive, and — critically for Swarmbase — require enough nodes to be online and reachable at write time. That is a non-starter for browsers that may be offline for days.

CRDTs take the opposite approach: instead of preventing conflicts, they make conflicts *impossible by construction*. A CRDT's operations are designed so that applying the same set of operations in any order (commutativity) and any number of times (idempotence, via deduplication) yields the same state. If merging is deterministic, replicas don't need to agree on an order before writing — they only need to eventually see the same set of changes.

This yields **strong eventual consistency**: two replicas that have received the same changes are in identical states. No leader, no election, no write-time coordination.

## Operation-based CRDTs in Swarmbase

Swarmbase uses operation-based CRDTs: each edit produces a compact *change* (a delta), which is applied locally and then propagated to peers. The core library defines this contract in the `CRDTProvider` interface (`@swarmbase/collabswarm`):

- `localChange(document, message, changeFn)` — applies your change function to the local document and returns the resulting change block.
- `remoteChange(document, changes)` — applies a change block received from a peer.
- `getHistory(document)` — returns all changes for the document, used to bring new peers up to date.

When you call `document.change(fn)`, Swarmbase applies the change locally, wraps the resulting change block in a Merkle-DAG node, signs it, encrypts it, and broadcasts it on the document's [GossipSub topic](../networking/). Peers verify the signature against the writer ACL, decrypt, and apply the change (see [Security model](../security/)). Each change node references its parents by content hash (CID), so peers can detect missing changes and fetch them from [content-addressed storage](../storage/).

## Guarantees — and their limits

CRDTs give you convergence, but it is worth being precise about what that does and does not mean.

**Convergence is not agreement-right-now.** There is no global moment when all replicas are known to be in sync. If you need every node to see the same state in real time, use a different database (see [Limitations](../limitations/)).

**Convergence is not intent preservation.** The merge is deterministic, not clairvoyant. Two users concurrently setting the same map key resolves as last-writer-wins — one value survives. Two users concurrently inserting text at the same position both keep their insertions, interleaved deterministically. Whether the merged result is what the humans *meant* depends on how you model your data; choosing the right shared types is the main schema-design decision in a CRDT application.

**The guarantees assume non-adversarial replicas.** CRDT convergence theory assumes every replica follows the protocol. A malicious participant that can inject arbitrary changes can corrupt the shared state. Swarmbase addresses the *network* half of this problem cryptographically: every change is signed, and peers reject changes that do not verify against a key in the document's writer ACL, so untrusted relays and storage peers cannot forge edits. But an *authorized writer* is trusted — the CRDT layer cannot protect a document from a writer who deliberately produces garbage. Grant write access accordingly.

## Yjs: the golden path

Swarmbase supports pluggable CRDT engines, and [Yjs](https://yjs.dev/) (via `@swarmbase/collabswarm-yjs`) is the recommended one. The reason is performance: in the independent [crdt-benchmarks](https://github.com/dmonad/crdt-benchmarks) suite, Yjs is consistently among the fastest CRDT implementations for document size, parse time, and memory across realistic editing traces.

Yjs implements the YATA algorithm. Every shared type (`Y.Map`, `Y.Array`, `Y.Text`, XML types) is internally a list of items with unique (client, clock) IDs, which is how concurrent operations are ordered deterministically. Practical consequences:

- `Y.Map` keys resolve concurrent writes by last-writer-wins.
- `Y.Array` and `Y.Text` preserve all concurrent insertions.
- Deleted items become **tombstones** — markers that are never garbage-collected, so late-arriving operations can still be ordered. Tombstones are a permanent per-deletion cost.

In Swarmbase, each document wraps a single `Y.Doc`; your change function receives it and manipulates shared types directly.

## Automerge: the supported alternative

[Automerge](https://automerge.org/) is supported via `@swarmbase/collabswarm-automerge` behind the same `CRDTProvider` interface. Automerge offers a clean JSON-document model and a well-specified binary change format. It is generally less performant than Yjs on the benchmarks above, but if your team already uses Automerge or prefers its API and data model, it is a first-class option: the networking, storage, ACL, and encryption layers are identical regardless of engine.

The engine choice is per-application, not per-peer: all replicas of a document must use the same CRDT provider.

## History growth and compaction

The known structural cost of this architecture is that **history grows without bound**. Every edit produces a change node in the document's Merkle-DAG: N edits means N nodes. Each node is stored encrypted in the local blockstore and referenced in sync messages, and when a new peer opens a document it has historically had to receive and replay the full DAG. A document with a million edits means a very slow initial load — sync time grows linearly with edit count. (At the CRDT layer, Yjs tombstones and Automerge's full-history model compound this: heavily edited documents grow with total operations performed, not final content size.)

Swarmbase's answer is **snapshot-based compaction**, currently shipped as an opt-in feature (`CompactionConfig`, disabled by default):

- An authorized writer periodically creates a **snapshot node**: the full serialized CRDT state at a point in history (for Yjs, `Y.encodeStateAsUpdateV2`; for Automerge, `Automerge.save`), signed by the writer.
- New peers load the latest snapshot plus only the post-snapshot changes, instead of replaying everything. Snapshots are verified against the writer ACL before being applied.
- After a snapshot, old change nodes can be pruned from the in-memory sync tree (`pruneAfterSnapshot`, keeping a configurable window of recent nodes), and optionally deleted from the local blockstore (`gcAfterPrune` — destructive and off by default, since pruned blocks can no longer be lazily loaded for history/audit purposes).
- Concurrent snapshots from different writers converge via a deterministic tie-break (highest compacted-change count, then lexicographically greatest boundary CID) — snapshots summarize the same CRDT state, so this is a metadata preference, not a merge conflict.

Compaction bounds *sync and load* cost. It does not eliminate CRDT-internal tombstone growth inside the live document state, and it is new, lightly battle-tested code — see [Limitations](../limitations/).

## Where to go next

- [Networking](../networking/) — how change messages actually reach other peers.
- [Storage](../storage/) — where change nodes live, and why pinning matters.
- [Security model](../security/) — signing, verification, and encryption of changes.
