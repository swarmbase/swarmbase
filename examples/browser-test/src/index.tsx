import React from 'react';
import { createRoot } from 'react-dom/client';
import 'jsoneditor/dist/jsoneditor.css';
import 'jsoneditor-react/es/editor.css';
import './index.css';
import App from './App';
import { Provider } from 'react-redux';
import { createStore, applyMiddleware, Middleware } from 'redux';
import {
  changeDocumentAsync,
  collabswarmReducer,
  connectAsync,
  openDocument,
  openDocumentAsync,
  syncDocument,
} from '@collabswarm/collabswarm-redux';
import {
  AutomergeACLProvider,
  AutomergeJSONSerializer,
  AutomergeKeychainProvider,
  AutomergeProvider,
} from '@collabswarm/collabswarm-automerge';
import { SubtleCrypto } from '@collabswarm/collabswarm';
import { thunk } from 'redux-thunk';
import { AutomergeSwarmActions, AutomergeSwarmState } from './utils';

const logger: Middleware = store => next => action => {
  console.log('dispatching', action);
  let result = next(action);
  console.log('next state', store.getState());
  return result;
}

declare global {
  interface Window {
    __SWARMBASE_TEST_IDENTITY__?: { privateKey: JsonWebKey; publicKey: JsonWebKey };
    __SWARMBASE_TEST__?: {
      open: (path: string) => Promise<unknown>;
      openWithDocumentKey: (
        path: string,
        saved: { id: number[]; key: JsonWebKey },
      ) => Promise<unknown>;
      exportDocumentKey: (path: string) => Promise<{ id: number[]; key: JsonWebKey }>;
      connect: (addresses: string[]) => Promise<unknown>;
      addresses: () => string[];
      circuitAddress: () => string | undefined;
      change: (path: string, key: string, value: unknown) => Promise<unknown>;
      state: () => AutomergeSwarmState<any>;
    };
  }
}

const injectedIdentity = window.__SWARMBASE_TEST_IDENTITY__;
const userKeyPair = injectedIdentity
  ? {
      privateKey: await crypto.subtle.importKey(
        'jwk', injectedIdentity.privateKey,
        { name: 'ECDSA', namedCurve: 'P-384' }, false, ['sign'],
      ),
      publicKey: await crypto.subtle.importKey(
        'jwk', injectedIdentity.publicKey,
        { name: 'ECDSA', namedCurve: 'P-384' }, true, ['verify'],
      ),
    }
  : (await crypto.subtle.generateKey(
      { name: 'ECDSA', namedCurve: 'P-384' },
      true,
      ['sign', 'verify'],
    )) as CryptoKeyPair;
const serializer = new AutomergeJSONSerializer();

const store = createStore(
  collabswarmReducer(
    userKeyPair.privateKey,
    userKeyPair.publicKey,
    new AutomergeProvider(),
    serializer,
    serializer,
    serializer,
    new SubtleCrypto(),
    new AutomergeACLProvider(),
    new AutomergeKeychainProvider(),
  ),
  applyMiddleware(thunk, logger),
);

// Deliberately test-only: Playwright uses this narrow bridge to exercise the
// real Redux -> Swarmbase -> Automerge path without coupling assertions to
// jsoneditor's implementation details.
if (injectedIdentity) {
  window.__SWARMBASE_TEST__ = {
    open: (path) => store.dispatch<any>(openDocumentAsync(path)),
    openWithDocumentKey: async (path, saved) => {
      const node = store.getState().node;
      const documentRef = node?.doc(path);
      if (!documentRef) throw new Error('Swarmbase node is not ready');
      const key = await crypto.subtle.importKey(
        'jwk', saved.key, { name: 'AES-GCM', length: 256 }, true,
        ['encrypt', 'decrypt'],
      );
      await (documentRef as any)._keychain.addEpochKey(
        new Uint8Array(saved.id), key,
      );
      documentRef.subscribe(
        path,
        (document) => store.dispatch(syncDocument(path, document)),
        'remote',
      );
      let loaded = await documentRef.open();
      // Circuit-relay reservations and streams can be renewed while the two
      // peers connect. Do not let a transient closed stream turn this test
      // into a false-positive "new document" on the restoring computer.
      for (let attempt = 0; !loaded && attempt < 10; attempt++) {
        await new Promise((resolve) => setTimeout(resolve, 500));
        loaded = await documentRef.load();
      }
      if (!loaded) {
        throw new Error(`No peer served the existing document: ${path}`);
      }
      store.dispatch(openDocument(path, documentRef));
      return documentRef;
    },
    exportDocumentKey: async (path) => {
      const documentRef = store.getState().documents[path]?.documentRef;
      if (!documentRef) throw new Error(`Document is not open: ${path}`);
      const [id, key] = await (documentRef as any)._keychain.current();
      return {
        id: Array.from(id as Uint8Array),
        key: await crypto.subtle.exportKey('jwk', key as CryptoKey),
      };
    },
    connect: (addresses) => store.dispatch<any>(connectAsync(addresses)),
    addresses: () => {
      try {
        return store.getState().node?.libp2p.getMultiaddrs().map(
          (address: { toString(): string }) => address.toString(),
        ) ?? [];
      } catch {
        return [];
      }
    },
    circuitAddress: () => {
      try {
        const relay = import.meta.env.VITE_RELAY_MULTIADDR;
        const peerId = store.getState().node?.libp2p.peerId.toString();
        return relay && peerId
          ? `${relay}/p2p-circuit/p2p/${peerId}`
          : undefined;
      } catch {
        return undefined;
      }
    },
    change: (path, key, value) =>
      store.dispatch<any>(
        changeDocumentAsync(path, (doc: Record<string, unknown>) => {
          doc[key] = value;
        }),
      ),
    state: () => store.getState() as AutomergeSwarmState<any>,
  };
}

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error('Missing #root element');
}

createRoot(rootElement).render(
  <Provider store={store}>
    <React.StrictMode>
      <App />
    </React.StrictMode>
  </Provider>,
);
