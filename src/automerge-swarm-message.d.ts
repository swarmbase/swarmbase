import { Change } from "automerge";
export interface AutomergeSwarmSyncMessage {
    changes: {
        [hash: string]: Change[] | null;
    };
}
