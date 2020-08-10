import { AutomergeSwarmDocument } from "./collabswarm-automerge-document";
import { AutomergeSwarmConfig } from "./collabswarm-automerge-config";
export declare type AutomergeSwarmPeersHandler = (address: string, connection: any) => void;
export declare class AutomergeSwarm {
    protected _config: AutomergeSwarmConfig | null;
    private _ipfsNode;
    private _ipfsInfo;
    private _peerAddrs;
    private _peerConnectHandlers;
    private _peerDisconnectHandlers;
    get ipfsNode(): any;
    get ipfsInfo(): any;
    get peerAddrs(): string[];
    get config(): AutomergeSwarmConfig | null;
    initialize(config?: AutomergeSwarmConfig): Promise<void>;
    connect(addresses: string[]): Promise<void>;
    doc<T = any>(documentPath: string): AutomergeSwarmDocument<T> | null;
    subscribeToPeerConnect(handlerId: string, handler: AutomergeSwarmPeersHandler): void;
    unsubscribeFromPeerConnect(handlerId: string): void;
    subscribeToPeerDisconnect(handlerId: string, handler: AutomergeSwarmPeersHandler): void;
    unsubscribeFromPeerDisconnect(handlerId: string): void;
}
