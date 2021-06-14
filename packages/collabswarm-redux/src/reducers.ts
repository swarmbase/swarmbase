import { CollabswarmActions, CONNECT, OPEN_DOCUMENT, SYNC_DOCUMENT, CHANGE_DOCUMENT, INITIALIZE, CLOSE_DOCUMENT, PEER_CONNECT, PEER_DISCONNECT } from "./actions";
import { ChangesSerializer, Collabswarm, CollabswarmDocument, CRDTProvider, CRDTSyncMessage, MessageSerializer } from "@collabswarm/collabswarm";


// user id should be the same as peer id.

export interface CollabswarmDocumentState<DocType, ChangesType, ChangeFnType, MessageType extends CRDTSyncMessage<ChangesType>> {
  documentRef: CollabswarmDocument<DocType, ChangesType, ChangeFnType, MessageType>
  document: DocType;

  // TODO: Add peers list.
}

export interface CollabswarmState<DocType, ChangesType, ChangeFnType, MessageType extends CRDTSyncMessage<ChangesType>> {
  node: Collabswarm<DocType, ChangesType, ChangeFnType, MessageType>;
  documents: {[documentPath: string]: CollabswarmDocumentState<DocType, ChangesType, ChangeFnType, MessageType>};
  peers: string[];
}

export function initialState<DocType, ChangesType, ChangeFnType, MessageType extends CRDTSyncMessage<ChangesType>>(
  provider: CRDTProvider<DocType, ChangesType, ChangeFnType, MessageType>,
  changesSerializer: ChangesSerializer<ChangesType>,
  messageSerializer: MessageSerializer<MessageType>,
): CollabswarmState<DocType, ChangesType, ChangeFnType, MessageType> {
  return {
    node: new Collabswarm(provider, changesSerializer, messageSerializer),
    documents: {},
    peers: []
  };
}

// export function automergeSwarmReducer<T>(state: AutomergeSwarmState<T> = initialState, action: AutomergeSwarmActions): AutomergeSwarmState<T> {
export function collabswarmReducer<DocType, ChangesType, ChangeFnType, MessageType extends CRDTSyncMessage<ChangesType>>(
  provider: CRDTProvider<DocType, ChangesType, ChangeFnType, MessageType>,
  changesSerializer: ChangesSerializer<ChangesType>,
  messageSerializer: MessageSerializer<MessageType>,
) {
  return (
    state: CollabswarmState<DocType, ChangesType, ChangeFnType, MessageType> = initialState(provider, changesSerializer, messageSerializer),
    action: CollabswarmActions<DocType, ChangesType, ChangeFnType, MessageType>,
  ): CollabswarmState<DocType, ChangesType, ChangeFnType, MessageType> => {
    switch (action.type) {
      // Initialization
      case INITIALIZE: {
        // Changes happen within the node, force a change to redux by creating a new object.
        return {
          ...state
        };
      }
      // Connection
      case CONNECT: {
        // Changes happen within the node, force a change to redux by creating a new object.
        return {
          ...state
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
          document: action.documentRef.document
        }

        return {
          ...state,
          documents
        };
      }
      case CLOSE_DOCUMENT: {
        if (!state.documents[action.documentId]) {
          console.warn('Trying to close a document that is not currently open:', action.documentId);
          console.warn('Action:', action);
          console.warn('State:', state);
          return state;
        }

        const documents = { ...state.documents };
        delete documents[action.documentId];

        return {
          ...state,
          documents
        };
      }
      // Document Sync
      case CHANGE_DOCUMENT:
      case SYNC_DOCUMENT: {
        if (!state.documents[action.documentId]) {
          console.warn('Trying to sync document that is not open', action, state);
          return state;
        }
        const documents = { ...state.documents };
        const documentState = { ...documents[action.documentId] };
        documentState.document = action.document;
        documents[action.documentId] = documentState;
        return {
          ...state,
          documents
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
          peers
        };
      }
      case PEER_DISCONNECT: {
        const peers = state.peers.filter(addr => addr !== action.peerAddress);
        if (state.peers.length === peers.length) {
          return state;
        }
        return {
          ...state,
          peers
        };
      }
      default: {
        console.warn('Unrecognized action:', action);
        console.warn('Unrecognized action (state):', state);
        return state;
      }
    }
  }
}
