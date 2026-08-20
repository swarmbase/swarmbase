---
title: Why local-first
description: Swarmbase's local-first design intent, current offline behavior, and verified limits.
---

Swarmbase is an alpha, local-first, end-to-end-encrypted document database for browsers. “Local-first” describes the architecture it aims for; it is not a promise that every workflow works without a network or survives every restart.

## Design intent

A local-first application keeps an editable replica near the user instead of treating the browser as a temporary view of a server database. Reads and changes should be responsive, replicas should synchronize when paths exist, and no coordinator should order every write.

Swarmbase uses [CRDT adapters](../crdts/) to merge committed changes, [libp2p](../networking/) to exchange them, and [CID-addressed encrypted blocks](../storage/) to retain them. This favors collaboration and intermittent connectivity over linearizable, globally current state.

## Implemented and default behavior

An already-loaded replica can be read and changed without a working peer connection. A committed `change()` or transaction updates the local CRDT, but its returned promise also covers authorization, block storage, signing when enabled, encryption, publication, handlers, and possible compaction. A direct `change()` mutates or replaces the local document before that later work and has no rollback path, so rejection can leave the local mutation for both Automerge and Yjs. Transaction rollback restores a saved document reference for immutable providers such as Automerge, but remains best effort for in-place Yjs state.

There is no durable outbox, delivery acknowledgement, or retry queue for unpublished changes. A later peer connection does not by itself guarantee that every missed publication is replayed, and Swarmbase does not promise automatic reconnection. Applications must expose failures and design explicit recovery or resynchronization.

A network is normally required to:

- onboard a new reader and deliver identity/KEM material and a Welcome;
- load a replica that is not already available locally;
- recover missing blocks, keys, graph state, or identity material;
- synchronize with collaborators.

Browser defaults use IndexedDB-backed Helia stores, but complete close/restart recovery from persisted document state is not verified. Persistence is therefore partial, not a durable offline guarantee.

Concurrent changes are interpreted by the selected CRDT. Causal predecessors must be applied appropriately; concurrent operations use the adapter's merge semantics. This supports convergence when replicas eventually receive compatible changes, but it does not guarantee preservation of human intent, absence of semantic conflicts, or absence of data loss elsewhere in the system.

## Infrastructure boundary

“Local-first” does not mean “infrastructure-free.” A browser deployment commonly needs reachable bootstrap and Circuit Relay infrastructure, may need STUN or TURN for WebRTC connectivity, and remains vulnerable to relay outage or censorship. Durable retention is a separate integration: relays forward traffic but do not provide a storage or pinning guarantee. See [Networking](../networking/) and [Storage](../storage/).

## CI-backed evidence

Current CI verifies the Yjs and Automerge adapters in isolation and exercises a real encrypted Automerge document load across a relay-backed NAT topology. Create/open/change/close/sync, IndexedDB-backed browser storage, persistence across restart, and system partition/rejoin are only partially covered. Live post-load cross-browser mutation, real reconnect behavior, and durable recovery are not default acceptance guarantees.

## Fit

Swarmbase may fit small collaborative documents where temporary divergence is acceptable and the application can own identity, recovery, infrastructure, and operational failure handling. Do not use it as a payment, inventory, reservation, high-throughput system of record, or as the sole copy of important data. Read [Limitations](../limitations/) before adopting it.
