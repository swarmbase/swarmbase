---
title: API reference
description: Generated API documentation for the Swarmbase packages, straight from the source.
---

The package API reference is generated from source doc comments on every site build, so it matches the code on `main`. Use the **Packages** group in the sidebar to browse the supported package entry points:

| Package | Supported entry points | What it is |
| --- | --- | --- |
| `@swarmbase/collabswarm` | package root, `/node` | Core documents, networking, storage, encryption, and access control; `/node` provides the Node-only runtime. |
| `@swarmbase/collabswarm-yjs` | package root | Yjs CRDT provider. |
| `@swarmbase/collabswarm-automerge` | package root | Automerge CRDT provider. |
| `@swarmbase/collabswarm-react` | package root | React hooks for loading and editing documents. |
| `@swarmbase/collabswarm-redux` | package root | Redux bindings, including actions, reducers, and selectors. |
| `@swarmbase/collabswarm-index` | package root, `/react` | Indexing and querying, with React hooks in `/react`. |

The core package also exposes `./browser-primitives` as a targeted subpath for light browser consumers that do not import the full libp2p/Helia stack. That subpath is part of the generated API reference on every site build.

If a doc comment is missing, wrong, or unclear, improve it through a [contribution](../community/contributing/).
