---
title: React integration
description: Use the @swarmbase/collabswarm-react hooks to open, subscribe to, and edit documents from React components.
---

You're building a React app and want Swarmbase documents to behave like React state: open on mount, re-render on remote changes, clean up on unmount, and share one connection across many components. `@swarmbase/collabswarm-react` provides two hooks and a context that do exactly that.

## Install

```sh
npm install @swarmbase/collabswarm @swarmbase/collabswarm-yjs @swarmbase/collabswarm-react yjs
```

## Complete example

```tsx
import React from 'react';
import * as Y from 'yjs';
import {
  Collabswarm,
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
  useCollabswarmDocumentState,
} from '@swarmbase/collabswarm-react';

// Providers are stateless factories — create them once, outside components.
const crdt = new YjsProvider();
const serializer = new YjsJSONSerializer();
const auth = new SubtleCrypto();
const acl = new YjsACLProvider();
const keychain = new YjsKeychainProvider();

type YjsCollabswarm = Collabswarm<
  Y.Doc, Uint8Array, (doc: Y.Doc) => void, CryptoKey, CryptoKey, CryptoKey
>;

// 1. Provide the shared document caches at the top of your tree.
function SwarmProvider({ children }: { children: React.ReactNode }) {
  const [docCache, setDocCache] = React.useState<{
    [docPath: string]: CollabswarmDocument<any, any, any, any, any, any>;
  }>({});
  const [docDataCache, setDocDataCache] = React.useState<{ [docPath: string]: any }>({});
  const [docReadersCache, setDocReadersCache] = React.useState<{ [docPath: string]: any[] }>({});
  const [docWritersCache, setDocWritersCache] = React.useState<{ [docPath: string]: any[] }>({});

  return (
    <CollabswarmContext.Provider
      value={{
        docCache, docDataCache, docReadersCache, docWritersCache,
        setDocCache, setDocDataCache, setDocReadersCache, setDocWritersCache,
      }}
    >
      {children}
    </CollabswarmContext.Provider>
  );
}

// 2. Create the swarm once you have an identity keypair.
function App({ privateKey, publicKey }: { privateKey?: CryptoKey; publicKey?: CryptoKey }) {
  const config = defaultConfig(defaultBootstrapConfig([
    // '/dns4/relay.example.com/tcp/443/wss/p2p/<relay-peer-id>',
  ]));

  const collabswarm = useCollabswarm(
    privateKey,
    publicKey,
    crdt,
    serializer,   // ChangesSerializer
    serializer,   // SyncMessageSerializer
    serializer,   // LoadMessageSerializer
    auth,
    acl,
    keychain,
    config,
  );

  if (!collabswarm) return <p>Starting swarm…</p>;

  return (
    <SwarmProvider>
      <Note collabswarm={collabswarm} path="/notes/hello" />
    </SwarmProvider>
  );
}

// 3. Open a document and edit it.
function Note({ collabswarm, path }: { collabswarm: YjsCollabswarm; path: string }) {
  const [doc, changeDoc, aclControls] = useCollabswarmDocumentState(
    collabswarm,
    path,
  );

  if (!doc) return <p>Opening {path}…</p>; // still loading from peers

  return (
    <div>
      <pre>{doc.getText('content').toString()}</pre>
      <button
        onClick={() =>
          changeDoc((current: Y.Doc) => {
            current.getText('content').insert(0, 'Hello! ');
          })
        }
      >
        Prepend greeting
      </button>
      <p>{aclControls.writers?.length ?? 0} writer(s)</p>
    </div>
  );
}
```

## The hooks

### `useCollabswarm(privateKey, publicKey, provider, changesSerializer, syncMessageSerializer, loadMessageSerializer, authProvider, aclProvider, keychainProvider, config?)`

Constructs a `Collabswarm` node and calls `initialize(config)` in an effect. Returns `undefined` until both keys are set and initialization completes — so you can start rendering before the user "logs in" and pass the keys in later. The effect re-runs if `privateKey`/`publicKey` change.

### `useCollabswarmDocumentState(collabswarm, documentPath, originFilter?)`

Returns a tuple:

```typescript
const [doc, changeDoc, aclControls] = useCollabswarmDocumentState(swarm, '/notes/hello');
// doc:        DocType | undefined       — undefined until open() resolves
// changeDoc:  (fn, message?) => void    — apply a local change
// aclControls: {
//   readers, addReader, removeReader,
//   writers, addWriter, removeWriter,
// }
```

`originFilter` (`'all' | 'remote' | 'local'`, default `'all'`) controls which change origins trigger re-renders.

## Lifecycle: what the hook actually does

- **First subscriber opens the document.** The hook calls `collabswarm.doc(path)` then `docRef.open()`, and records the in-flight promise in a module-level task map. A second component mounting with the same path *awaits the same open* instead of opening twice.
- **Every hook instance gets its own subscription.** Each instance subscribes with a unique random ID, so multiple components watching one document don't clobber each other's handlers.
- **Reference counting on unmount.** Each path keeps a subscriber count. Unmounting unsubscribes that instance; when the *last* subscriber for a path unmounts, the caches are evicted and the document is `close()`d to free pubsub/network resources.
- **Strict-mode safe.** The open-task entry is only deleted after the open promise settles, so React 18 strict-mode's rapid unmount/remount doesn't call `open()` twice on the same document.
- **ACL data comes along for free.** On open, the hook fetches `getReaders()`/`getWriters()` and keeps them updated from change notifications, exposing them via the third tuple element.

## Loading states

There is no Suspense integration — the pattern that exists is the `undefined` check:

- `useCollabswarm(...)` returns `undefined` → swarm still initializing (or no keys yet).
- `useCollabswarmDocumentState(...)[0]` is `undefined` → document still opening.

Render spinners/placeholders on those, exactly as the wiki and password-manager examples do.

## Pitfalls

- **You must provide `CollabswarmContext` with real React state.** The context's default value has no-op setters — hooks will open documents but nothing will ever re-render. Wire all eight values (four caches + four setters) to `useState` as shown above.
- **`changeDoc` is a no-op before the document opens.** It looks up the doc ref in the cache and does nothing if it isn't there yet. Disable edit controls until `doc` is defined.
- **Don't rely on object identity for `Y.Doc`.** `YjsProvider` mutates the `Y.Doc` in place; the `doc` value's reference may not change between renders even though content did. Read values out (`doc.getText(...).toString()`) during render rather than memoizing on `doc`.
- **Unstable keys re-create the swarm.** `useCollabswarm` re-initializes when `privateKey`/`publicKey` change identity. Keep them in state set once, not derived per-render.
- **Alpha API.** The context-plus-module-cache design is explicitly acknowledged in the source as interim ("ew, global state"); expect this surface to change before 1.0.
