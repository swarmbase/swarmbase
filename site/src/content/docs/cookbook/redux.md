---
title: Redux integration
description: Wire Swarmbase into a Redux store with @swarmbase/collabswarm-redux reducers and thunk actions.
---

Your app already keeps state in Redux and you want Swarmbase documents to flow through the same store: dispatch an action to open a document, read it from state with selectors, and have remote changes arrive as ordinary actions. `@swarmbase/collabswarm-redux` provides a reducer factory and a set of thunk action creators that do this.

:::note
The package targets classic Redux with `redux-thunk`. The in-repo examples (`examples/wiki-swarm`, `examples/browser-test`) demonstrate it with the Automerge CRDT backend; this recipe shows the same wiring with the golden-path Yjs backend and the reducer signature as currently implemented in `@swarmbase/collabswarm-redux`.
:::

## Install

```sh
npm install @swarmbase/collabswarm @swarmbase/collabswarm-yjs @swarmbase/collabswarm-redux redux redux-thunk react-redux yjs
```

## Store setup

`collabswarmReducer(...)` is a factory: it takes your identity keypair and the full provider stack, and returns a reducer whose initial state already contains a constructed (but uninitialized) `Collabswarm` node. That means you need the keypair *before* creating the store:

```typescript
// store.ts
import { combineReducers, createStore, applyMiddleware } from 'redux';
import thunk from 'redux-thunk';
import * as Y from 'yjs';
import { SubtleCrypto } from '@swarmbase/collabswarm';
import {
  YjsProvider,
  YjsJSONSerializer,
  YjsACLProvider,
  YjsKeychainProvider,
} from '@swarmbase/collabswarm-yjs';
import { collabswarmReducer, CollabswarmState } from '@swarmbase/collabswarm-redux';

export type SwarmState = CollabswarmState<
  Y.Doc,                 // DocType
  Uint8Array,            // ChangesType
  (doc: Y.Doc) => void,  // ChangeFnType
  CryptoKey,             // PrivateKey
  CryptoKey,             // PublicKey
  CryptoKey              // DocumentKey
>;

export interface RootState {
  swarm: SwarmState;
  // ...your other slices
}

// The swarm slice can live anywhere in your store; the *Async thunks find it
// through a selector you pass in.
export const selectSwarmState = (root: RootState): SwarmState => root.swarm;

export async function makeStore() {
  const keypair = await crypto.subtle.generateKey(
    { name: 'ECDSA', namedCurve: 'P-384' },
    true,
    ['sign', 'verify'],
  );

  const serializer = new YjsJSONSerializer();
  const rootReducer = combineReducers({
    swarm: collabswarmReducer(
      keypair.privateKey,
      keypair.publicKey,
      new YjsProvider(),
      serializer,              // ChangesSerializer
      serializer,              // SyncMessageSerializer
      serializer,              // LoadMessageSerializer
      new SubtleCrypto(),      // AuthProvider
      new YjsACLProvider(),
      new YjsKeychainProvider(),
    ),
  });

  return createStore(rootReducer, applyMiddleware(thunk));
}
```

## Dispatching document operations

Five thunk action creators cover the whole lifecycle. Each accepts your state selector as its final argument (omit it only if the collabswarm state *is* the store root):

```tsx
// NoteEditor.tsx
import React from 'react';
import * as Y from 'yjs';
import { useDispatch, useSelector } from 'react-redux';
import { defaultConfig, defaultBootstrapConfig } from '@swarmbase/collabswarm';
import {
  initializeAsync,
  connectAsync,
  openDocumentAsync,
  closeDocumentAsync,
  changeDocumentAsync,
} from '@swarmbase/collabswarm-redux';
import { RootState, selectSwarmState } from './store';

export function NoteEditor({ documentId }: { documentId: string }) {
  const dispatch = useDispatch<any>();
  const docState = useSelector(
    (root: RootState) => root.swarm.documents[documentId],
  );
  const peers = useSelector((root: RootState) => root.swarm.peers);

  React.useEffect(() => {
    const config = defaultConfig(
      defaultBootstrapConfig([
        // '/dns4/relay.example.com/tcp/443/wss/p2p/<relay-peer-id>',
      ]),
    );
    dispatch(initializeAsync(config, selectSwarmState))
      .then(() => dispatch(openDocumentAsync(documentId, selectSwarmState)));

    return () => {
      dispatch(closeDocumentAsync(documentId, selectSwarmState));
    };
  }, [documentId]);

  if (!docState) return <p>Opening… ({peers.length} peers)</p>;

  const doc: Y.Doc = docState.document;
  return (
    <div>
      <pre>{doc.getText('content').toString()}</pre>
      <button
        onClick={() =>
          dispatch(
            changeDocumentAsync(
              documentId,
              (current: Y.Doc) => {
                current.getText('content').insert(0, 'Hello from Redux! ');
              },
              undefined,          // optional change message
              selectSwarmState,
            ),
          )
        }
      >
        Edit
      </button>
    </div>
  );
}
```

`connectAsync(addresses, selector)` is available for dialing extra peers after initialization.

## How it works

The state shape is:

```typescript
interface CollabswarmState<...> {
  node: Collabswarm<...>;                 // the swarm node itself
  documents: {
    [documentPath: string]: {
      documentRef: CollabswarmDocument<...>;
      document: DocType;                  // current CRDT value
      peers?: string[];
    };
  };
  peers: string[];                        // connected peer addresses
}
```

- `initializeAsync` subscribes `peer-connect`/`peer-disconnect` handlers (dispatching `PEER_CONNECT`/`PEER_DISCONNECT`), calls `node.initialize(config)`, then dispatches `INITIALIZE`.
- `openDocumentAsync` gets a document ref via `node.doc(id)`, subscribes with the `'remote'` origin filter so each incoming remote change dispatches `SYNC_DOCUMENT`, then awaits `open()` and dispatches `OPEN_DOCUMENT`. If `open()` returns `false` (nothing found on the network) the path is treated as a new document.
- `changeDocumentAsync` calls `documentRef.change(fn, message)` and dispatches `CHANGE_DOCUMENT` with the updated document, so local edits update the store without a network round-trip.
- `closeDocumentAsync` unsubscribes, closes the ref, and dispatches `CLOSE_DOCUMENT`, which removes the entry from `state.documents`.
- The reducer handles `INITIALIZE`/`CONNECT` by shallow-copying state (the mutation happened inside the node — the copy forces subscribers to re-read), and `SYNC_DOCUMENT`/`CHANGE_DOCUMENT` by replacing the `document` value for that path.

All action type constants (`INITIALIZE`, `CONNECT`, `OPEN_DOCUMENT`, `CLOSE_DOCUMENT`, `SYNC_DOCUMENT`, `CHANGE_DOCUMENT`, `PEER_CONNECT`, `PEER_DISCONNECT`) and the plain action creators are exported if you need to reduce over them in your own slices.

## Pitfalls

- **The store holds non-serializable values by design.** `state.swarm.node` and each `documentRef` are live class instances, and Yjs mutates `document` in place. If you use Redux Toolkit, disable `serializableCheck` (and `immutableCheck`) for this slice; time-travel debugging will not faithfully replay swarm state.
- **Keys before store.** Because the reducer factory takes the keypair, you must generate or load the user's keys before `createStore`. If your login flow produces keys later, create the store after login (or re-create it) — there is no built-in "set identity later" action.
- **Always pass your selector.** The default selector assumes the collabswarm state is the *root* of the store. With `combineReducers` nesting, forgetting the selector argument on any `*Async` call reads `undefined` and logs "Node not initialized yet".
- **Yjs identity vs. re-render.** `SYNC_DOCUMENT` replaces the `document` reference in the store, but for Yjs it's the same mutated `Y.Doc` object. Select derived values (e.g. `doc.getText('content').toString()`) in components rather than memoizing on the doc reference.
- **Repo examples lag the package.** `examples/wiki-swarm` calls an older `collabswarmReducer` signature (no keypair, no load serializer). Follow the signature in this recipe, which matches the current package source.
