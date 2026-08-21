# `@swarmbase/collabswarm-index`

Client-side indexing for Swarmbase documents. Build local materialized indexes over your encrypted CRDT documents, with optional React query hooks for reactive UIs — no server-side indexing required.

Swarmbase is the project name; some exported APIs retain the historical `Collabswarm` prefix.

## What you get

- **`IndexManager`** — define indexes over document fields, update incrementally on each change, query with field filters and sort clauses
- **Pluggable storage** — in-memory or IndexedDB-backed via `MemoryIndexStorage` / `IDBIndexStorage`
- **Blind-index primitives** — deterministic equality tokens for privacy-preserving search without revealing field values
- **Bloom-filter gossip** — peer discovery via Bloom filter exchange for candidate routing (deferred integration)
- **React hooks** — `useDefineIndexes` and `useIndexQuery` for reactive UI updates from indexed data

## Choose this package

Use this package to build local memory or IndexedDB indexes over documents already available to an application. It depends on `@swarmbase/collabswarm` and `idb`. React is declared as a peer dependency for the optional query hooks.

## Entry points

- `@swarmbase/collabswarm-index` — index definitions, storage, queries, document integration, blind indexes, and Bloom-filter primitives
- `@swarmbase/collabswarm-index/react` — `useDefineIndexes` and `useIndexQuery`

## Start here

- [Search indexing guide](https://swarmbase.github.io/swarmbase/cookbook/search-indexing/)
- [API reference](https://swarmbase.github.io/swarmbase/reference/)
- [Current limitations](https://swarmbase.github.io/swarmbase/concepts/limitations/)
- [Documentation index for coding agents](https://swarmbase.github.io/swarmbase/llms.txt)