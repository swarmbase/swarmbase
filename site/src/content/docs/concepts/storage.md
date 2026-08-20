---
title: Storage
description: Swarmbase's encrypted CID-addressed blocks, shadow sync graph, persistence, pinning, and recovery limits.
---

Swarmbase stores CRDT changes as encrypted, CID-addressed blocks through Helia and exchanges a separate signed-when-enabled, encrypted shadow sync graph. This is not a conventional Merkle-DAG in which each stored block commits to parent CIDs.

## Implemented model

For each committed document or ACL change, Swarmbase encrypts and writes the serialized change bytes to the local blockstore. The resulting CID identifies those encrypted bytes. A sync message then carries a `CRDTChangeNode` shadow graph: its root CID names the current change block, `children` describe an older retained tree and cross-links, and a node can either include its change payload inline or omit it so the receiver fetches the block by CID.

Inline payloads are part of the encrypted sync envelope. Their graph entries are not necessarily the bytes stored under each referenced CID, so do not infer conventional Merkle-DAG parent commitment or complete-history proofs from the shadow structure. Sync messages are signed by a writer when application signing is enabled; CID verification protects fetched bytes from substitution, while encryption protects contents.

A load responder serves its retained shadow tree or a snapshot plus retained changes. It may not serve every locally known concurrent head, and `getHistory()` is not the current network load path.

## Browser persistence

Browser defaults use IndexedDB-backed Helia blockstore and datastore instances. This verifies that bytes and metadata can use IndexedDB; it does not verify complete document, graph, key, ACL, identity, and subscription recovery after a full browser restart.

A peer can apply an inline payload without necessarily persisting every referenced block from the supplied shadow tree. Replication therefore follows observed synchronization and fetches; Swarmbase does not automatically enforce a replication factor or prove that a given number of independent peers retain every required block.

## Pinning status

`CollabswarmNode` contains a listener for a document-publish topic and code to pin announced and subsequently observed CIDs. Core document commits, however, do not publish to that pin-request topic. The listener therefore has no core publisher in the current path. There is also no integrated generic IPFS pinning-service client or automatic export of every required block.

Treat pinning as incomplete integration, not a configured durability feature. An operator must build and test the publication, traversal, authorization, retention, monitoring, and restore path. A generic service can retain supplied CIDs, but Swarmbase currently does not supply the end-to-end discovery workflow.

## Recovery requirements

A usable recovery needs more than ciphertext blocks. At minimum it may require:

- the relevant root, frontier, snapshot, and change CIDs;
- enough shadow graph or other indexing information to discover them;
- retained blocks at reachable providers;
- document epoch keys and the keychain state allowed by history visibility;
- the application's signing identity and KEM state;
- compatible CRDT, ACL, and serializer configuration;
- network reachability and, by default, enough agreeing peers for initial-load quorum.

Loss of keys or identity can make retained blocks unreadable or make future authorized writes impossible. Content addressing is integrity and lookup machinery, not backup or key recovery.

## Compaction and garbage collection

Automatic compaction is off by default. When enabled, pruning removes older document nodes from the served in-memory tree; optional block GC can then delete pruned local bytes. GC is destructive and separately off by default. ACL nodes are preserved by the pruning logic, but that does not guarantee a complete recoverable history.

Snapshot bootstrap can fail after peers compact or prune. A first-time quorum load may not yet have a trusted writer ACL and can reject the snapshot during writer verification; if earlier changes were pruned or garbage-collected, the retained tail may not reconstruct that state. The needed graph or blocks may also be unavailable, and tip-hash quorum can reject incompatible served frontiers. Deterministic snapshot preference does not make differing snapshots equivalent. Test backup and restore with the same compaction, quorum, and membership settings used in deployment.

## CI-backed evidence

Current CI verifies serialization, cross-links, snapshots, compaction, blockstore GC, and IndexedDB index/storage components. Content-addressed persistence and browser blockstore initialization are partial; full restart recovery and remote pinning are not default acceptance tests. No CI evidence establishes a replication factor, complete pinning workflow, or durable disaster recovery. See [Limitations](../limitations/).
