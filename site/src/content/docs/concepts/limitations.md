---
title: Limitations
description: Current Swarmbase production, durability, networking, security, scale, and verification limits.
---

Swarmbase is **alpha software**. It has no independent security audit, production SLA, durability SLA, or compatibility guarantee. Do not use it as the only copy of important data or for production workloads that require assured availability, recovery, or revocation.

## Distribution and operations

- Workspace packages build in the repository but are not published, and clean external-package installation is not an acceptance test.
- Production deployment is documentation-only: there is no automated deployment, upgrade, rollback, backup, or restore validation.
- The relay server has unit/build coverage, but operational scaling and multi-relay behavior are not proven.

## Local and durable operation

- Offline changes apply only to an already-loaded replica with the necessary local state and keys.
- A change promise includes authorization, storage, optional signing, encryption, publication, handlers, and possible compaction; it is not merely an in-memory UI edit.
- There is no durable outbox, publish acknowledgement, automatic retry, or guaranteed automatic reconnect. A direct `change()` can reject after leaving local Automerge or Yjs state modified. Transaction rollback restores immutable document references but is only best effort for in-place Yjs mutation.
- Browser defaults use IndexedDB-backed stores, but complete document recovery after close/restart is not verified. Browsers may evict or clear storage.
- Recovery requires discoverable CIDs/graph state, retained blocks, epoch keys, identity and KEM material, compatible configuration, and reachable peers. Loss of keys or identity may be unrecoverable.

## Storage, snapshots, and pinning

- There is no automatic replication-factor guarantee.
- Pinning is incomplete: `CollabswarmNode` listens for document-publish pin requests, but the core commit path does not publish them; no generic pinning service is integrated.
- Automatic compaction is off by default. Pruning changes what a peer can serve, and optional block GC is destructive.
- After snapshot compaction or pruning, a new replica can fail to bootstrap: it may lack the trusted writer ACL needed to accept the snapshot, retained tail changes may not reconstruct pruned state, required data may be unavailable, or default tip-hash quorum may not agree on served frontiers.
- Concurrent snapshots can represent different local states; deterministic preference does not prove equivalence.

## Networking and availability

- Browser deployments generally need bootstrap/relay infrastructure. Paths may be direct or relay-mediated; DCUtR, WebRTC, STUN, TURN, and direct upgrades are topology-dependent.
- GossipSub is best effort and does not guarantee delivery to every subscriber.
- Bootstrap, pubsub discovery, DHT, WebRTC, relay fallback, and NAT traversal are only partially system-tested. WebSocket and WebTransport synchronization are configuration claims without transport-specific acceptance tests.
- Connection churn, large multi-peer meshes, relay failover during edits, bootstrap replacement, and partition/rejoin remain partially or untested.
- Relays can observe metadata and can censor, delay, or partition traffic even though they need not see plaintext.
- Relay identity is operational state: clients pinned to an old relay peer ID may not recover after replacement. Topic allowlists/caps and relay capacity can deny service.

## Authorization and revocation

- Application-level signing is on by default but can be disabled, removing normal sync-message authentication and binary ACL enforcement.
- The active document path enforces reader/writer ACLs. Capability, UCAN, `UCANACL`, and ACL-chain code is standalone and not integrated end to end.
- Every writer can administer ACLs. A valid sync signature proves only that some current writer key signed; it is not durable explicit authorship.
- Initial-load quorum assumes enough independent reachable peer identities, is not Sybil-resistant, and trades availability for defense in depth. It covers the served frontier, not every concurrent head known anywhere.
- BeeKEM's cryptographic core and focused Welcome/PathUpdate flows are tested, but important membership state is memory-only and PathUpdate delivery is best effort. Restart, missed update, multiwriter, and full-system revocation gaps remain.
- Removing a writer blocks future acceptance under the current writer ACL; removing a reader attempts future key separation. Neither can erase plaintext or keys already copied, and no absolute post-revocation confidentiality guarantee is established.
- History visibility is configured locally and cannot force other replicas to delete earlier epoch keys.

## Convergence and verification

- Adapter tests support Yjs and Automerge convergence claims at component level. Complete system partition/rejoin and live post-load cross-browser convergence are only partially covered.
- A dedicated CI topology verifies initial encrypted Automerge document load across NAT through a relay; it does not verify every onboarding, mutation, reconnect, revocation, or recovery path.
- Performance, crypto, sync, convergence, Bloom, and query benchmarks exist, but they have no pass/fail budgets. No bounded latency, memory, storage, load, or sync guarantee follows from them.
- Large documents, long histories, high change rates, large groups, hostile graph shapes, prolonged churn, and production-scale swarms are unproven.

Use a conventional transactional or managed database when you require linearizable state, central control, audited deletion, assured disaster recovery, high throughput, or an SLA. The other concept pages explain the narrower implemented behavior: [Local-first](../local-first/), [CRDTs](../crdts/), [Networking](../networking/), [Storage](../storage/), and [Security](../security/).
