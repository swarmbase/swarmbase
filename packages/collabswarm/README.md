# `@swarmbase/collabswarm`

Core document, storage, networking, encryption, access-control, and key-management primitives for Swarmbase.

> **Alpha:** Swarmbase is not production-ready and may lose data or change APIs. The project examples and [verified quick start](https://swarmbase.github.io/swarmbase/getting-started/quick-start/) use the repository source workspaces.

Swarmbase is the project name; some exported APIs retain the historical `Collabswarm` prefix.

## Choose this package

Use this package for Swarmbase document and runtime APIs. Most applications pair it with one of the shipped CRDT adapters:

- [`@swarmbase/collabswarm-automerge`](https://github.com/swarmbase/swarmbase/tree/main/packages/collabswarm-automerge) for Automerge documents;
- [`@swarmbase/collabswarm-yjs`](https://github.com/swarmbase/swarmbase/tree/main/packages/collabswarm-yjs) for Yjs documents.

Applications can instead supply compatible provider, serializer, ACL, and keychain implementations. Add the React or Redux package only when those bindings are useful.

## Runtime entry points

- `@swarmbase/collabswarm` — shared document, provider, configuration, cryptography, ACL, and key-management APIs.
- `@swarmbase/collabswarm/node` — the Node-only `CollabswarmNode` runtime and default node configuration.
- `@swarmbase/collabswarm/browser-primitives` — targeted browser-safe primitives without the full libp2p and Helia stack.

## Start here

- [API reference](https://swarmbase.github.io/swarmbase/reference/)
- [Minimal Automerge and Redux example](https://github.com/swarmbase/swarmbase/tree/main/examples/browser-test)
- [Security model](https://swarmbase.github.io/swarmbase/concepts/security/) and [current limitations](https://swarmbase.github.io/swarmbase/concepts/limitations/)
- [Documentation index for coding agents](https://swarmbase.github.io/swarmbase/llms.txt)
