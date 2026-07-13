---
title: Storage
description: Content-addressed storage with IPFS/Helia, the Merkle-DAG of changes, local-first caching, and why pinning is not optional if you care about your data.
---

Swarmbase has no storage server. Document data lives in the local storage of the peers that use it, addressed by content rather than location, and replicated opportunistically. This page explains the storage model — and its sharpest edge: without pinning, data that all peers stop holding is simply gone.

## Content-addressed storage with IPFS and Helia

Swarmbase stores document changes using [Helia](https://helia.io/), the JavaScript implementation of the [IPFS](https://ipfs.tech/) protocol stack. The core idea is [content addressing](https://docs.ipfs.tech/concepts/content-addressing/): a block of data is identified by a CID — a hash of its contents — rather than by where it is stored. Consequences that matter for a database:

- **Integrity is built in.** If a peer hands you a block for CID `X`, you can verify it by hashing. Untrusted peers can serve data but cannot silently substitute it.
- **Deduplication is automatic.** The same change stored by fifty peers is the same block with the same CID everywhere.
- **The address is the version.** A CID permanently identifies one exact byte sequence; a new change is a new block with a new CID. Nothing is ever updated in place.

Each Swarmbase change is serialized, encrypted (see [Security model](../security/)), and written to the local Helia blockstore as a block. Peers that need a block they don't have — for example, a change referenced in a sync message they missed — fetch it from whichever peers hold it.

## The Merkle-DAG of changes

Changes are not independent blobs; they form a **Merkle-DAG** (a [directed acyclic graph linked by hashes](https://docs.ipfs.tech/concepts/merkle-dag/)). Every change node records the CID(s) of its parent change(s) — the tips of the document history the writer saw when making the edit — plus a small number of cross-links to other recent tips for resilience. In the core library this structure is the `CRDTChangeNode`: a node has a kind (a document edit, or a reader/writer ACL change — permission changes are part of the same DAG), an optional encrypted change payload, and children keyed by CID.

This structure buys three properties:

- **Causal ordering.** Parent links capture what each writer had seen, so peers can apply changes in a causally consistent way and detect gaps.
- **Deduplication and idempotence.** Peers track the set of CIDs they have applied; receiving a change twice is a no-op. This is one half of what makes the [CRDT layer](../crdts/) converge.
- **Tamper evidence.** A node's CID commits to its contents, and its contents commit to its ancestors' CIDs. Rewriting history changes the hashes.

Sync messages published over [GossipSub](../networking/) carry a shadow copy of the recent DAG structure. Change payloads may be *deferred* — the message carries just the CID, and receivers fetch the block from the blockstore/network on demand. New peers joining a document load the DAG (or, with [compaction](../crdts/) enabled, a signed snapshot plus recent changes) from an existing peer.

## Local-first caching

The local replica is the primary copy. In browsers, the default configuration persists the Helia blockstore and datastore in **IndexedDB** (`/collabswarm-blocks` and `/collabswarm-data`), so a returning user reloads documents from disk without the network.

Replication follows use, in normal IPFS fashion: when a peer loads a document, it stores the blocks locally and can then serve them to other peers seeking the same data. Data is pulled by interested peers, not pushed — content nobody opens does not propagate. Popular documents end up widely replicated; unpopular ones may exist on only one or two devices.

## Pinning — read this part

Here is the blunt version: **if every client that holds a document loses its local storage and you have not set up pinning, that document is gone. Permanently.**

This is not a rare corner case. Browser storage is the *most evictable* storage there is:

- A user clears site data, uses private browsing, or switches devices.
- The browser evicts IndexedDB under storage pressure — origins without [persistent-storage permission](https://developer.mozilla.org/en-US/docs/Web/API/Storage_API) are fair game.
- Your two-person shared document lives on exactly two laptops, and both reinstall.

There is no server holding a copy behind the scenes, because there is no server. The network retains data only while at least one node holds it.

The remedy is **pinning**: at least one always-on node that holds a copy of every document's blocks. One copy is sufficient for existence — content addressing means anyone can fetch and verify it from there. Options:

- **Run a Swarmbase pinning node.** The server-side `CollabswarmNode` (from `@swarmbase/collabswarm`) subscribes to the document-publish topic and automatically pins every CID it hears about via Helia. This is the CRDT-aware option and the recommended one.
- **Use a generic IPFS pinning service** (Pinata, web3.storage, Filebase, etc.). Swarmbase blocks are standard IPFS blocks, so any IPFS-compatible service can pin them — though such services cannot interpret CRDT semantics or auto-discover new changes the way a `CollabswarmNode` does.

Because blocks are encrypted before they are stored, a pinning node needs no access to document contents — it stores and serves ciphertext. It sees the same metadata any [untrusted peer](../security/) sees.

During the current alpha, Swarmbase does not make pinning automatic or provide a hosted service. Until you have configured pinning, apply the venture-capital rule: **only put in data you can afford to lose.** See [Limitations](../limitations/) for the complete risk picture.

## Storage growth

Content-addressed history means storage grows with edits: every change is a new block, and blocks are immutable. The opt-in [compaction feature](../crdts/) can prune old change nodes from sync messages and optionally garbage-collect the pruned blocks from the local blockstore (`gcAfterPrune`) after a signed snapshot exists — trading away lazy access to old history for bounded storage. Pinning nodes, by contrast, are the natural place to retain full history for audit purposes.

## Where to go next

- [CRDTs](../crdts/) — what the change blocks contain and how history is compacted.
- [Security model](../security/) — why storing your data on untrusted nodes is safe for confidentiality (and what it doesn't protect).
- [Limitations](../limitations/) — data-loss risks, stated without cushioning.
