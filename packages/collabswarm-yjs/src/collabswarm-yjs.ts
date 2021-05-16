import { Collabswarm, CollabswarmDocument, CollabswarmDocumentChangeHandler, CRDTProvider, CRDTSyncMessage } from "@collabswarm/collabswarm";
import { applyUpdateV2, Doc, encodeStateAsUpdateV2 } from "yjs";


export type YjsSwarmDocumentChangeHandler = CollabswarmDocumentChangeHandler<Doc>;

export type YjsSwarm = Collabswarm<Doc, Uint8Array, (doc: Doc) => void, YjsSwarmSyncMessage>;

export type YjsSwarmDocument = CollabswarmDocument<Doc, Uint8Array, (doc: Doc) => void, YjsSwarmSyncMessage>;

export interface YjsSwarmSyncMessage extends CRDTSyncMessage<Uint8Array> {}

export class YjsProvider implements CRDTProvider<Doc, Uint8Array, (doc: Doc) => void, YjsSwarmSyncMessage> {
  newDocument(): Doc {
    return new Doc();
  }
  newMessage(documentId: string): YjsSwarmSyncMessage {
    return { documentId, changes: { } };
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
  serializeChanges(changes: Uint8Array): string {
    return JSON.stringify(changes);
  }
  deserializeChanges(changes: string): Uint8Array {
    return JSON.parse(changes);
  }
  serializeMessage(message: YjsSwarmSyncMessage): Uint8Array {
    const encoder = new TextEncoder();
    return encoder.encode(JSON.stringify(message));
  }
  deserializeMessage(message: Uint8Array): YjsSwarmSyncMessage {
    const decoder = new TextDecoder();
    const rawMessage = decoder.decode(message);
    try {
      return JSON.parse(rawMessage);
    } catch (err) {
      console.error("Failed to parse message:", rawMessage, message);
      throw err;
    }
  }
  getHistory(document: Doc): Uint8Array {
    // TODO: This might send the whole document state. Trim this down to only changes not sent yet.
    return encodeStateAsUpdateV2(document);
  }
}
