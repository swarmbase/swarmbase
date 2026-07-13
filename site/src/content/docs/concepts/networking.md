---
title: Networking
description: How Swarmbase peers find each other and exchange changes — libp2p transports, GossipSub, and why browsers need a relay node.
---

Swarmbase has no application server. Peers — mostly browsers — discover each other and exchange encrypted [CRDT changes](../crdts/) directly, using the [libp2p](https://libp2p.io/) networking stack. This page explains how that works and, crucially, why one piece of infrastructure is still required: a bootstrap/relay node.

## libp2p: transports and peer discovery

[libp2p](https://docs.libp2p.io/) is a modular peer-to-peer networking library: pluggable transports, connection encryption, stream multiplexing, peer discovery, and pub-sub. Swarmbase's default browser configuration wires up:

- **Transports:** WebSockets (for dialing server nodes such as the relay), WebRTC and WebRTC Direct (for browser-to-browser connections), and the Circuit Relay v2 transport (for relayed connections when direct ones fail).
- **Peer discovery:** a configured bootstrap list (the relay's multiaddress) plus GossipSub-based *pubsub peer discovery* — once connected to any node in the mesh, a peer announces itself on a discovery topic and learns about everyone else.
- **DHT:** a Kademlia DHT client (`clientMode: true`), so peers can query the DHT without serving it. Day-to-day discovery in current deployments happens via pubsub, not the DHT.
- **Pub-sub:** GossipSub, described below.

Every libp2p node has a *peer ID* derived from an ephemeral keypair. Note that peer IDs are transport-level identities and are **not** used for access control — they can change across restarts. Swarmbase identifies *users* by separate, permanent public keys (see [Security model](../security/)).

## GossipSub: propagating changes

Change propagation uses [GossipSub](https://github.com/libp2p/specs/tree/master/pubsub/gossipsub), libp2p's gossip-based pub-sub protocol. GossipSub builds a sparse mesh per topic and gossips message metadata to peers outside the mesh, which scales far better than naive flooding while keeping delivery robust.

Each Swarmbase document maps to one pub-sub topic — by default `/document/<document-path>`. Opening a document subscribes you to its topic. When you make a change, Swarmbase:

1. applies it locally,
2. signs the sync message with your user key,
3. encrypts it with the current document key (AES-GCM), and
4. publishes `keyID ‖ nonce ‖ ciphertext` to the document topic.

Every subscriber — collaborator or relay — receives the message; only holders of the document key can decrypt it, and only changes that verify against the writer ACL are applied. Besides the live pub-sub stream, Swarmbase runs point-to-point libp2p protocols for bringing peers up to date, including a document-load protocol for full history, a snapshot-load protocol for [compacted history](../crdts/), and a tip-hash quorum check that hardens initial loads against a single lying peer (see [Security model](../security/)).

## The NAT and firewall reality

In an ideal world, two browsers would just connect. In the real world:

- **Browsers cannot listen for inbound connections.** A web page can only dial out (WebSocket) or negotiate WebRTC sessions.
- **WebRTC needs signaling.** Two browsers can only establish a WebRTC connection after exchanging session descriptions and ICE candidates over some existing channel.
- **NATs and firewalls block direct paths.** Most consumer and corporate networks put peers behind NAT. STUN-based hole-punching works for many NAT types, but symmetric NATs and restrictive corporate firewalls defeat it.

libp2p employs [several NAT-traversal techniques](https://docs.libp2p.io/concepts/nat/), but for browser peers the consequence is unavoidable: **a Swarmbase deployment needs at least one publicly reachable bootstrap/relay node.** This is the one piece of infrastructure you must run (or point at); everything else is peer-to-peer.

## What the relay node does

Swarmbase ships a combined bootstrap + relay server (`relay-server/` in the repository) that fills three roles in a single process:

1. **Bootstrap.** New peers are configured with the relay's multiaddress (e.g. `/dns4/relay.example.com/tcp/443/wss/p2p/<peerId>`), dial it over WebSocket, and use pubsub peer discovery through it to find the rest of the swarm.
2. **Circuit Relay v2.** For peers that cannot reach each other directly, the relay forwards traffic using libp2p's [Circuit Relay v2](https://docs.libp2p.io/concepts/nat/circuit-relay/) protocol. After a relayed connection is up, libp2p attempts to upgrade to a direct WebRTC connection via ICE hole-punching; if that succeeds, the relay drops out of the data path. If both sides are behind symmetric NATs, the relayed path is the final path.
3. **GossipSub forwarding.** The relay subscribes to document topics as peers join them (optionally restricted by a topic allowlist) and forwards pub-sub messages between browser peers that have no direct connection yet.

Operationally the relay is small and cheap — a single, mostly stateless Node.js process. See the deployment guide for TLS, multi-relay topologies, and hosting details.

## What the relay does and does not see

The relay is explicitly an **untrusted** component. Treat it — and any unknown peer — as an honest-but-curious adversary.

The relay *cannot* see:

- **Document contents.** Change payloads are end-to-end encrypted with AES-GCM before publishing; the relay forwards ciphertext. It holds no document keys and is never granted any.
- **Valid ways to forge changes.** Changes are signed by writer keys the relay does not have; peers verify signatures before applying anything.

The relay *can* see (metadata):

- **Topic names**, which by default embed the document path (`/document/<path>`). Do not put sensitive information in document paths.
- **Traffic patterns:** which peer IDs and IP addresses subscribe to which topics, message sizes, and timing.
- **Wire framing:** the encryption key ID and nonce prefixed to each ciphertext (these are not secret, but they reveal when a document's key rotates).

This metadata exposure is inherent to any store-and-forward node and is shared by every untrusted peer in the mesh, not just the relay. The [Security model](../security/) page covers the full trust analysis.

## Practical notes

- **WebRTC also needs STUN.** Browsers use STUN servers for ICE candidate gathering; public STUN servers (e.g. Google's) are typically sufficient, and no TURN server is required since Circuit Relay v2 plays the equivalent fallback role at the libp2p layer.
- **HTTPS pages require `wss://`.** Browsers' mixed-content policy blocks plain `ws://` from HTTPS origins, so production relays sit behind TLS.
- **Relays don't persist your data.** A relay forwards messages; it is not a storage guarantee. For persistence beyond your peers' local storage, you need [pinning](../storage/).

## Where to go next

- [Storage](../storage/) — where changes are stored and how peers fetch missing history.
- [Security model](../security/) — the full picture of what untrusted peers can and cannot do.
- [Limitations](../limitations/) — including the honest version of "you must run a relay."
