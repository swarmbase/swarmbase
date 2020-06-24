import { AutomergeSwarmDocument } from "./automerge-swarm-document";
export declare class AutomergeSwarm {
    private _ipfsNode;
    private _ipfsInfo;
    get ipfsNode(): any;
    get ipfsInfo(): any;
    connect(addresses: string[]): Promise<void>;
    doc<T = any>(documentPath: string): AutomergeSwarmDocument<T> | null;
}
