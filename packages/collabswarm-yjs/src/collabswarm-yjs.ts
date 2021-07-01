import { Collabswarm, CollabswarmDocument, CollabswarmDocumentChangeHandler, CRDTProvider, CRDTSyncMessage, JSONSerializer } from "@collabswarm/collabswarm";
import { applyUpdateV2, Doc, encodeStateAsUpdateV2 } from "yjs";


export type YjsSwarmDocumentChangeHandler = CollabswarmDocumentChangeHandler<Doc>;

// export type YjsSwarm = Collabswarm<Doc, Uint8Array, (doc: Doc) => void, YjsSwarmSyncMessage>;

// export type YjsSwarmDocument = CollabswarmDocument<Doc, Uint8Array, (doc: Doc) => void, YjsSwarmSyncMessage>;

export class YjsProvider implements CRDTProvider<Doc, Uint8Array, (doc: Doc) => void> {
  newDocument(): Doc {
    return new Doc();
  }
  localChange(document: Doc, message: string, changeFn: (doc: Doc) => void): [Doc, Uint8Array] {
    // TODO: This might send the whole document state. Trim this down to only changes not sent yet.
    const changes = encodeStateAsUpdateV2(document);

    // TODO: This doesn't return a new reference.
    return [document, changes];
  }
  remoteChange(document: Doc, changes: Uint8Array): Doc {
    applyUpdateV2(document, changes);

    // TODO: This doesn't return a new reference.
    return document;
  }
  getHistory(document: Doc): Uint8Array {
    // TODO: This might send the whole document state. Trim this down to only changes not sent yet.
    return encodeStateAsUpdateV2(document);
  }
}

export class YjsJSONSerializer extends JSONSerializer<Uint8Array> { }
