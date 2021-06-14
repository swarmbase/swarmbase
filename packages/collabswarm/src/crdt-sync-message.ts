export interface CRDTSyncMessage<ChangesType> {
  documentId: string;
  // A null value just means that the change was not sent explicitly.
  changes: { [hash: string]: ChangesType | null };
}
