# `@swarmbase/collabswarm-redux`

Redux actions, asynchronous thunks, and reducers for Swarmbase documents and peers.

> **Alpha:** Swarmbase is not production-ready and may lose data or change APIs. The project examples and [verified quick start](https://swarmbase.github.io/swarmbase/getting-started/quick-start/) use the repository source workspaces.

Swarmbase is the project name; some exported APIs retain the historical `Collabswarm` prefix.

## Choose this package

Use these bindings when Swarmbase state belongs in a Redux store. The package declares `@swarmbase/collabswarm`, Redux, and Redux Thunk as peer dependencies. The application must also supply compatible CRDT provider, serializer, ACL, and keychain implementations; the shipped Automerge and Yjs adapters provide them.

## Runtime entry point

`@swarmbase/collabswarm-redux` exports synchronous and asynchronous action creators, action constants and types, `initialState`, and `collabswarmReducer`.

The current local-change thunk has a documented ordering limitation; review the integration guide before relying on local Redux rendering.

## Start here

- [Redux integration guide](https://swarmbase.github.io/swarmbase/cookbook/redux/)
- [Automerge and Redux example](https://github.com/swarmbase/swarmbase/tree/main/examples/wiki-swarm)
- [API reference](https://swarmbase.github.io/swarmbase/reference/)
- [Current limitations](https://swarmbase.github.io/swarmbase/concepts/limitations/)
- [Documentation index for coding agents](https://swarmbase.github.io/swarmbase/llms.txt)
