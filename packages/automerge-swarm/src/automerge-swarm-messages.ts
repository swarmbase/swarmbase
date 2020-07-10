import { Change } from "automerge";

export interface AutomergeSwarmSyncMessage {
  documentId: string;
  // A null value just means that the change was not sent explicitly.
  changes: { [hash: string]: Change[] | null };
}
