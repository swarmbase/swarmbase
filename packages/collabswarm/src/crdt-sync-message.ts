/**
 * CRDTSyncMessage is the message sent over both IPFS pubsub topics and in response to
 * load document requests.
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

  // /**
  //  * Optional document keys list. Only populated while loading and receiving a document
  //  * key update (due to the removal of an ACL reader).
  //  * 
  //  * These are stored as strings currently 
  //  */
  // keys?: string[];
}
