# `@swarmbase/collabswarm-automerge`

Automerge CRDT, serialization, access-control, and keychain adapters for Swarmbase documents.

> **Alpha:** Swarmbase is not production-ready and may lose data or change APIs. The project examples and [verified quick start](https://swarmbase.github.io/swarmbase/getting-started/quick-start/) use the repository source workspaces.

Swarmbase is the project name; some exported APIs retain the historical `Collabswarm` prefix.

## Choose this package

Use this adapter for Automerge-backed collaborative documents. It works with:

- `@swarmbase/collabswarm`, included as a package dependency;
- `@automerge/automerge`, required as a peer dependency;
- optional React or Redux bindings for application state.

## Runtime entry point

`@swarmbase/collabswarm-automerge` exports `AutomergeProvider`, `AutomergeJSONSerializer`, Automerge-backed ACL and keychain implementations, and the document change handler.

## Start here

- [Collaborative wiki guide](https://swarmbase.github.io/swarmbase/cookbook/collaborative-wiki/)
- [Automerge and Redux example](https://github.com/swarmbase/swarmbase/tree/main/examples/wiki-swarm)
- [API reference](https://swarmbase.github.io/swarmbase/reference/)
- [Current limitations](https://swarmbase.github.io/swarmbase/concepts/limitations/)
- [Documentation index for coding agents](https://swarmbase.github.io/swarmbase/llms.txt)
