import { Doc, Change } from "automerge";
import { AutomergeSwarm } from "./collabswarm-automerge";
import { AutomergeSwarmDocumentChangeHandler } from "./collabswarm-automerge-change-handlers";
import { AutomergeSwarmSyncMessage } from "./collabswarm-automerge-messages";
export declare class AutomergeSwarmDocument<T = any> {
    readonly swarm: AutomergeSwarm;
    readonly documentPath: string;
    private _document;
    get document(): Doc<T>;
    private _hashes;
    private _remoteHandlers;
    private _localHandlers;
    constructor(swarm: AutomergeSwarm, documentPath: string);
    load(): Promise<boolean>;
    pin(): Promise<void>;
    open(): Promise<boolean>;
    close(): Promise<void>;
    getFile(hash: string): Promise<Change[] | null>;
    private _fireRemoteUpdateHandlers;
    private _fireLocalUpdateHandlers;
    sync(message: AutomergeSwarmSyncMessage): Promise<void>;
    subscribe(id: string, handler: AutomergeSwarmDocumentChangeHandler, originFilter?: 'all' | 'remote' | 'local'): void;
    unsubscribe(id: string): void;
    change(changeFn: (doc: T) => void, message?: string): Promise<void>;
}
