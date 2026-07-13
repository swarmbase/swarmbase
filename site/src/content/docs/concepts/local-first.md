---
title: Why local-first
description: The local-first model behind Swarmbase — strong eventual consistency, what it optimizes for, and when you should use something else.
---

Swarmbase (formerly known as SwarmDB and, before that, collabswarm) is a local-first, end-to-end-encrypted document database that runs in the browser. This page explains what "local-first" means, why Swarmbase is built this way, and — just as importantly — when this model is the wrong choice.

## The local-first idea

In a conventional web application, the server owns your data. The browser holds a temporary view of it; every read and write is a network round trip; and when the server is unreachable, the application stops working.

Local-first software inverts this. The primary copy of the data lives on the user's device. Reads and writes happen against the local replica immediately, and synchronization with other devices and collaborators happens opportunistically, in the background, whenever a network path exists. The term comes from Kleppmann, Wiggins, van Hardenberg, and McGranaghan's paper [Local-First Software: You Own Your Data, in Spite of the Cloud](https://martin.kleppmann.com/papers/local-first.pdf), which sets out the ideals this model aims for: instant responsiveness, multi-device sync, offline operation, real collaboration, and data that outlives any particular service.

> "Live collaboration between computers without Internet access feels like magic in a world that has come to depend on centralized APIs."
> — Kleppmann et al., *Local-First Software*

Swarmbase is an attempt to make that model practical for application developers: a document database where the local replica is the source of truth, and the network is an optimization.

## Strong eventual consistency

Local-first writing creates an obvious problem: if every device writes locally without coordinating, replicas diverge. Swarmbase resolves this with [Conflict-free Replicated Data Types (CRDTs)](../crdts/), which provide **strong eventual consistency**: any two replicas that have received the same set of changes are in the same state, regardless of the order in which those changes arrived. No replica ever has to block, ask a server for permission, or win an election before accepting a write.

This is a deliberately weaker guarantee than the linearizability a centralized database gives you. There is no single global ordering of writes, and there is no moment at which you can say "every replica now agrees" — only the guarantee that replicas *converge* as changes propagate. What you get in exchange is that every operation is local, immediate, and available offline.

Concretely, in Swarmbase:

- Changes are applied to the local CRDT document first, then signed, encrypted, and broadcast to peers over a [libp2p GossipSub mesh](../networking/).
- Peers that were offline catch up when they reconnect; a document syncs as peers become available.
- If concurrent edits touch the same part of a document, the CRDT merges them deterministically — there is no "split-brain" state and no permanent data loss from the merge itself, though the merged result may need human re-editing if two people wrote contradictory content in the same place.

## What Swarmbase optimizes for

Swarmbase makes a specific set of trade-offs. It is designed for:

- **Responsiveness at the point of interaction.** Reads and writes hit the local replica. Latency does not depend on a server round trip.
- **Collaboration without a backend.** Peer discovery, change propagation, and storage use [libp2p, GossipSub, and IPFS/Helia](../storage/) rather than an application server. The only infrastructure a browser deployment needs is a lightweight relay/bootstrap node (see [Networking](../networking/)).
- **Operation on untrusted networks.** Documents are end-to-end encrypted with AES-GCM and every change is signed, so unknown or untrusted peers can help store and forward data without being able to read or forge it (see [Security model](../security/)).
- **Intermittent connectivity.** Users on flaky or absent networks keep working; changes sync later.
- **Small-to-medium collaborative groups.** Shared to-do lists, wikis, notes, planning documents — applications where a changing group of people edits shared documents and dynamic read/write access control matters.

## When not to use Swarmbase

Local-first is a trade-off, not a free lunch. Choose a different database when:

- **You need real-time global consistency.** If every node must agree on the current state at all times — inventory counters, payments, seat reservations, anything where two replicas briefly disagreeing is a correctness bug — you need a system with consensus or a single writer. Distributed-web systems are asynchronous by nature; Swarmbase's guarantees are convergence guarantees, not agreement-right-now guarantees.
- **Your dataset is very large or your transaction rate is very high.** CRDT documents carry their [change history](../crdts/), and Swarmbase has not been battle-tested at large scale. A high-throughput system of record belongs in a conventional database.
- **You need production-grade uptime guarantees today.** Swarmbase is in **alpha**. It is not yet appropriate for production or heavy usage — see [Limitations](../limitations/) for an honest accounting, including a real data-loss risk if no [pinning service](../storage/) is configured.
- **Your data must be centrally auditable and revocable.** End-to-end encryption plus replica-owned data means there is no central chokepoint. Revoking a reader's access [rotates keys for future changes](../security/) but cannot un-share what their device already holds.

## Where to go next

- [CRDTs](../crdts/) — how convergence works without consensus, and what it costs.
- [Networking](../networking/) — libp2p, GossipSub, and why browsers need a relay.
- [Storage](../storage/) — content-addressed storage, Merkle-DAGs, and pinning.
- [Security model](../security/) — identities, ACLs, signing, and encryption.
- [Limitations](../limitations/) — read this before building anything you care about.
