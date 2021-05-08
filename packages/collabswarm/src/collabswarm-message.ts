export interface CRDTChangeBlock<ChangesType> {
  signature?: ArrayBuffer;
  changes: ChangesType;
}

export interface CRDTSyncMessage<ChangesType> {
  documentId: string;
  // FIXME: Change this to document encryption key and move this to a key-exchange message.
  // documentKey: ArrayBuffer;
  // A null value just means that the change was not sent explicitly.
  changes: { [hash: string]: CRDTChangeBlock<ChangesType> | null };
}
