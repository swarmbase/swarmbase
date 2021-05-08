import { Doc, Change, init, change, getChanges, applyChanges, getHistory } from "automerge";

import { Collabswarm, CollabswarmDocument, CollabswarmDocumentChangeHandler, CRDTProvider, CRDTSyncMessage } from "@collabswarm/collabswarm";

export type AutomergeSwarmDocumentChangeHandler<T = any> = CollabswarmDocumentChangeHandler<Doc<T>>;

export type AutomergeSwarm<T = any> = Collabswarm<Doc<T>, Change[], (doc: T) => void, AutomergeSwarmSyncMessage>;

export type AutomergeSwarmDocument<T = any> = CollabswarmDocument<Doc<T>, Change[], (doc: T) => void, AutomergeSwarmSyncMessage>;

export interface AutomergeSwarmSyncMessage extends CRDTSyncMessage<Change[]> {}

export class AutomergeProvider<T = any> implements CRDTProvider<Doc<T>, Change[], (doc: T) => void, AutomergeSwarmSyncMessage> {
  newDocument(): Doc<T> {
    return init();
  }
  newMessage(documentId: string): AutomergeSwarmSyncMessage {
    return { documentId, changes: { } };
  }
  localChange(document: Doc<T>, message: string, changeFn: (doc: T) => void): [Doc<T>, Change[]] {
    const newDocument = message ? change(document, message, changeFn) : change(document, changeFn);
    const changes = getChanges(document, newDocument);
    return [newDocument, changes];
  }
  remoteChange(document: Doc<T>, changes: Change[]): Doc<T> {
    return applyChanges(document, changes);
  }
  serializeChanges(changes: Change[]): string {
    return JSON.stringify(changes);
  }
  deserializeChanges(changes: string): Change[] {
    return JSON.parse(changes);
  }
  serializeMessage(message: AutomergeSwarmSyncMessage): Uint8Array {
    const encoder = new TextEncoder();
    return encoder.encode(JSON.stringify(message));
  }
  deserializeMessage(message: Uint8Array): AutomergeSwarmSyncMessage {
    const decoder = new TextDecoder();
    const rawMessage = decoder.decode(message);
    try {
      return JSON.parse(rawMessage);
    } catch (err) {
      console.error("Failed to parse message:", rawMessage, message);
      throw err;
    }
  }
  getHistory(document: Doc<T>): Change[] {
    return getHistory(document).map(state => state.change);
  }
}
