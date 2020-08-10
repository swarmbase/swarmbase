import { Action } from "redux";
import { ThunkAction } from "redux-thunk";
import { AutomergeSwarmState } from "./reducers";
import { Doc } from "automerge";
import { AutomergeSwarmDocument, AutomergeSwarm, AutomergeSwarmConfig } from "@robotoer/collabswarm-automerge";
export declare function initializeAsync<T = any, S = AutomergeSwarmState<any>>(config?: AutomergeSwarmConfig, selectAutomergeSwarmState?: (rootState: S) => AutomergeSwarmState<T>): ThunkAction<Promise<AutomergeSwarm>, S, unknown, InitializeAction | PeerConnectAction | PeerDisconnectAction>;
export declare const INITIALIZE = "AUTOMERGE_SWARM_INITIALIZE";
export interface InitializeAction extends Action<typeof INITIALIZE> {
    node: AutomergeSwarm;
}
export declare function initialize(node: AutomergeSwarm): InitializeAction;
export declare function connectAsync<T = any, S = AutomergeSwarmState<any>>(addresses: string[], selectAutomergeSwarmState?: (rootState: S) => AutomergeSwarmState<T>): ThunkAction<Promise<void>, S, unknown, ConnectAction>;
export declare const CONNECT = "AUTOMERGE_SWARM_CONNECT";
export interface ConnectAction extends Action<typeof CONNECT> {
    addresses: string[];
}
export declare function connect(addresses: string[]): ConnectAction;
export declare function openDocumentAsync<T = any, S = AutomergeSwarmState<any>>(documentId: string, selectAutomergeSwarmState?: (rootState: S) => AutomergeSwarmState<T>): ThunkAction<Promise<AutomergeSwarmDocument | null>, S, unknown, OpenDocumentAction | SyncDocumentAction>;
export declare const OPEN_DOCUMENT = "AUTOMERGE_SWARM_OPEN_DOCUMENT";
export interface OpenDocumentAction extends Action<typeof OPEN_DOCUMENT> {
    documentId: string;
    documentRef: AutomergeSwarmDocument;
}
export declare function openDocument(documentId: string, documentRef: AutomergeSwarmDocument): OpenDocumentAction;
export declare function closeDocumentAsync<T = any, S = AutomergeSwarmState<any>>(documentId: string, selectAutomergeSwarmState?: (rootState: S) => AutomergeSwarmState<T>): ThunkAction<Promise<void>, S, unknown, CloseDocumentAction | SyncDocumentAction>;
export declare const CLOSE_DOCUMENT = "AUTOMERGE_SWARM_CLOSE_DOCUMENT";
export interface CloseDocumentAction extends Action<typeof CLOSE_DOCUMENT> {
    documentId: string;
}
export declare function closeDocument(documentId: string): CloseDocumentAction;
export declare const SYNC_DOCUMENT = "AUTOMERGE_SWARM_SYNC_DOCUMENT";
export interface SyncDocumentAction extends Action<typeof SYNC_DOCUMENT> {
    documentId: string;
    document: Doc<any>;
}
export declare function syncDocument(documentId: string, document: Doc<any>): SyncDocumentAction;
export declare function changeDocumentAsync<T = any, S = AutomergeSwarmState<any>>(documentId: string, changeFn: (current: T) => void, message?: string, selectAutomergeSwarmState?: (rootState: S) => AutomergeSwarmState<T>): ThunkAction<Promise<Doc<T>>, S, unknown, ChangeDocumentAction>;
export declare const CHANGE_DOCUMENT = "AUTOMERGE_SWARM_CHANGE_DOCUMENT";
export interface ChangeDocumentAction extends Action<typeof CHANGE_DOCUMENT> {
    documentId: string;
    document: Doc<any>;
}
export declare function changeDocument<T>(documentId: string, document: Doc<T>): ChangeDocumentAction;
export declare const PEER_CONNECT = "AUTOMERGE_SWARM_PEER_CONNECT";
export interface PeerConnectAction extends Action<typeof PEER_CONNECT> {
    peerAddress: string;
}
export declare function peerConnect(peerAddress: string): PeerConnectAction;
export declare const PEER_DISCONNECT = "AUTOMERGE_SWARM_PEER_DISCONNECT";
export interface PeerDisconnectAction extends Action<typeof PEER_DISCONNECT> {
    peerAddress: string;
}
export declare function peerDisconnect(peerAddress: string): PeerDisconnectAction;
export declare type AutomergeSwarmActions = InitializeAction | ConnectAction | OpenDocumentAction | CloseDocumentAction | SyncDocumentAction | ChangeDocumentAction | PeerConnectAction | PeerDisconnectAction;
