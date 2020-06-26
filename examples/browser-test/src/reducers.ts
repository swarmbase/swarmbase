import { Doc } from "automerge";
import { AutomergeSwarm } from "automerge-db";
import { AutomergeSwarmDocument } from "automerge-db";
import { AllActions, CONNECT, OPEN_DOCUMENT, SYNC_DOCUMENT, CHANGE_DOCUMENT } from "./actions";

export interface AnnouncementDocument {
  announcement: string;
}

// user id should be the same as peer id.
export interface RootState {
  node: AutomergeSwarm;

  documentId?: string;
  documentRef?: AutomergeSwarmDocument;
  document?: Doc<AnnouncementDocument>;
}

export const initialState: RootState = {
  node: new AutomergeSwarm()
};

export function rootReducer(state: RootState = initialState, action: AllActions): RootState {
  switch (action.type) {
    // Connection
    case CONNECT: {
      return state;
    }
    // Open Document (two options: 1. Overwrite the "current" document, 2. ???)
    case OPEN_DOCUMENT: {
      return {
        ...state,

        documentId: action.documentId,
        documentRef: action.documentRef,
      };
    }
    // Document Sync
    case SYNC_DOCUMENT: {
      if (action.documentId !== state.documentId) {
        console.warn('Trying to sync document that is not open', action, state);
        return state;
      }
      return {
        ...state,

        document: action.document,
      };
    }
    // Change Document
    case CHANGE_DOCUMENT: {
      if (action.documentId !== state.documentId) {
        console.warn('Trying to sync document that is not open', action, state);
        return state;
      }
      return {
        ...state,

        document: action.document,
      };
    }
    default: {
      console.warn('Unrecognized action:', action);
      console.warn('Unrecognized action (state):', state);
      return state;
    }
  }
}
