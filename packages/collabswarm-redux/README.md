# `@swarmbase/collabswarm-redux`

Redux bindings for Swarmbase — actions, thunks, and reducers that manage node lifecycle, document open/close, peer connections, and change dispatch from a Redux store.

Swarmbase is the project name; some exported APIs retain the historical `Collabswarm` prefix.

## What you get

- **Async thunks** — `initializeAsync`, `openDocumentAsync`, `connectAsync`, `changeDocumentAsync` — for every Swarmbase lifecycle operation
- **Synchronous actions** — `CHANGE_DOCUMENT`, `SYNC_DOCUMENT`, `PEER_CONNECT`, etc. for direct Redux dispatching
- **`collabswarmReducer`** — handles document cache, peer state, readers/writers, and change subscriptions
- **Selector helpers** — typed access to `state.swarmbase.documents[id]` with TypeScript inference

## Choose this package

Use these bindings when Swarmbase state belongs in a Redux store. The package declares `@swarmbase/collabswarm`, Redux, and Redux Thunk as peer dependencies. The application must also supply compatible CRDT provider, serializer, ACL, and keychain implementations; the shipped Automerge and Yjs adapters provide them.

The current local-change thunk has a documented ordering limitation; review the integration guide before relying on local Redux rendering.

## Entry point

`@swarmbase/collabswarm-redux` exports synchronous and asynchronous action creators, action constants and types, `initialState`, and `collabswarmReducer`.

## Start here

- [Redux integration guide](https://swarmbase.github.io/swarmbase/cookbook/redux/)
- [Automerge + Redux example](https://github.com/swarmbase/swarmbase/tree/main/examples/wiki-swarm)
- [API reference](https://swarmbase.github.io/swarmbase/reference/)
- [Current limitations](https://swarmbase.github.io/swarmbase/concepts/limitations/)
- [Documentation index for coding agents](https://swarmbase.github.io/swarmbase/llms.txt)