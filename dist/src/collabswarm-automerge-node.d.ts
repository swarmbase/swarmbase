import { AutomergeSwarm } from "./collabswarm-automerge";
import { AutomergeSwarmConfig } from "./collabswarm-automerge-config";
export declare const DEFAULT_NODE_CONFIG: AutomergeSwarmConfig;
export declare class AutomergeSwarmNode {
    readonly config: AutomergeSwarmConfig;
    private _swarm;
    get swarm(): AutomergeSwarm;
    private readonly _subscriptions;
    private readonly _seenCids;
    private _docPublishHandler;
    constructor(config?: AutomergeSwarmConfig);
    start(): Promise<void>;
    stop(): void;
}
