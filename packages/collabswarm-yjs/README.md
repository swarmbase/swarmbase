# `@swarmbase/collabswarm-yjs`

Yjs CRDT, serialization, access-control, and keychain adapters for Swarmbase documents.

> **Alpha:** Swarmbase is not production-ready and may lose data or change APIs. The project examples and [verified quick start](https://swarmbase.github.io/swarmbase/getting-started/quick-start/) use the repository source workspaces.

Swarmbase is the project name; some exported APIs retain the historical `Collabswarm` prefix.

## Choose this package

Use this adapter for Yjs-backed collaborative documents. It works with:

- `@swarmbase/collabswarm`, included as a package dependency;
- `yjs`, required as a peer dependency;
- optional React or Redux bindings for application state.

## Runtime entry point

`@swarmbase/collabswarm-yjs` exports `YjsProvider`, `YjsJSONSerializer`, Yjs-backed ACL and keychain implementations, the document change handler, and key serialization helpers.

## Start here

- [Yjs schema design guide](https://swarmbase.github.io/swarmbase/cookbook/yjs-schema-design/)
- [Yjs and React example](https://github.com/swarmbase/swarmbase/tree/main/examples/password-manager)
- [API reference](https://swarmbase.github.io/swarmbase/reference/)
- [Current limitations](https://swarmbase.github.io/swarmbase/concepts/limitations/)
- [Documentation index for coding agents](https://swarmbase.github.io/swarmbase/llms.txt)
