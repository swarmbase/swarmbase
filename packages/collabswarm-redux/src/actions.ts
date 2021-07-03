import { Action } from 'redux';
import { ThunkAction } from 'redux-thunk';
import { CollabswarmState } from './reducers';
import {
  Collabswarm,
  CollabswarmDocument,
  CollabswarmConfig,
  DEFAULT_CONFIG,
} from '@collabswarm/collabswarm';

// TODO: Add an optional trace option that records the async call-site in the action for debugging purposes.

export function initializeAsync<
  DocType,
  ChangesType,
  ChangeFnType,
  PrivateKey,
  PublicKey,
  DocumentKey,
  RootStateType = CollabswarmState<
    DocType,
    ChangesType,
    ChangeFnType,
    PrivateKey,
    PublicKey,
    DocumentKey
  >
>(
  config: CollabswarmConfig = DEFAULT_CONFIG,
  selectCollabswarmState: (
    rootState: RootStateType,
  ) => CollabswarmState<
    DocType,
    ChangesType,
    ChangeFnType,
    PrivateKey,
    PublicKey,
    DocumentKey
  > = (s) => s as any,
): ThunkAction<
  Promise<
    Collabswarm<
      DocType,
      ChangesType,
      ChangeFnType,
      PrivateKey,
      PublicKey,
      DocumentKey
    >
  >,
  RootStateType,
  unknown,
  | InitializeAction<
      DocType,
      ChangesType,
      ChangeFnType,
      PrivateKey,
      PublicKey,
      DocumentKey
    >
  | PeerConnectAction
  | PeerDisconnectAction
> {
  return async (dispatch, getState) => {
    const { node } = selectCollabswarmState(getState());
    node.subscribeToPeerConnect('peer-connect', (address: string) => {
      dispatch(peerConnect(address));
    });
    node.subscribeToPeerDisconnect('peer-disconnect', (address: string) => {
      dispatch(peerDisconnect(address));
    });
    await node.initialize(config);
    dispatch(initialize(node));
    console.log('Node information:', node);
    return node;
  };
}

export const INITIALIZE = 'COLLABSWARM_INITIALIZE';
export interface InitializeAction<
  DocType,
  ChangesType,
  ChangeFnType,
  PrivateKey,
  PublicKey,
  DocumentKey
> extends Action<typeof INITIALIZE> {
  node: Collabswarm<
    DocType,
    ChangesType,
    ChangeFnType,
    PrivateKey,
    PublicKey,
    DocumentKey
  >;
}
export function initialize<
  DocType,
  ChangesType,
  ChangeFnType,
  PrivateKey,
  PublicKey,
  DocumentKey
>(
  node: Collabswarm<
    DocType,
    ChangesType,
    ChangeFnType,
    PrivateKey,
    PublicKey,
    DocumentKey
  >,
): InitializeAction<
  DocType,
  ChangesType,
  ChangeFnType,
  PrivateKey,
  PublicKey,
  DocumentKey
> {
  return { type: INITIALIZE, node };
}

export function connectAsync<
  DocType,
  ChangesType,
  ChangeFnType,
  PrivateKey,
  PublicKey,
  DocumentKey,
  RootStateType = CollabswarmState<
    DocType,
    ChangesType,
    ChangeFnType,
    PrivateKey,
    PublicKey,
    DocumentKey
  >
>(
  addresses: string[],
  selectCollabswarmState: (
    rootState: RootStateType,
  ) => CollabswarmState<
    DocType,
    ChangesType,
    ChangeFnType,
    PrivateKey,
    PublicKey,
    DocumentKey
  > = (s) => s as any,
): ThunkAction<Promise<void>, RootStateType, unknown, ConnectAction> {
  return async (dispatch, getState) => {
    const { node } = selectCollabswarmState(getState());
    if (!node) {
      console.warn(
        'Node not initialized yet! Unable to connect to:',
        addresses,
      );
      return;
    }
    await node.connect(addresses);
    dispatch(connect(addresses));
    console.log('Node information:', node);
    console.log('Connected to:', addresses);
  };
}

export const CONNECT = 'COLLABSWARM_CONNECT';
export interface ConnectAction extends Action<typeof CONNECT> {
  addresses: string[];
}
export function connect(addresses: string[]): ConnectAction {
  return { type: CONNECT, addresses };
}

export function openDocumentAsync<
  DocType,
  ChangesType,
  ChangeFnType,
  PrivateKey,
  PublicKey,
  DocumentKey,
  RootStateType = CollabswarmState<
    DocType,
    ChangesType,
    ChangeFnType,
    PrivateKey,
    PublicKey,
    DocumentKey
  >
>(
  documentId: string,
  selectCollabswarmState: (
    rootState: RootStateType,
  ) => CollabswarmState<
    DocType,
    ChangesType,
    ChangeFnType,
    PrivateKey,
    PublicKey,
    DocumentKey
  > = (s) => s as any,
): ThunkAction<
  Promise<CollabswarmDocument<
    DocType,
    ChangesType,
    ChangeFnType,
    PrivateKey,
    PublicKey,
    DocumentKey
  > | null>,
  RootStateType,
  unknown,
  | OpenDocumentAction<
      DocType,
      ChangesType,
      ChangeFnType,
      PrivateKey,
      PublicKey,
      DocumentKey
    >
  | SyncDocumentAction<DocType>
> {
  return async (dispatch, getState) => {
    const { node } = selectCollabswarmState(getState());
    if (!node) {
      console.warn(
        'Node not initialized yet! Unable to open document:',
        documentId,
      );
      return null;
    }
    const documentRef = node.doc(documentId);
    // TODO: Close previous document (if any).
    if (documentRef) {
      documentRef.subscribe(
        documentId,
        (document) => {
          dispatch(syncDocument(documentId, document));
        },
        'remote',
      );
      const loaded = await documentRef.open();
      if (!loaded) {
        // Assume this is a new document.
        console.log(
          'Failed to load document from peers, assuming this is a new document...',
          documentRef,
        );
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

export const OPEN_DOCUMENT = 'COLLABSWARM_OPEN_DOCUMENT';
export interface OpenDocumentAction<
  DocType,
  ChangesType,
  ChangeFnType,
  PrivateKey,
  PublicKey,
  DocumentKey
> extends Action<typeof OPEN_DOCUMENT> {
  documentId: string;
  documentRef: CollabswarmDocument<
    DocType,
    ChangesType,
    ChangeFnType,
    PrivateKey,
    PublicKey,
    DocumentKey
  >;
}
export function openDocument<
  DocType,
  ChangesType,
  ChangeFnType,
  PrivateKey,
  PublicKey,
  DocumentKey
>(
  documentId: string,
  documentRef: CollabswarmDocument<
    DocType,
    ChangesType,
    ChangeFnType,
    PrivateKey,
    PublicKey,
    DocumentKey
  >,
): OpenDocumentAction<
  DocType,
  ChangesType,
  ChangeFnType,
  PrivateKey,
  PublicKey,
  DocumentKey
> {
  return { type: OPEN_DOCUMENT, documentId, documentRef };
}

export function closeDocumentAsync<
  DocType,
  ChangesType,
  ChangeFnType,
  PrivateKey,
  PublicKey,
  DocumentKey,
  RootStateType = CollabswarmState<
    DocType,
    ChangesType,
    ChangeFnType,
    PrivateKey,
    PublicKey,
    DocumentKey
  >
>(
  documentId: string,
  selectCollabswarmState: (
    rootState: RootStateType,
  ) => CollabswarmState<
    DocType,
    ChangesType,
    ChangeFnType,
    PrivateKey,
    PublicKey,
    DocumentKey
  > = (s) => s as any,
): ThunkAction<
  Promise<void>,
  RootStateType,
  unknown,
  CloseDocumentAction | SyncDocumentAction<DocType>
> {
  return async (dispatch, getState) => {
    const { documents } = selectCollabswarmState(getState());
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

export const CLOSE_DOCUMENT = 'COLLABSWARM_CLOSE_DOCUMENT';
export interface CloseDocumentAction extends Action<typeof CLOSE_DOCUMENT> {
  documentId: string;
}
export function closeDocument(documentId: string): CloseDocumentAction {
  return { type: CLOSE_DOCUMENT, documentId };
}

export const SYNC_DOCUMENT = 'COLLABSWARM_SYNC_DOCUMENT';
export interface SyncDocumentAction<DocType>
  extends Action<typeof SYNC_DOCUMENT> {
  documentId: string;
  document: DocType;
}
export function syncDocument<DocType>(
  documentId: string,
  document: DocType,
): SyncDocumentAction<DocType> {
  return { type: SYNC_DOCUMENT, documentId, document };
}

export function changeDocumentAsync<
  DocType,
  ChangesType,
  ChangeFnType,
  PrivateKey,
  PublicKey,
  DocumentKey,
  RootStateType = CollabswarmState<
    DocType,
    ChangesType,
    ChangeFnType,
    PrivateKey,
    PublicKey,
    DocumentKey
  >
>(
  documentId: string,
  changeFn: ChangeFnType,
  message?: string,
  selectCollabswarmState: (
    rootState: RootStateType,
  ) => CollabswarmState<
    DocType,
    ChangesType,
    ChangeFnType,
    PrivateKey,
    PublicKey,
    DocumentKey
  > = (s) => s as any,
): ThunkAction<
  Promise<DocType>,
  RootStateType,
  unknown,
  ChangeDocumentAction<DocType>
> {
  return async (dispatch, getState) => {
    const { documents } = selectCollabswarmState(getState());
    if (documents[documentId] && documents[documentId].documentRef) {
      const documentRef = documents[documentId].documentRef;
      const changePromise = documentRef.change(changeFn, message);
      dispatch(changeDocument(documentId, documentRef.document));
      await changePromise;
      return documentRef.document;
    } else {
      throw new Error(
        `Trying to edit a document that is not opened: ${documentId}`,
      );
    }
  };
}

export const CHANGE_DOCUMENT = 'COLLABSWARM_CHANGE_DOCUMENT';
export interface ChangeDocumentAction<DocType>
  extends Action<typeof CHANGE_DOCUMENT> {
  documentId: string;
  document: DocType;
}
export function changeDocument<DocType>(
  documentId: string,
  document: DocType,
): ChangeDocumentAction<DocType> {
  return { type: CHANGE_DOCUMENT, documentId, document };
}

export const PEER_CONNECT = 'COLLABSWARM_PEER_CONNECT';
export interface PeerConnectAction extends Action<typeof PEER_CONNECT> {
  peerAddress: string;
}
export function peerConnect(peerAddress: string): PeerConnectAction {
  return { type: PEER_CONNECT, peerAddress };
}

export const PEER_DISCONNECT = 'COLLABSWARM_PEER_DISCONNECT';
export interface PeerDisconnectAction extends Action<typeof PEER_DISCONNECT> {
  peerAddress: string;
}
export function peerDisconnect(peerAddress: string): PeerDisconnectAction {
  return { type: PEER_DISCONNECT, peerAddress };
}

export type CollabswarmActions<
  DocType,
  ChangesType,
  ChangeFnType,
  PrivateKey,
  PublicKey,
  DocumentKey
> =
  | InitializeAction<
      DocType,
      ChangesType,
      ChangeFnType,
      PrivateKey,
      PublicKey,
      DocumentKey
    >
  | ConnectAction
  | OpenDocumentAction<
      DocType,
      ChangesType,
      ChangeFnType,
      PrivateKey,
      PublicKey,
      DocumentKey
    >
  | CloseDocumentAction
  | SyncDocumentAction<DocType>
  | ChangeDocumentAction<DocType>
  | PeerConnectAction
  | PeerDisconnectAction;
