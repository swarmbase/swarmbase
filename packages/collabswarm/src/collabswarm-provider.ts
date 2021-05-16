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
