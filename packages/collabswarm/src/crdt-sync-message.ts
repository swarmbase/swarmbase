/**
 * CRDTSyncMessage is the message sent over both IPFS pubsub topics and in response to
 * load document requests.
 *
 * @tparam ChangesType Type of a block of change(s).
 */
export type CRDTSyncMessage<ChangesType> = {
  /**
   * ID of a collabswarm document.
   */
  documentId: string;

  /**
   * All document changes as an object who's keys are change object hashes and values
   * are change objects or null. A null value means that the change should be fetched
   * from an IPFS file (the IPFS filename is the hash).
   *
   * Data stored int the IPFS file is deserialized using a `MessageSerializer`
   * implementation.
   */
  changes: { [hash: string]: ChangesType | null };

  /**
   * An optional block of change(s) made to the reader ACL. `undefined` means no change
   * was made to the reader ACL.
   */
  readersChanges: { [hash: string]: ChangesType | null };

  /**
   * An optional block of change(s) made to the writer ACL. `undefined` means no change
   * was made to the writer ACL.
   */
  writersChanges: { [hash: string]: ChangesType | null };

  /**
   * Optional document keys list. Only populated while loading and receiving a document
   * key update (due to the removal of an ACL reader).
   *
   * NOTE: Keychain changes should only ever be sent over encrypted libp2p streams (not
   * IPFS pubsub).
   */
  keychainChanges?: ChangesType;
};
