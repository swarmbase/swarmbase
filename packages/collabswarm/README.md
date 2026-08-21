# `@swarmbase/collabswarm`

Encrypted, peer-to-peer collaboration for TypeScript. Collabswarm provides the core document, storage, networking, encryption, access-control, and key-management primitives that the Swarmbase project composes into a local-first CRDT toolkit.

Swarmbase is the project name; some exported APIs retain the historical `Collabswarm` prefix.

## What you get

- **Encrypted documents** — every change is signed (ECDSA P-384) and encrypted (AES-GCM) before leaving the device
- **Peer-to-peer sync** — libp2p networking with WebSocket, WebRTC, WebTransport, and GossipSub
- **Content-addressed storage** — CID-addressed blocks in a browser IndexedDB-backed Helia blockstore
- **Cryptographic access control** — reader/writer ACLs enforced by key possession and signature verification
- **No application server** — relays carry ciphertext; they never see document plaintext

## Choose this package

Use this package for Swarmbase document and runtime APIs. Most applications pair it with one of the shipped CRDT adapters:

- [`@swarmbase/collabswarm-yjs`](https://github.com/swarmbase/swarmbase/tree/main/packages/collabswarm-yjs) for Yjs documents
- [`@swarmbase/collabswarm-automerge`](https://github.com/swarmbase/swarmbase/tree/main/packages/collabswarm-automerge) for Automerge documents

Applications can instead supply compatible provider, serializer, ACL, and keychain implementations. Add the React or Redux package only when those bindings are useful.

## Entry points

- `@swarmbase/collabswarm` — shared document, provider, configuration, cryptography, ACL, and keychain APIs
- `@swarmbase/collabswarm/node` — the Node-only `CollabswarmNode` runtime and default node configuration
- `@swarmbase/collabswarm/browser-primitives` — targeted browser-safe primitives without the full libp2p and Helia stack

## Start here

- [Quick start from source](https://swarmbase.github.io/swarmbase/getting-started/quick-start/)
- [API reference](https://swarmbase.github.io/swarmbase/reference/)
- [Security model](https://swarmbase.github.io/swarmbase/concepts/security/)
- [Current limitations](https://swarmbase.github.io/swarmbase/concepts/limitations/)
- [Architecture overview](https://swarmbase.github.io/swarmbase/concepts/architecture/)
- [Documentation index for coding agents](https://swarmbase.github.io/swarmbase/llms.txt)