import { Doc } from "automerge";
import { AutomergeSwarm, AutomergeSwarmDocument } from "@robotoer/collabswarm-automerge";
import { AutomergeSwarmActions } from "./actions";
export interface AutomergeSwarmState<T> {
    node: AutomergeSwarm;
    documents: {
        [documentPath: string]: AutomergeSwarmDocumentState<T>;
    };
    peers: string[];
}
export interface AutomergeSwarmDocumentState<T> {
    documentRef: AutomergeSwarmDocument;
    document: Doc<T>;
}
export declare const initialState: AutomergeSwarmState<any>;
export declare function automergeSwarmReducer<T>(state: AutomergeSwarmState<T> | undefined, action: AutomergeSwarmActions): AutomergeSwarmState<T>;
