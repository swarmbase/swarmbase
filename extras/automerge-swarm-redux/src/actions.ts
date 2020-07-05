import { Action } from "redux";
import { ThunkAction } from "redux-thunk";
import { AutomergeSwarmState } from "./reducers";
import { Doc } from "automerge";
import { AutomergeSwarmDocument } from "automerge-swarm";


// TODO: Add an optional trace option that records the async call-site in the action for debugging purposes.

export function initializeAsync<T>(): ThunkAction<Promise<void>, AutomergeSwarmState<T>, unknown, InitializeAction | PeerConnectAction | PeerDisconnectAction> {
  return async (dispatch, getState) => {
    const { node } = getState();
    node.subscribeToPeerConnect('peer-connect', (address: string) => {
      dispatch(peerConnect(address));
    });
    node.subscribeToPeerDisconnect('peer-disconnect', (address: string) => {
      dispatch(peerDisconnect(address));
    })
    await node.initialize();
    dispatch(initialize());
    console.log('Node information:', node);
  };
}

export const INITIALIZE = 'AUTOMERGE_SWARM_INITIALIZE';
export interface InitializeAction extends Action<typeof INITIALIZE> { }
export function initialize(): InitializeAction {
  return { type: INITIALIZE };
}


export function connectAsync<T>(addresses: string[]): ThunkAction<Promise<void>, AutomergeSwarmState<T>, unknown, ConnectAction> {
  return async (dispatch, getState) => {
    const { node } = getState();
    await node.connect(addresses);
    dispatch(connect(addresses));
    console.log('Node information:', node);
    console.log('Connected to:', addresses);
  };
}

export const CONNECT = 'AUTOMERGE_SWARM_CONNECT';
export interface ConnectAction extends Action<typeof CONNECT> {
  addresses: string[]
}
export function connect(addresses: string[]): ConnectAction {
  return { type: CONNECT, addresses };
}


export function openDocumentAsync<T>(documentId: string): ThunkAction<Promise<AutomergeSwarmDocument | null>, AutomergeSwarmState<T>, unknown, OpenDocumentAction | SyncDocumentAction> {
  return async (dispatch, getState) => {
    const { node } = getState();
    const documentRef = node.doc(documentId);
    // TODO: Close previous document (if any).
    if (documentRef) {
      documentRef.subscribe(documentId, document => {
        dispatch(syncDocument(documentId, document));
      });
      const loaded = await documentRef.open();
      if (!loaded) {
        // Assume this is a new document.
        console.log('Failed to load document from peers, assuming this is a new document...', documentRef);
        await documentRef.pin();
      }
      dispatch(openDocument(documentId, documentRef));
      return documentRef;
    } else {
      console.warn('Unable to find document:', documentId);
      return null;
    }
  };
}

export const OPEN_DOCUMENT = 'AUTOMERGE_SWARM_OPEN_DOCUMENT';
export interface OpenDocumentAction extends Action<typeof OPEN_DOCUMENT> {
  documentId: string;
  documentRef: AutomergeSwarmDocument;
}
export function openDocument(documentId: string, documentRef: AutomergeSwarmDocument): OpenDocumentAction {
  return { type: OPEN_DOCUMENT, documentId, documentRef };
}


export function closeDocumentAsync<T>(documentId: string): ThunkAction<Promise<void>, AutomergeSwarmState<T>, unknown, CloseDocumentAction | SyncDocumentAction> {
  return async (dispatch, getState) => {
    const { documents } = getState();
    if (documents[documentId] && documents[documentId].documentRef) {
      const documentRef = documents[documentId].documentRef;
      documentRef.unsubscribe(documentId);
      await documentRef.close();
      dispatch(closeDocument(documentId));
    } else {
      console.warn('Closing a document that was not opened:', documentId);
    }
  };
}

export const CLOSE_DOCUMENT = 'AUTOMERGE_SWARM_CLOSE_DOCUMENT';
export interface CloseDocumentAction extends Action<typeof CLOSE_DOCUMENT> {
  documentId: string;
}
export function closeDocument(documentId: string): CloseDocumentAction {
  return { type: CLOSE_DOCUMENT, documentId };
}


export const SYNC_DOCUMENT = 'AUTOMERGE_SWARM_SYNC_DOCUMENT';
export interface SyncDocumentAction extends Action<typeof SYNC_DOCUMENT> {
  documentId: string;
  document: Doc<any>;
}
export function syncDocument(documentId: string, document: Doc<any>): SyncDocumentAction {
  return { type: SYNC_DOCUMENT, documentId, document };
}


export function changeDocumentAsync<T>(documentId: string, changeFn: (current: T) => void, message?: string): ThunkAction<Promise<Doc<T>>, AutomergeSwarmState<T>, unknown, ChangeDocumentAction> {
  return async (dispatch, getState) => {
    const { documents } = getState();
    if (documents[documentId] && documents[documentId].documentRef) {
      const documentRef = documents[documentId].documentRef;
      await documentRef.change(changeFn, message);
      dispatch(changeDocument(documentId, documentRef.document));
      return documentRef.document;
    } else {
      throw new Error(`Trying to edit a document that is not opened: ${documentId}`);
    }
  };
}

export const CHANGE_DOCUMENT = 'AUTOMERGE_SWARM_CHANGE_DOCUMENT';
export interface ChangeDocumentAction extends Action<typeof CHANGE_DOCUMENT> {
  documentId: string;
  document: Doc<any>;
}
export function changeDocument<T>(documentId: string, document: Doc<T>): ChangeDocumentAction {
  return { type: CHANGE_DOCUMENT, documentId, document };
}


export const PEER_CONNECT = 'AUTOMERGE_SWARM_PEER_CONNECT';
export interface PeerConnectAction extends Action<typeof PEER_CONNECT> {
  peerAddress: string;
}
export function peerConnect(peerAddress: string): PeerConnectAction {
  return { type: PEER_CONNECT, peerAddress };
}


export const PEER_DISCONNECT = 'AUTOMERGE_SWARM_PEER_DISCONNECT';
export interface PeerDisconnectAction extends Action<typeof PEER_DISCONNECT> {
  peerAddress: string;
}
export function peerDisconnect(peerAddress: string): PeerDisconnectAction {
  return { type: PEER_DISCONNECT, peerAddress };
}


export type AutomergeSwarmActions =
  InitializeAction |
  ConnectAction |
  OpenDocumentAction |
  CloseDocumentAction |
  SyncDocumentAction |
  ChangeDocumentAction |
  PeerConnectAction |
  PeerDisconnectAction;
