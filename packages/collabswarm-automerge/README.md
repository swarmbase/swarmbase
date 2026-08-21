# `@swarmbase/collabswarm-automerge`

Build collaborative applications with Automerge's JSON-like CRDT documents. This package provides the CRDT provider, serialization, ACL, and keychain adapters that connect Automerge documents to Swarmbase's encrypted peer-to-peer sync engine.

Swarmbase is the project name; some exported APIs retain the historical `Collabswarm` prefix.

## What you get

- **Automerge adapter** — wraps Automerge documents with Swarmbase's encryption, signing, and peer-to-peer networking
- **JSON-like data model** — familiar document structure with automatic merge of concurrent edits
- **Rich text support** — built-in Automerge Text type for collaborative editing

## Choose this package

Use this adapter for Automerge-backed collaborative documents. It works with:

- `@swarmbase/collabswarm`, included as a package dependency
- `@automerge/automerge`, required as a peer dependency
- optional React or Redux bindings for application state

## Entry point

`@swarmbase/collabswarm-automerge` exports `AutomergeProvider`, `AutomergeJSONSerializer`, Automerge-backed ACL and keychain implementations, and the document change handler.

## Start here

- [Collaborative wiki guide](https://swarmbase.github.io/swarmbase/cookbook/collaborative-wiki/)
- [Automerge + Redux example](https://github.com/swarmbase/swarmbase/tree/main/examples/wiki-swarm)
- [API reference](https://swarmbase.github.io/swarmbase/reference/)
- [Current limitations](https://swarmbase.github.io/swarmbase/concepts/limitations/)
- [Documentation index for coding agents](https://swarmbase.github.io/swarmbase/llms.txt)