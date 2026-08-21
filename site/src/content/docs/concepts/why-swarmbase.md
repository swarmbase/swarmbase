---
title: Why Swarmbase
description: What makes Swarmbase different from other local-first and CRDT solutions, and when to use it.
---

Swarmbase is an **encrypted, peer-to-peer CRDT document toolkit** for TypeScript. It is not a database, a backend-as-a-service, or a drop-in realtime layer — it is a set of composable libraries that let you build collaborative applications where documents live on user devices and sync directly between peers.

## What makes Swarmbase different

### No application database server

In a typical collaborative app, the server is a central point of failure, a scaling bottleneck, and a target for data breaches. Swarmbase removes the application database server from the architecture. Documents are encrypted, signed, and content-addressed — peers exchange updates through relay nodes that carry ciphertext without ever seeing plaintext.

### Encryption is the default, not an add-on

By default (`enableSigning: true`), every document change is signed with the writer's identity and encrypted with AES-GCM before it leaves the device. Relays, bootstrap nodes, and remote storage see only opaque ciphertext. Encryption is always on, whether signing is enabled or not. Key material stays on devices — Swarmbase never transmits unencrypted document content.

### Composable, not monolithic

Swarmbase is not a single package. It is six libraries you compose:

| Package | Role |
|---|---|
| `@swarmbase/collabswarm` | Core: encryption, signing, ACL, storage, networking |
| `@swarmbase/collabswarm-yjs` | Yjs CRDT adapter |
| `@swarmbase/collabswarm-automerge` | Automerge CRDT adapter |
| `@swarmbase/collabswarm-react` | React hooks and bindings |
| `@swarmbase/collabswarm-redux` | Redux state management bindings |
| `@swarmbase/collabswarm-index` | Client-side search indexing |

Use only what you need. Compose the adapters, bindings, and indexing layers that fit your application.

### CRDT adapters, not a CRDT library

Swarmbase does not implement its own CRDT. It adapts existing, well-tested CRDT libraries — Yjs and Automerge — wrapping them with encryption, signing, access control, and peer-to-peer transport. You get the battle-tested merge semantics of Yjs or Automerge combined with Swarmbase's security and networking model.

### Source-available first

All six packages are source workspaces in a single repository. You build from source, run the examples locally, and inspect every layer. There is no closed-source coordination service or proprietary sync server.

## When to use Swarmbase

Swarmbase is a good fit for applications that need:

- **Encrypted document collaboration** where plaintext must never reach a server
- **Peer-to-peer sync** without a central application database
- **Offline-capable editing** where users make changes locally and merge later
- **Fine-grained access control** with cryptographic enforcement
- **Full control over infrastructure** — you run the relays, you own the keys

Swarmbase is **not** a good fit when:

- You want a managed backend service (Swarmbase has no cloud offering)
- You need sub-100ms multiplayer presence (CRDT conflict resolution is eventual, not real-time)
- You are building a simple single-user offline app (use IndexedDB directly)
- You need SQL queries or relational data (Swarmbase is a document store)

## Current status

Swarmbase is under active development with a growing CI-verified feature set. It is suitable for experiments, prototypes, and learning about local-first systems.

Key capabilities that are verified end-to-end in CI:

- Encrypted document creation, mutation, and retrieval through a Circuit Relay
- Single-browser smoke tests for all three example applications
- NAT traversal with Docker-backed integration tests
- Basic peer discovery and GossipSub message delivery

See the [feature audit](https://github.com/swarmbase/swarmbase/blob/main/docs/feature-audit.md) for a detailed capability-to-evidence map, and the [limitations](../limitations/) page for a complete list of current gaps.

## Next steps

- [Quick start](../../getting-started/quick-start/) — build from source and run the examples
- [Concepts](../local-first/) — understand the architecture and design choices
- [Cookbook](../../cookbook/collaborative-wiki/) — code patterns for common tasks
- [Roadmap](../../community/roadmap/) — what is being worked on next