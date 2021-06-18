import {
  Doc,
  Change,
  init,
  change,
  getChanges,
  applyChanges,
  getHistory,
} from "automerge";

import {
  Collabswarm,
  CollabswarmDocument,
  CollabswarmDocumentChangeHandler,
  CRDTProvider,
  CRDTSyncMessage,
  JSONSerializer,
} from "@collabswarm/collabswarm";

export type AutomergeSwarmDocumentChangeHandler<
  T = any
> = CollabswarmDocumentChangeHandler<Doc<T>>;

export type AutomergeSwarm<T = any> = Collabswarm<
  Doc<T>,
  Change[],
  (doc: T) => void,
  AutomergeSwarmSyncMessage
>;

export type AutomergeSwarmDocument<T = any> = CollabswarmDocument<
  Doc<T>,
  Change[],
  (doc: T) => void,
  AutomergeSwarmSyncMessage
>;

export interface AutomergeSwarmSyncMessage extends CRDTSyncMessage<Change[]> {}

export class AutomergeProvider<T = any>
  implements
    CRDTProvider<
      Doc<T>,
      Change[],
      (doc: T) => void,
      AutomergeSwarmSyncMessage
    > {
  newDocument(): Doc<T> {
    return init();
  }
  newMessage(documentId: string): AutomergeSwarmSyncMessage {
    return { documentId, changes: {} };
  }
  localChange(
    document: Doc<T>,
    message: string,
    changeFn: (doc: T) => void
  ): [Doc<T>, Change[]] {
    const newDocument = message
      ? change(document, message, changeFn)
      : change(document, changeFn);
    const changes = getChanges(document, newDocument);
    return [newDocument, changes];
  }
  remoteChange(document: Doc<T>, changes: Change[]): Doc<T> {
    return applyChanges(document, changes);
  }
  getHistory(document: Doc<T>): Change[] {
    return getHistory(document).map((state) => state.change);
  }
}

export class AutomergeJSONSerializer extends JSONSerializer<
  Change[],
  AutomergeSwarmSyncMessage
> {}
