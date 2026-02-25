import { describe, expect, test, jest, beforeEach, afterEach } from '@jest/globals';
import {
  initialize,
  connect,
  openDocument,
  closeDocument,
  syncDocument,
  changeDocument,
  peerConnect,
  peerDisconnect,
  INITIALIZE,
  CONNECT,
  OPEN_DOCUMENT,
  CLOSE_DOCUMENT,
  SYNC_DOCUMENT,
  CHANGE_DOCUMENT,
  PEER_CONNECT,
  PEER_DISCONNECT,
} from './actions';
import { collabswarmReducer, CollabswarmState } from './reducers';

// Mock state with `as any` casts since the reducer only stores references.
function createMockState(): CollabswarmState<any, any, any, any, any, any> {
  return {
    node: {} as any,
    documents: {},
    peers: [],
  };
}

// Create reducer by calling the higher-order function with mock params.
function createReducer() {
  return collabswarmReducer(
    {} as any, // privateKey
    {} as any, // publicKey
    {} as any, // provider
    {} as any, // changesSerializer
    {} as any, // syncMessageSerializer
    {} as any, // loadMessageSerializer
    {} as any, // authProvider
    {} as any, // aclProvider
    {} as any, // keychainProvider
  );
}

describe('action creators', () => {
  test('initialize returns correct action', () => {
    const mockNode = { id: 'node-1' } as any;
    const action = initialize(mockNode);
    expect(action).toEqual({ type: INITIALIZE, node: mockNode });
  });

  test('connect returns correct action', () => {
    const addresses = ['/ip4/127.0.0.1/tcp/4001'];
    const action = connect(addresses);
    expect(action).toEqual({ type: CONNECT, addresses });
  });

  test('openDocument returns correct action', () => {
    const docRef = { document: { text: 'hello' } } as any;
    const action = openDocument('doc-1', docRef);
    expect(action).toEqual({
      type: OPEN_DOCUMENT,
      documentId: 'doc-1',
      documentRef: docRef,
    });
  });

  test('closeDocument returns correct action', () => {
    const action = closeDocument('doc-1');
    expect(action).toEqual({ type: CLOSE_DOCUMENT, documentId: 'doc-1' });
  });

  test('syncDocument returns correct action', () => {
    const doc = { text: 'synced' };
    const action = syncDocument('doc-1', doc);
    expect(action).toEqual({
      type: SYNC_DOCUMENT,
      documentId: 'doc-1',
      document: doc,
    });
  });

  test('changeDocument returns correct action', () => {
    const doc = { text: 'changed' };
    const action = changeDocument('doc-1', doc);
    expect(action).toEqual({
      type: CHANGE_DOCUMENT,
      documentId: 'doc-1',
      document: doc,
    });
  });

  test('peerConnect returns correct action', () => {
    const action = peerConnect('/ip4/192.168.1.1/tcp/4001');
    expect(action).toEqual({
      type: PEER_CONNECT,
      peerAddress: '/ip4/192.168.1.1/tcp/4001',
    });
  });

  test('peerDisconnect returns correct action', () => {
    const action = peerDisconnect('/ip4/192.168.1.1/tcp/4001');
    expect(action).toEqual({
      type: PEER_DISCONNECT,
      peerAddress: '/ip4/192.168.1.1/tcp/4001',
    });
  });
});

describe('collabswarmReducer', () => {
  let reducer: ReturnType<typeof createReducer>;

  beforeEach(() => {
    reducer = createReducer();
    jest.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('INITIALIZE returns new state reference', () => {
    const state = createMockState();
    const mockNode = { id: 'node-1' } as any;
    const newState = reducer(state, initialize(mockNode));
    expect(newState).not.toBe(state);
    expect(newState).toEqual(state);
  });

  test('CONNECT returns new state reference', () => {
    const state = createMockState();
    const newState = reducer(state, connect(['/ip4/127.0.0.1/tcp/4001']));
    expect(newState).not.toBe(state);
    expect(newState).toEqual(state);
  });

  test('OPEN_DOCUMENT adds document to state', () => {
    const state = createMockState();
    const docRef = { document: { text: 'hello' } } as any;
    const newState = reducer(state, openDocument('doc-1', docRef));
    expect(newState).not.toBe(state);
    expect(newState.documents['doc-1']).toEqual({
      documentRef: docRef,
      document: docRef.document,
    });
  });

  test('CLOSE_DOCUMENT removes document from state', () => {
    const docRef = { document: { text: 'hello' } } as any;
    const state: CollabswarmState<any, any, any, any, any, any> = {
      ...createMockState(),
      documents: {
        'doc-1': { documentRef: docRef, document: docRef.document },
      },
    };
    const newState = reducer(state, closeDocument('doc-1'));
    expect(newState).not.toBe(state);
    expect(newState.documents['doc-1']).toBeUndefined();
  });

  test('CLOSE_DOCUMENT of non-existent doc returns same state', () => {
    const state = createMockState();
    const newState = reducer(state, closeDocument('nonexistent'));
    expect(newState).toBe(state);
  });

  test('SYNC_DOCUMENT updates document data', () => {
    const docRef = { document: { text: 'old' } } as any;
    const state: CollabswarmState<any, any, any, any, any, any> = {
      ...createMockState(),
      documents: {
        'doc-1': { documentRef: docRef, document: docRef.document },
      },
    };
    const updatedDoc = { text: 'synced' };
    const newState = reducer(state, syncDocument('doc-1', updatedDoc));
    expect(newState).not.toBe(state);
    expect(newState.documents['doc-1'].document).toEqual(updatedDoc);
    expect(newState.documents['doc-1'].documentRef).toBe(docRef);
  });

  test('SYNC_DOCUMENT of non-existent doc returns same state', () => {
    const state = createMockState();
    const newState = reducer(
      state,
      syncDocument('nonexistent', { text: 'data' }),
    );
    expect(newState).toBe(state);
  });

  test('CHANGE_DOCUMENT updates document data', () => {
    const docRef = { document: { text: 'old' } } as any;
    const state: CollabswarmState<any, any, any, any, any, any> = {
      ...createMockState(),
      documents: {
        'doc-1': { documentRef: docRef, document: docRef.document },
      },
    };
    const updatedDoc = { text: 'changed' };
    const newState = reducer(state, changeDocument('doc-1', updatedDoc));
    expect(newState).not.toBe(state);
    expect(newState.documents['doc-1'].document).toEqual(updatedDoc);
    expect(newState.documents['doc-1'].documentRef).toBe(docRef);
  });

  test('CHANGE_DOCUMENT of non-existent doc returns same state', () => {
    const state = createMockState();
    const newState = reducer(
      state,
      changeDocument('nonexistent', { text: 'data' }),
    );
    expect(newState).toBe(state);
  });

  test('PEER_CONNECT adds peer to state', () => {
    const state = createMockState();
    const newState = reducer(
      state,
      peerConnect('/ip4/192.168.1.1/tcp/4001'),
    );
    expect(newState).not.toBe(state);
    expect(newState.peers).toEqual(['/ip4/192.168.1.1/tcp/4001']);
  });

  test('PEER_CONNECT with duplicate peer returns same state', () => {
    const state: CollabswarmState<any, any, any, any, any, any> = {
      ...createMockState(),
      peers: ['/ip4/192.168.1.1/tcp/4001'],
    };
    const newState = reducer(
      state,
      peerConnect('/ip4/192.168.1.1/tcp/4001'),
    );
    expect(newState).toBe(state);
  });

  test('PEER_DISCONNECT removes peer from state', () => {
    const state: CollabswarmState<any, any, any, any, any, any> = {
      ...createMockState(),
      peers: ['/ip4/192.168.1.1/tcp/4001', '/ip4/192.168.1.2/tcp/4001'],
    };
    const newState = reducer(
      state,
      peerDisconnect('/ip4/192.168.1.1/tcp/4001'),
    );
    expect(newState).not.toBe(state);
    expect(newState.peers).toEqual(['/ip4/192.168.1.2/tcp/4001']);
  });

  test('PEER_DISCONNECT of unknown peer returns same state', () => {
    const state: CollabswarmState<any, any, any, any, any, any> = {
      ...createMockState(),
      peers: ['/ip4/192.168.1.1/tcp/4001'],
    };
    const newState = reducer(
      state,
      peerDisconnect('/ip4/10.0.0.1/tcp/4001'),
    );
    expect(newState).toBe(state);
  });

  test('unknown action returns same state', () => {
    const state = createMockState();
    const newState = reducer(state, { type: 'UNKNOWN_ACTION' } as any);
    expect(newState).toBe(state);
  });
});
