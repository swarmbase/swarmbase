import { CollabswarmDocument } from "./collabswarm-document";
import { CRDTSyncMessage } from "./collabswarm-message";

export interface CRDTProvider<DocType, ChangesType, ChangeFnType, MessageType extends CRDTSyncMessage<ChangesType>> {
  newDocument(): DocType;
  newMessage(documentId: string): MessageType;
  localChange(document: DocType, message: string, changeFn: ChangeFnType): [DocType, ChangesType];
  remoteChange(document: DocType, changes: ChangesType): DocType;
  serializeChanges(changes: ChangesType): string;
  deserializeChanges(changes: string): ChangesType;
  serializeMessage(message: MessageType): Uint8Array;
  deserializeMessage(message: Uint8Array): MessageType;
  getHistory(document: DocType): ChangesType;
}

export interface AuthProvider<DocType, ChangesType, ChangeFnType, MessageType extends CRDTSyncMessage<ChangesType>, DocRef extends CollabswarmDocument<DocType, ChangesType, ChangeFnType, MessageType>> {
  signChanges(changes: ChangesType): ChangesType;
  verifyChange(changes: ChangesType): boolean;
  encryptChanges(changes: ChangesType): Uint8Array;
  decryptChanges(changes: Uint8Array): ChangesType;

  signMessages(message: MessageType): MessageType;
  verifyMessages(message: MessageType): MessageType;
  // encryptMessages(messages: MessageType): Uint8Array;
  // decryptMessages(messages: Uint8Array): MessageType;

  addReader(doc: DocRef, peerId: string): DocRef;
  removeReader(doc: DocRef, peerId: string): DocRef;
  getReaders(doc: DocRef): string[];

  addWriter(doc: DocRef, peerId: string): DocRef;
  removeWriter(doc: DocRef, peerId: string): DocRef;
  getWriters(doc: DocRef): string[];
}
