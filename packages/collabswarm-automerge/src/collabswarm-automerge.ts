import {
  Doc,
  Change,
  init,
  change,
  getChanges,
  applyChanges,
  BinaryChange,
  getAllChanges,
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

// export type AutomergeSwarm<T = any> = Collabswarm<
//   Doc<T>,
//   BinaryChange[],
//   (doc: T) => void,
//   AutomergeSwarmSyncMessage
// >;

// export type AutomergeSwarmDocument<T = any> = CollabswarmDocument<
//   Doc<T>,
//   BinaryChange[],
//   (doc: T) => void,
//   AutomergeSwarmSyncMessage
// >;

export class AutomergeProvider<T = any>
  implements
  CRDTProvider<
  Doc<T>,
  BinaryChange[],
  (doc: T) => void
  > {
  newDocument(): Doc<T> {
    return init();
  }
  localChange(
    document: Doc<T>,
    message: string,
    changeFn: (doc: T) => void
  ): [Doc<T>, BinaryChange[]] {
    const newDocument = message
      ? change(document, message, changeFn)
      : change(document, changeFn);
    const changes = getChanges(document, newDocument);
    return [newDocument, changes];
  }
  remoteChange(document: Doc<T>, changes: BinaryChange[]): Doc<T> {
    const [newDoc, patch] = applyChanges(document, changes);
    return newDoc;
  }
  getHistory(document: Doc<T>): BinaryChange[] {
    return getAllChanges(document);
  }
}

export class AutomergeJSONSerializer extends JSONSerializer<BinaryChange[]> { }
