---
title: Build a collaborative wiki
description: Model, open, render, and edit shared wiki articles with Swarmbase and Yjs.
---

You want a wiki where every article is editable by multiple people at once, keeps working offline, and syncs peer-to-peer without a central database. Each article should merge concurrent edits at the character level instead of losing them. This recipe builds that on Swarmbase's golden-path stack: Yjs documents plus the React hooks.

:::note
The in-repo example this recipe is based on (`examples/wiki-swarm`) uses the Redux integration and the Automerge CRDT backend. This recipe shows the same application shape on the Yjs + React hooks stack, which is the recommended path. If you prefer Redux, see [Redux integration](../redux/).
:::

## Install

```sh
npm install @swarmbase/collabswarm @swarmbase/collabswarm-yjs @swarmbase/collabswarm-react yjs quill-delta
```

## Model the documents

Each article is its own Swarmbase document (its own `Y.Doc`), opened lazily by path. Article metadata goes in a `Y.Map` (last-writer-wins per key), body text in a `Y.Text` (character-level merge), and tags in a `Y.Map<boolean>` used as an add-wins set:

```typescript
import * as Y from 'yjs';

// Shape of the Y.Doc at /articles/<id> — enforced by convention, not schema.
// title:   Y.Text  — short, but still merged character-by-character
// content: Y.Text  — article body (character-level merge)
// meta:    Y.Map   — updatedBy, updatedAt (LWW per key)
// tags:    Y.Map<boolean> — add-wins set
function readArticle(doc: Y.Doc) {
  return {
    title: doc.getText('title'),
    content: doc.getText('content'),
    meta: doc.getMap('meta'),
    tags: doc.getMap<boolean>('tags'),
  };
}
```

See [Yjs schema design](../yjs-schema-design/) for why each field uses the type it does.

## Set up the swarm

Providers are created once at module level. The `useCollabswarm` hook constructs and initializes the swarm when a keypair is available, and `CollabswarmContext.Provider` supplies the shared document caches the document hooks need:

```tsx
// App.tsx
import React from 'react';
import {
  CollabswarmDocument,
  SubtleCrypto,
  defaultConfig,
  defaultBootstrapConfig,
} from '@swarmbase/collabswarm';
import {
  YjsProvider,
  YjsJSONSerializer,
  YjsACLProvider,
  YjsKeychainProvider,
} from '@swarmbase/collabswarm-yjs';
import {
  CollabswarmContext,
  useCollabswarm,
} from '@swarmbase/collabswarm-react';
import { WikiArticle } from './WikiArticle';

const crdt = new YjsProvider();
const serializer = new YjsJSONSerializer();
const auth = new SubtleCrypto();
const acl = new YjsACLProvider();
const keychain = new YjsKeychainProvider();

export default function App() {
  const [privateKey, setPrivateKey] = React.useState<CryptoKey | undefined>();
  const [publicKey, setPublicKey] = React.useState<CryptoKey | undefined>();

  // Shared caches used by useCollabswarmDocumentState.
  const [docCache, setDocCache] = React.useState<{
    [docPath: string]: CollabswarmDocument<any, any, any, any, any, any>;
  }>({});
  const [docDataCache, setDocDataCache] = React.useState<{ [docPath: string]: any }>({});
  const [docReadersCache, setDocReadersCache] = React.useState<{ [docPath: string]: any[] }>({});
  const [docWritersCache, setDocWritersCache] = React.useState<{ [docPath: string]: any[] }>({});

  // Your identity is a WebCrypto keypair. Generate one on first run.
  React.useEffect(() => {
    (async () => {
      const keypair = await crypto.subtle.generateKey(
        { name: 'ECDSA', namedCurve: 'P-384' },
        true,
        ['sign', 'verify'],
      );
      setPrivateKey(keypair.privateKey);
      setPublicKey(keypair.publicKey);
    })();
  }, []);

  // Bootstrap through your relay (see the relay recipe).
  const relayAddr = process.env.REACT_APP_RELAY_MULTIADDR;
  const config = defaultConfig(defaultBootstrapConfig(relayAddr ? [relayAddr] : []));

  const collabswarm = useCollabswarm(
    privateKey,
    publicKey,
    crdt,
    serializer,
    serializer,
    serializer,
    auth,
    acl,
    keychain,
    config,
  );

  return (
    <CollabswarmContext.Provider
      value={{
        docCache, docDataCache, docReadersCache, docWritersCache,
        setDocCache, setDocDataCache, setDocReadersCache, setDocWritersCache,
      }}
    >
      {collabswarm
        ? <WikiArticle collabswarm={collabswarm} articleId="getting-started" />
        : <p>Connecting…</p>}
    </CollabswarmContext.Provider>
  );
}
```

## Open, render, and edit an article

`useCollabswarmDocumentState` opens the document at a path, subscribes to changes, and returns the current `Y.Doc` plus a change function. Text edits are applied as Quill deltas so concurrent edits merge instead of overwriting each other:

```tsx
// WikiArticle.tsx
import React from 'react';
import * as Y from 'yjs';
import Delta from 'quill-delta';
import { Collabswarm } from '@swarmbase/collabswarm';
import { useCollabswarmDocumentState } from '@swarmbase/collabswarm-react';

export type YjsCollabswarm = Collabswarm<
  Y.Doc,
  Uint8Array,
  (doc: Y.Doc) => void,
  CryptoKey,
  CryptoKey,
  CryptoKey
>;

export function WikiArticle({
  collabswarm,
  articleId,
}: {
  collabswarm: YjsCollabswarm;
  articleId: string;
}) {
  const [article, changeArticle] = useCollabswarmDocumentState(
    collabswarm,
    `/articles/${articleId}`,
  );

  if (!article) {
    // Document is still opening (or being fetched from peers).
    return <p>Loading article…</p>;
  }

  const title = article.getText('title').toString();
  const content = article.getText('content').toString();

  // Convert a full-string edit into character-level operations so
  // concurrent edits from other peers are preserved.
  const editText = (field: string, previous: string, next: string) => {
    const diff = new Delta().insert(previous).diff(new Delta().insert(next));
    changeArticle((doc: Y.Doc) => {
      doc.getText(field).applyDelta(diff.ops);
      doc.getMap('meta').set('updatedAt', Date.now());
    });
  };

  return (
    <div>
      <input
        value={title}
        placeholder="Article title"
        onChange={(e) => editText('title', title, e.target.value)}
      />
      <textarea
        value={content}
        placeholder="Write something…"
        onChange={(e) => editText('content', content, e.target.value)}
      />
    </div>
  );
}
```

## How it works

- `useCollabswarm` constructs a `Collabswarm` node and calls `initialize(config)` once you have a keypair. The node joins the libp2p swarm through your bootstrap relay.
- `useCollabswarmDocumentState` calls `collabswarm.doc(path)` and `open()` on first use, then `subscribe()`s. When any peer changes the document, the hook updates the shared cache and your component re-renders.
- `changeArticle(fn)` runs your function against the live `Y.Doc`; Swarmbase encodes the resulting Yjs update, signs it, encrypts it with the document key, and broadcasts it to peers.
- If `open()` finds no existing document on the network, the path is treated as a brand-new document — creating an article is just opening a path nobody has used yet.

For a multi-article wiki, keep one *index document* (for example `/articles-index`) holding a `Y.Map` of `articleId → title`, and update it whenever an article's title changes — the same pattern the password manager recipe uses for its secrets list.

## Pitfalls

- **Don't assign whole strings to text fields.** Replacing a title with a fresh value (rather than applying a delta diff) is last-writer-wins on the whole field and silently drops concurrent edits. The delta-diff pattern above is the production-safe approach.
- **The document is `undefined` while opening.** Opening involves a network round-trip to peers. Always render a loading state; don't assume the doc exists on first render.
- **One document per article, not one document for the wiki.** A single `Y.Doc` holding every article grows without bound (Yjs tombstones are permanent), loads eagerly, and shares a single ACL and encryption key. Split at entity and access-control boundaries.
- **Two tabs are two peers.** Each browser tab runs its own node with its own storage. That's a feature for testing merge behavior — open the same article path in two windows and type in both.
- **Alpha software.** Data exists only while some peer holds it. If every browser that opened an article clears its storage, the article is gone — run a pinning node for anything you care about (see [Keeping data alive](../pinning/)).
