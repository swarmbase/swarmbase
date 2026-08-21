---
title: Storage
description: How Swarmbase stores documents — local IndexedDB persistence, the Helia blockstore, pinning, recovery, and compaction.
---

## Overview

Swarmbase uses **Helia** (the JavaScript IPFS implementation) for content-addressed storage. Every document block — a signed, encrypted CRDT update — is stored in a local Helia blockstore backed by IndexedDB in the browser or the filesystem in Node.js. Blocks are addressed by their **CID** (Content Identifier), a SHA-256 hash of the encrypted content.

## Implemented model

### Content-addressed blocks

Every `CRDTChangeBlock` is stored as an opaque blob:

```
┌─────────────────────────────────────┐
│          CRDTChangeBlock             │
├─────────────────────────────────────┤
│  parent: CID of previous tip        │
│  epoch:  current document epoch     │
│  signature: ECDSA P-384             │
│  payload: AES-GCM encrypted         │
│    └── serialized CRDT update       │
├─────────────────────────────────────┤
│  CID: sha256(entire block)          │
└─────────────────────────────────────┘
```

Blocks are immutable. Once stored, a block's CID is stable forever. The document's current state is the **tip** — the most recent block applied to the CRDT replica. The tip advances with each `document.change()`.

### Inline vs deferred payloads

To reduce block size and improve deduplication, Swarmbase can split payload content across referenced blocks:

- **Inline**: The full encrypted update is embedded in the `CRDTChangeBlock`.
- **Deferred**: The encrypted update is stored as a separate block referenced by CID from the `CRDTChangeBlock`. Useful when the same encrypted payload appears in multiple sync contexts.

### No Merkle-DAG parent commitment

Swarmbase's shadow sync graph does **not** use Merkle hash linking. Blocks reference parents by CID but do not commit to parent hashes. This means the graph structure can change after blocks are written (e.g., adding new parents during catch-up). This is intentional — it allows the sync layer to add concurrent parents discovered later without rewriting blocks.

## Browser persistence

In the browser, Helia stores blocks in **IndexedDB**:

```ts
import { createHelia } from 'helia';
import { createIDBBlockstore } from 'helia-blockstore-idb';

const blockstore = createIDBBlockstore('/swarmbase/blocks');
const helia = await createHelia({ blockstore });
```

Encrypted blocks, IPNS records, and the libp2p peer store are all persisted to IndexedDB under the origin. This means a browser tab refresh should preserve document state.

**Current status**: Local block storage works in single-session tests. Complete restart recovery (close browser → reopen → verify document state) has **not been proven in CI**. The blockstore persists, but Helia/libp2p reinitialization and document re-opening after a browser restart are not end-to-end tested.

### No automatic replication factor

Swarmbase does not replicate blocks automatically. If you have 3 peers and one stores a block, the other 2 may fetch it on demand (bitswap) or may not. There is no "store on at least N peers" guarantee.

## Pinning status

Pinning is **incomplete**. What exists:

- A `CollabswarmNode` listener that fires when blocks are stored locally
- No publisher in the core commit path (the listener is never notified)
- No generic IPFS pinning client (e.g., to pin to a remote IPFS node, S3, or Filecoin)

Without pinning:

- The last online peer is the last surviving copy
- If all peers go offline and their IndexedDB is cleared, the document is lost
- A dedicated "pinning node" (always-on peer) can serve as a poor substitute, but is not integrated

See the [pinning cookbook](../../cookbook/pinning/) for the integration checklist.

## Recovery requirements

Recovering a document requires more than just the encrypted blocks. A peer needs:

1. **The block data** — encrypted CRDT change blocks (from any peer or pinning service)
2. **The graph structure** — which CIDs form the tip and its ancestor chain (from the shadow sync graph)
3. **The document key** — AES-GCM key to decrypt blocks (held by authorized peers)
4. **The identity key** — ECDSA P-384 signing key to prove authorship (held by each writer)
5. **The KEM state** — BeeKEM key material for dynamic group membership (memory-only currently)
6. **Network reachability** — connection to at least one peer or bootstrap node
7. **K-of-Q quorum** — agreement from bootstrap peers on the current tip hash (configurable)

Losing any of these components may make full recovery impossible. Key management and backup are application responsibilities.

## Compaction and garbage collection

### Compaction

Compaction replaces a chain of blocks with a full-state snapshot. It is **off by default**:

```ts
await document.compact();
```

When compaction runs:
1. The current CRDT state is serialized as a full snapshot
2. The snapshot is signed and encrypted like any other block
3. Older blocks in the chain may be pruned (removed from the local blockstore)

Compaction reduces storage and load time (starting from a snapshot instead of replaying all history), but:
- Pruned blocks cannot be recovered
- Peers that only have pruned blocks cannot reconstruct the document
- Snapshot-only bootstrap can fail if snapshots reference pruned data

### Garbage collection

GC removes blocks that are no longer referenced by any document. It is **destructive**:
- Pruned blocks are deleted from IndexedDB
- Recovery from GC is impossible — the data is gone
- GC is not automatic; the application must trigger it

## CI-backed evidence

Verified in CI:

- Block creation, storage, and retrieval in a single browser session
- Encrypted blocks transmitted through Circuit Relay and stored in the recipient's blockstore
- IndexedDB blockstore initialization and basic read/write

Not verified:

- Complete browser restart and document recovery
- Multi-session persistence (close → reopen → verify)
- Compaction and GC with subsequent recovery
- Pinning publisher integration
- Remote block fetch (bitswap/HTTP) of blocks stored by a different peer

## Next steps

- [Pinning cookbook](../../cookbook/pinning/) — what needs to happen for reliable remote persistence
- [Security model](../security/) — how encryption and signing protect stored data
- [Limitations](../limitations/) — storage-specific limitations