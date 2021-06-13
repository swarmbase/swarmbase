import { CRDTSyncMessage } from "./crdt-sync-message";

export interface CRDTProvider<DocType, ChangesType, ChangeFnType, MessageType extends CRDTSyncMessage<ChangesType>> {
  newDocument(): DocType;
  newMessage(documentId: string): MessageType;
  localChange(document: DocType, message: string, changeFn: ChangeFnType): [DocType, ChangesType];
  remoteChange(document: DocType, changes: ChangesType): DocType;
  getHistory(document: DocType): ChangesType;
}
