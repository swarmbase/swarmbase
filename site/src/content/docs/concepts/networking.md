---
title: Networking
description: Swarmbase transports, discovery, synchronization paths, relay trust, and current network evidence.
---

Swarmbase uses Helia/libp2p for peer connectivity and document synchronization. Browser-to-browser traffic may be direct or relay-mediated; neither path is guaranteed.

## Design intent

The network should discover collaborators, deliver encrypted live changes, and let a joining or stale replica request retained state without requiring an application data server. Relays and unknown peers may forward ciphertext without receiving document plaintext.

## Implemented and default behavior

The browser configuration includes:

- **WebSockets** for dialable endpoints such as bootstrap or relay nodes;
- **WebRTC** and **WebRTC Direct** for browser-capable direct paths;
- **WebTransport** where the runtime and remote endpoint support it;
- **Circuit Relay v2** for relay-mediated connections;
- **GossipSub** for live document messages and pubsub peer discovery;
- bootstrap discovery, AutoNAT, DCUtR, and a client-mode Kademlia DHT.

Configuration is not proof of end-to-end operation. Bootstrap, pubsub discovery, and DHT behavior have partial integration evidence; WebSockets and WebTransport do not have transport-specific synchronization acceptance tests.

Each open document subscribes to a namespaced topic. A local commit publishes an encrypted sync message containing a signed shadow graph when application signing is enabled. GossipSub is best effort: publish success does not acknowledge every collaborator, and there is no guarantee that every subscriber receives every message.

Initial or catch-up loading uses point-to-point protocols. A responder serves its retained sync tree or a snapshot plus retained changes. It does not necessarily serve every head or every block the peer has ever observed. Missing deferred payloads are fetched by CID when reachable.

## NAT traversal and infrastructure

Browsers cannot accept ordinary inbound sockets, and WebRTC negotiation still needs a signaling path. Bootstrap/relay infrastructure is therefore normally required for onboarding and connectivity. DCUtR, ICE, and STUN may upgrade a relayed path to direct WebRTC, but success depends on browsers, NATs, firewalls, and topology.

Circuit Relay is a fallback, not proof that TURN is never needed. The ICE configuration supports STUN and TURN entries, and restrictive deployments may require TURN or other operator-controlled connectivity. The defaults use public STUN services; those operators learn the peer's public IP/port mapping and associated network metadata.

No automatic reconnect or replay guarantee is documented. Applications must handle connection churn, failed loads, and failed publications.

## Relay trust and operations

Document payloads and stored change blocks are encrypted before untrusted infrastructure handles them. With application signing enabled, peers also reject sync messages that do not verify under a current writer key. Application signing is on by default but can be disabled, which removes those application-layer authentication and authorization checks.

A relay still can:

- observe peer IDs, IP addresses, topic names, timing, sizes, and key-rotation metadata;
- delay, drop, reorder, or selectively forward traffic;
- censor a document or partition peers;
- become a capacity or availability bottleneck.

The shipped relay has topic-policy controls and tests, but relay scaling, in-flight failover, replacement after identity changes, bootstrap replacement, and multi-relay behavior are not default guarantees. Clients configured with a relay's peer ID can remain pinned to that identity after restart. Topic caps or allowlists can also deny service to additional documents.

Relays do not provide durable storage. Integrate retention separately; see [Storage](../storage/).

## CI-backed evidence

Current CI builds the relay in Docker-backed topologies and exercises it in integration, NAT-traversal, and cross-NAT jobs. Relay unit tests exist in the repository but are not part of the CI matrix. Peer discovery, GossipSub, WebRTC, Circuit Relay, DCUtR/STUN/TURN configuration, bootstrap, and DHT are partial. A dedicated clean-topology test verifies initial encrypted Automerge document load across NAT through a relay. Live post-load pubsub convergence, partition/rejoin, relay failover during edits, TURN-authenticated behavior, transport-specific WebSocket/WebTransport sync, and larger multi-peer churn are not established. See [Limitations](../limitations/).
