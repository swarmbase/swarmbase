# `@swarmbase/collabswarm-index`

Local and privacy-oriented indexing primitives with optional React query bindings for Swarmbase documents.

> **Alpha:** Swarmbase is not production-ready and may lose data or change APIs. The project examples and [verified quick start](https://swarmbase.github.io/swarmbase/getting-started/quick-start/) use the repository source workspaces.

Swarmbase is the project name; some exported APIs retain the historical `Collabswarm` prefix.

## Choose this package

Use this package to build local memory or IndexedDB indexes over documents already available to an application. It also contains blind-index and Bloom-filter gossip primitives, but does not provide a complete distributed-search workflow.

It depends on `@swarmbase/collabswarm` and `idb`. React is declared as a peer dependency for the optional query hooks.

## Runtime entry points

- `@swarmbase/collabswarm-index` — index definitions, storage, queries, document integration, blind indexes, and Bloom-filter primitives.
- `@swarmbase/collabswarm-index/react` — `useDefineIndexes` and `useIndexQuery`.

## Start here

- [Search indexing guide](https://swarmbase.github.io/swarmbase/cookbook/search-indexing/)
- [API reference](https://swarmbase.github.io/swarmbase/reference/)
- [Current limitations](https://swarmbase.github.io/swarmbase/concepts/limitations/)
- [Documentation index for coding agents](https://swarmbase.github.io/swarmbase/llms.txt)
