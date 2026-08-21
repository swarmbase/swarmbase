# `@swarmbase/collabswarm-react`

React hooks and context for Swarmbase — initialize the node, open documents, subscribe to changes, and manage ACL state, all from your component tree.

Swarmbase is the project name; some exported APIs retain the historical `Collabswarm` prefix.

## What you get

- **`useCollabswarm`** — initialize the Swarmbase node with signing keys, providers, and bootstrap config
- **`useCollabswarmDocumentState`** — open a document, subscribe to remote updates, and access the current CRDT state
- **`CollabswarmContext`** — provider for document cache, readers/writers state, and shared configuration
- **Works with any CRDT adapter** — pair with `@swarmbase/collabswarm-yjs` or `@swarmbase/collabswarm-automerge`

## Choose this package

Use these bindings in a React application. It depends on `@swarmbase/collabswarm`, declares React as a peer dependency, and requires compatible CRDT provider, serializer, ACL, and keychain implementations. The shipped Automerge and Yjs adapters provide those implementations.

## Entry point

`@swarmbase/collabswarm-react` exports `useCollabswarm`, `useCollabswarmDocumentState`, `CollabswarmContext`, and the context result type.

## Start here

- [React integration guide](https://swarmbase.github.io/swarmbase/cookbook/react/)
- [Yjs + React example](https://github.com/swarmbase/swarmbase/tree/main/examples/password-manager)
- [API reference](https://swarmbase.github.io/swarmbase/reference/)
- [Current limitations](https://swarmbase.github.io/swarmbase/concepts/limitations/)
- [Documentation index for coding agents](https://swarmbase.github.io/swarmbase/llms.txt)