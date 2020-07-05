import { Doc } from "automerge";
import { AutomergeSwarm } from "automerge-swarm";
import { AutomergeSwarmDocument } from "automerge-swarm";
import { AutomergeSwarmActions, CONNECT, OPEN_DOCUMENT, SYNC_DOCUMENT, CHANGE_DOCUMENT, INITIALIZE, CLOSE_DOCUMENT } from "./actions";

export interface AnnouncementDocument {
  announcement: string;
}

// user id should be the same as peer id.
export interface AutomergeSwarmState {
  node: AutomergeSwarm;
  documents: {[documentPath: string]: AutomergeSwarmDocumentState};

  // TODO: Add peers list.
}

export interface AutomergeSwarmDocumentState {
  // documentId: string;
  documentRef: AutomergeSwarmDocument;
  document: Doc<AnnouncementDocument>;

  // TODO: Add peers list.
}

export const initialState: AutomergeSwarmState = {
  node: new AutomergeSwarm(),
  documents: {}
};

export function rootReducer(state: AutomergeSwarmState = initialState, action: AutomergeSwarmActions): AutomergeSwarmState {
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
      return {
        ...state,
        documents
      };
    }
    default: {
      console.warn('Unrecognized action:', action);
      console.warn('Unrecognized action (state):', state);
      return state;
    }
  }
}
