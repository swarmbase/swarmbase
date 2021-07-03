import {
  CollabswarmActions,
  CONNECT,
  OPEN_DOCUMENT,
  SYNC_DOCUMENT,
  CHANGE_DOCUMENT,
  INITIALIZE,
  CLOSE_DOCUMENT,
  PEER_CONNECT,
  PEER_DISCONNECT,
} from './actions';
import {
  ACLProvider,
  AuthProvider,
  ChangesSerializer,
  Collabswarm,
  CollabswarmDocument,
  CRDTProvider,
  CRDTSyncMessage,
  KeychainProvider,
  MessageSerializer,
} from '@collabswarm/collabswarm';

// user id should be the same as peer id.

export interface CollabswarmDocumentState<
  DocType,
  ChangesType,
  ChangeFnType,
  PrivateKey,
  PublicKey,
  DocumentKey
> {
  documentRef: CollabswarmDocument<
    DocType,
    ChangesType,
    ChangeFnType,
    PrivateKey,
    PublicKey,
    DocumentKey
  >;
  document: DocType;

  // TODO: Add peers list.
}

export interface CollabswarmState<
  DocType,
  ChangesType,
  ChangeFnType,
  PrivateKey,
  PublicKey,
  DocumentKey
> {
  node: Collabswarm<
    DocType,
    ChangesType,
    ChangeFnType,
    PrivateKey,
    PublicKey,
    DocumentKey
  >;
  documents: {
    [documentPath: string]: CollabswarmDocumentState<
      DocType,
      ChangesType,
      ChangeFnType,
      PrivateKey,
      PublicKey,
      DocumentKey
    >;
  };
  peers: string[];
}

export function initialState<
  DocType,
  ChangesType,
  ChangeFnType,
  PrivateKey,
  PublicKey,
  DocumentKey
>(
  provider: CRDTProvider<DocType, ChangesType, ChangeFnType>,
  changesSerializer: ChangesSerializer<ChangesType>,
  messageSerializer: MessageSerializer<ChangesType>,
  authProvider: AuthProvider<PrivateKey, PublicKey, DocumentKey>,
  aclProvider: ACLProvider<ChangesType, PublicKey>,
  keychainProvider: KeychainProvider<ChangesType, DocumentKey>,
): CollabswarmState<
  DocType,
  ChangesType,
  ChangeFnType,
  PrivateKey,
  PublicKey,
  DocumentKey
> {
  return {
    node: new Collabswarm(
      provider,
      changesSerializer,
      messageSerializer,
      authProvider,
      aclProvider,
      keychainProvider,
    ),
    documents: {},
    peers: [],
  };
}

// export function automergeSwarmReducer<T>(state: AutomergeSwarmState<T> = initialState, action: AutomergeSwarmActions): AutomergeSwarmState<T> {
export function collabswarmReducer<
  DocType,
  ChangesType,
  ChangeFnType,
  PrivateKey,
  PublicKey,
  DocumentKey
>(
  provider: CRDTProvider<DocType, ChangesType, ChangeFnType>,
  changesSerializer: ChangesSerializer<ChangesType>,
  messageSerializer: MessageSerializer<ChangesType>,
  authProvider: AuthProvider<PrivateKey, PublicKey, DocumentKey>,
  aclProvider: ACLProvider<ChangesType, PublicKey>,
  keychainProvider: KeychainProvider<ChangesType, DocumentKey>,
) {
  return (
    state: CollabswarmState<
      DocType,
      ChangesType,
      ChangeFnType,
      PrivateKey,
      PublicKey,
      DocumentKey
    > = initialState(
      provider,
      changesSerializer,
      messageSerializer,
      authProvider,
      aclProvider,
      keychainProvider,
    ),
    action: CollabswarmActions<
      DocType,
      ChangesType,
      ChangeFnType,
      PrivateKey,
      PublicKey,
      DocumentKey
    >,
  ): CollabswarmState<
    DocType,
    ChangesType,
    ChangeFnType,
    PrivateKey,
    PublicKey,
    DocumentKey
  > => {
    switch (action.type) {
      // Initialization
      case INITIALIZE: {
        // Changes happen within the node, force a change to redux by creating a new object.
        return {
          ...state,
        };
      }
      // Connection
      case CONNECT: {
        // Changes happen within the node, force a change to redux by creating a new object.
        return {
          ...state,
        };
      }
      // Open Document (two options: 1. Overwrite the "current" document, 2. ???)
      case OPEN_DOCUMENT: {
        if (state.documents[action.documentId]) {
          console.warn('Overwriting already open document:', action.documentId);
          console.warn('Action:', action);
          console.warn('State:', state);
        }

        const documents = { ...state.documents };
        documents[action.documentId] = {
          documentRef: action.documentRef,
          document: action.documentRef.document,
        };

        return {
          ...state,
          documents,
        };
      }
      case CLOSE_DOCUMENT: {
        if (!state.documents[action.documentId]) {
          console.warn(
            'Trying to close a document that is not currently open:',
            action.documentId,
          );
          console.warn('Action:', action);
          console.warn('State:', state);
          return state;
        }

        const documents = { ...state.documents };
        delete documents[action.documentId];

        return {
          ...state,
          documents,
        };
      }
      // Document Sync
      case CHANGE_DOCUMENT:
      case SYNC_DOCUMENT: {
        if (!state.documents[action.documentId]) {
          console.warn(
            'Trying to sync document that is not open',
            action,
            state,
          );
          return state;
        }
        const documents = { ...state.documents };
        const documentState = { ...documents[action.documentId] };
        documentState.document = action.document;
        documents[action.documentId] = documentState;
        return {
          ...state,
          documents,
        };
      }
      case PEER_CONNECT: {
        const currentPeers = new Set(state.peers);
        if (currentPeers.has(action.peerAddress)) {
          return state;
        }
        currentPeers.add(action.peerAddress);
        const peers = [...currentPeers];
        return {
          ...state,
          peers,
        };
      }
      case PEER_DISCONNECT: {
        const peers = state.peers.filter((addr) => addr !== action.peerAddress);
        if (state.peers.length === peers.length) {
          return state;
        }
        return {
          ...state,
          peers,
        };
      }
      default: {
        console.warn('Unrecognized action:', action);
        console.warn('Unrecognized action (state):', state);
        return state;
      }
    }
  };
}
