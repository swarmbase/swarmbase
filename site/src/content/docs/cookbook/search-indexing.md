---
title: Searching encrypted documents
description: Query your Swarmbase documents locally, and search across peers without revealing plaintext, with @swarmbase/collabswarm-index.
---

Your documents are end-to-end encrypted, so no server can build a search index for you — and you wouldn't want one that could. You still need "find all articles by Alice, newest first" to be fast, and ideally to discover which *peers* might hold matching documents without telling them what you're looking for. `@swarmbase/collabswarm-index` gives you three composable pieces: a local materialized index, blind index tokens for encrypted equality search, and Bloom filter gossip for peer discovery.

## Install

```sh
npm install @swarmbase/collabswarm-index
```

## Local index: query the documents you hold

Since every peer decrypts the documents it has access to, each peer can index its *own* copies. `IndexManager` maintains a queryable materialized view, fed by document change events:

```typescript
import * as Y from 'yjs';
import {
  IndexManager,
  IDBIndexStorage,        // IndexedDB persistence (browser)
  // MemoryIndexStorage,  // in-memory alternative (tests / Node)
  CollabswarmIndexIntegration,
} from '@swarmbase/collabswarm-index';

// The extractor turns your CRDT doc into a plain snapshot for indexing.
const storage = new IDBIndexStorage('my-app-index');
const manager = new IndexManager<Y.Doc>(
  storage,
  (doc) => doc.getMap('meta').toJSON(),
);

await manager.defineIndex({
  name: 'articles',
  collectionPrefix: '/articles/',   // which document paths belong to this index
  fields: [
    { path: 'title', type: 'string' },
    { path: 'author', type: 'string' },
    { path: 'createdOn', type: 'date' },
    { path: 'viewCount', type: 'number' },
  ],
});

// Keep the index in sync with a live document. CollabswarmDocument
// satisfies the SubscribableDocument interface directly.
const integration = new CollabswarmIndexIntegration(manager);
integration.trackDocument(docRef);      // indexes now + on every change
// later: integration.untrackDocument(docRef);

// Query it.
const result = await manager.query({
  indexName: 'articles',
  filters: [{ path: 'author', operator: 'eq', value: 'Alice' }],
  sort: [{ path: 'createdOn', direction: 'desc' }],
  limit: 20,
});
// result.documents: [{ documentPath, snapshot }, ...]
// result.totalCount: matches before limit/offset
```

Supported filter operators: `eq`, `neq`, `gt`, `gte`, `lt`, `lte`, `prefix`, `in`, `contains`.

### React hooks

Live query results come from the `react` subpath:

```tsx
import { IndexManager, IndexDefinition } from '@swarmbase/collabswarm-index';
import { useDefineIndexes, useIndexQuery } from '@swarmbase/collabswarm-index/react';

function ArticleSearch({
  manager,
  definitions,
}: {
  manager: IndexManager<unknown>;
  definitions: IndexDefinition[];   // e.g. [the 'articles' definition above]
}) {
  const ready = useDefineIndexes(manager, definitions);
  const result = useIndexQuery(manager, {
    indexName: 'articles',
    filters: [{ path: 'author', operator: 'eq', value: 'Alice' }],
  });

  if (!ready) return <p>Preparing index…</p>;
  return (
    <ul>
      {result.documents.map((d) => (
        <li key={d.documentPath}>{String((d.snapshot as any).title)}</li>
      ))}
    </ul>
  );
}
```

`useIndexQuery` subscribes to the manager and re-renders whenever the result set may have changed; `useDefineIndexes` registers definitions on mount and removes them on unmount.

## Blind index: equality search without plaintext

A blind index maps a field value to a deterministic token — `HMAC-SHA-256(fieldKey, normalize(value))`, truncated and base64url-encoded. Whoever holds the field key can compute the token for a query value and compare tokens; anyone else sees only opaque strings. Field keys are derived per field path with HKDF, so tokens for `title` and `author` are cryptographically unrelated:

```typescript
import {
  SubtleBlindIndexProvider,
  BlindIndexQuery,
  BlindIndexEntry,
} from '@swarmbase/collabswarm-index';

const provider = new SubtleBlindIndexProvider(); // 16-byte (128-bit) tokens by default

// Derive a per-field key from 32 bytes of shared secret material.
// (deriveFieldKey(masterCryptoKey, path) also exists, but requires a
// raw-exportable key; the raw-bytes form is preferred.)
const fieldKey = await provider.deriveFieldKeyFromRaw(rawKeyMaterial, 'author');

// Writer side: compute a token when a document changes.
const token = await provider.computeToken(fieldKey, 'Alice');
// e.g. store alongside the encrypted change: { author: 'q1w2e3...' }

// Query side: match entries by token equality.
const query = new BlindIndexQuery(provider);
const matches: BlindIndexEntry[] = await query.exactMatch(
  fieldKey,
  'author',
  'alice',            // values are normalized (lowercased/trimmed) before HMAC
  entries,            // BlindIndexEntry[]: { documentPath, blindIndexTokens }
);

// Multi-field equality with a single compound token:
const compound = await provider.computeCompoundToken(fieldKey, ['Alice', 'Technology']);
```

The Swarmbase wire format already reserves a slot for these: every encrypted change block has an optional `blindIndexTokens: Record<string, string>` field that serializers validate and carry end-to-end. There is not yet a high-level `document.change()` option that computes and attaches tokens for you — today you compute tokens with the provider and distribute the `BlindIndexEntry` records at the application level. This wiring is an active area of development.

## Bloom filter gossip: which peers should I even ask?

To search beyond your own documents, peers periodically gossip Bloom filters summarizing the (tokenized) terms in their indexes. You can then ask "which peers *might* match all these terms?" without any peer learning your query terms in plaintext:

```typescript
import { BloomFilterGossip } from '@swarmbase/collabswarm-index';

const gossip = new BloomFilterGossip({
  // defaults: topic '/collabswarm/bloom-index/1.0.0',
  // 65,536-bit filter, 7 hash functions, republish every 30s
});

// Wire it to your libp2p pubsub before starting.
gossip.setPubSub(
  async (topic, data) => { /* pubsub.publish(topic, data) */ },
  (topic, handler) => { /* pubsub.subscribe + route messages to handler(peerId, data) */ },
  (topic) => { /* pubsub.unsubscribe(topic) */ },
);
gossip.start();

// Advertise blind-index tokens (not plaintext!) from your own documents.
gossip.addTerm(token);

// Find candidate peers for a query (must match ALL terms).
const candidatePeers = gossip.queryPeers([queryToken]);
// Then fetch/ask only those peers. Expect false positives — verify locally.

gossip.stop();
```

## Privacy trade-offs — read before shipping

Blind indexing is a deliberate compromise, not "free" encrypted search:

- **Equality patterns leak.** Tokens are deterministic: an observer can tell that two documents share the same (unknown) author, and can build frequency histograms. If they can *guess* a value and obtain the field key, they can confirm it.
- **Token truncation is a dial.** The default 16-byte tokens balance collision resistance against leakage; shorter tokens (`new SubtleBlindIndexProvider(8)`) increase false positives but reveal less.
- **Bloom filters leak probabilistic membership.** A gossiped filter lets anyone test candidate tokens against your document set. Filters also only ever *add* bits — they don't forget deleted documents until rebuilt.
- **Only equality (and compound equality).** No substring, range, or relevance queries over encrypted data — those run on your local decrypted index instead.

## Performance framing

The package ships benchmark suites (`packages/collabswarm-index/src/__benchmarks__/`) you can run with `yarn benchmark`:

- **Blind index ops are cheap** — a token is one HMAC-SHA-256 (plus a one-time HKDF per field key); the suite measures derivation, string/numeric/compound token generation, and match throughput.
- **Local queries are measured up to 100k entries** — exact-match, range, prefix, compound, and sorted queries against `MemoryIndexStorage`, plus a full-scan baseline, so you can see where an index stops being "instant" for your data size.
- **Bloom filters scale by size, not content** — insert/query/merge/serialize are benchmarked from 1k-bit to 1M-bit filters; false-positive rate is measured against fill ratio, which is what you tune `filterSizeInBits` against.

## Pitfalls

- **The index only covers documents you track.** There is no network crawler: if you never opened and `trackDocument`-ed a document, it isn't in your local index. Design an index document or use the Bloom gossip layer for discovery.
- **`removeIndex` deletes stored entries**, and `useDefineIndexes` removes its definitions on unmount — don't treat the materialized index as durable app data; treat it as a rebuildable cache (`rebuildIndex` exists for exactly that).
- **Keep indexed fields at stable paths.** The extractor + dot-notation field paths (`meta.author`) only work if all documents in a collection put fields in the same place — see the schema recipe's [indexing guidance](../yjs-schema-design/).
- **Guard the field keys.** Anyone holding a blind-index field key can run confirmation attacks on that field forever. Distribute them like document keys, and don't reuse them across unrelated collections.
- **Alpha status.** The local index and blind-index/Bloom primitives are implemented and tested, but the end-to-end story (auto-attaching tokens to change blocks, cross-peer query execution) is still being assembled. Expect APIs to move.
