import { Change } from "automerge";
export interface AutomergeSwarmSyncMessage {
    documentId: string;
    changes: {
        [hash: string]: Change[] | null;
    };
}
