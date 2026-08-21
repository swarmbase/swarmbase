# `@swarmbase/collabswarm-react`

React context and hooks for initializing Swarmbase and loading or editing collaborative documents.

> **Alpha:** Swarmbase is not production-ready and may lose data or change APIs. The project examples and [verified quick start](https://swarmbase.github.io/swarmbase/getting-started/quick-start/) use the repository source workspaces.

Swarmbase is the project name; some exported APIs retain the historical `Collabswarm` prefix.

## Choose this package

Use these bindings in a React application.

It depends on `@swarmbase/collabswarm`, declares React as a peer dependency, and requires compatible CRDT provider, serializer, ACL, and keychain implementations. The shipped Automerge and Yjs adapters provide those implementations.

## Runtime entry point

`@swarmbase/collabswarm-react` exports `useCollabswarm`, `useCollabswarmDocumentState`, `CollabswarmContext`, and the context result type.

## Start here

- [React integration guide](https://swarmbase.github.io/swarmbase/cookbook/react/)
- [Yjs and React example](https://github.com/swarmbase/swarmbase/tree/main/examples/password-manager)
- [API reference](https://swarmbase.github.io/swarmbase/reference/)
- [Current limitations](https://swarmbase.github.io/swarmbase/concepts/limitations/)
- [Documentation index for coding agents](https://swarmbase.github.io/swarmbase/llms.txt)
