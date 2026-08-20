---
title: CRDTs
description: CRDT convergence in Swarmbase, the Yjs and Automerge adapters, snapshots, and current evidence.
---

Swarmbase delegates document merge semantics to a CRDT adapter. The repository provides adapters for **Yjs** and **Automerge**; every replica of a document must use a compatible adapter and data model.

## Design intent

CRDTs allow replicas to commit without a leader or write-time consensus. The precise rule is not “apply every operation in arbitrary order.” Causal predecessors must be available or applied in the order required by the CRDT, while operations that are genuinely concurrent must have merge semantics that commute or otherwise converge deterministically.

If compatible replicas receive the same complete set of committed changes, the adapter is intended to produce convergent state. That says nothing about when all replicas have received those changes or whether the result matches user intent.

## Implemented model

A successful `document.change()` produces one committed CRDT change. A transaction can combine multiple application or UI edits into one committed change. Swarmbase stores the change as an encrypted CID-addressed block and carries a signed-when-enabled, encrypted shadow sync graph that may include payloads inline or defer them by CID.

`CRDTProvider` supplies `localChange`, `remoteChange`, and `getHistory`, plus optional snapshot operations. `getHistory` is an adapter API; current document loading uses the document-load or snapshot-load protocols and the retained sync tree, not `getHistory` as its network load mechanism.

Yjs and Automerge choose their own semantics for maps, sequences, deletion, metadata, and history. Swarmbase does not impose a universal last-writer-wins rule, universal tombstones, or one conflict model across adapters. Model application invariants explicitly and inspect each adapter's behavior.

## Convergence boundaries

CRDT convergence does not provide:

- agreement-right-now or a global order of all writes;
- conflict-free human meaning;
- protection from a malicious authorized writer;
- delivery, retention, onboarding, or key recovery;
- proof that the complete Swarmbase system converges after every partition and rejoin.

The network and storage layers must still deliver every required change and causal predecessor. Missing blocks, pruned history, failed publication, unavailable peers, incompatible keys, or authorization failures can prevent convergence.

## Snapshots and compaction

Automatic compaction is **off by default**. When enabled, an authorized writer can create a signed full-state snapshot, retain post-snapshot changes, prune older document nodes from the in-memory sync tree, and optionally garbage-collect pruned blocks. Block GC is separately off by default.

Concurrent writers can snapshot different local states. Swarmbase's deterministic preference rule chooses snapshot metadata by compacted-change count and then boundary CID; preference does not prove that competing snapshots are semantically equivalent. A snapshot is verified under a current writer key when signing is enabled.

Default initial loading also requires tip-hash agreement from multiple peers. A first-time quorum load may not yet have a trusted writer ACL, so it can reject a snapshot whose writer cannot be verified. If pre-snapshot changes were pruned or garbage-collected, the retained tail may be insufficient to reconstruct the state. Different served frontiers or unavailable graph data can also make the load fail closed even when an existing replica remains usable. Operators must treat snapshots, retained blocks, quorum configuration, ACL bootstrap, and reachability as one availability problem.

Compaction can reduce what a load response replays, but it does not establish bounded storage, memory, load time, or sync time. Adapter-internal state and retained blocks may continue to grow.

## CI-backed evidence

Current CI has broad Yjs and Automerge adapter tests plus snapshot, compaction, serialization, cross-link, quorum, and block-GC suites. This verifies components and selected interactions. The repository also contains convergence benchmarks, but they are not assertion-based CI budgets. Long-running concurrent compaction, large histories, hostile graph shapes, and deterministic system partition/rejoin remain unproven. See [Limitations](../limitations/).
