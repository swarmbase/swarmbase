import { CRDTChangeNode } from './crdt-change-node';

/**
 * CRDTSyncMessage is the message sent over both IPFS pubsub topics and in response to
 * load document requests.
 *
 * @tparam ChangesType A block of CRDT change(s).
 */
export type CRDTSyncMessage<ChangesType> = {
  /**
   * ID of a collabswarm document.
   */
  documentId: string;

  /**
   * CID of the root change node.
   */
  changeId?: string;

  /**
   * All document changes as an object who's keys are change object hashes and values
   * are change objects or null. A null value means that the change should be fetched
   * from an IPFS file (the IPFS filename is the hash).
   *
   * Data stored int the IPFS file is deserialized using a `MessageSerializer`
   * implementation.
   */
  changes?: CRDTChangeNode<ChangesType>;

  /**
   * CID of the root readers ACL change node.
   */
  readersChangeId?: string;

  /**
   * An optional block of change(s) made to the reader ACL. `undefined` means no change
   * was made to the reader ACL.
   */
  readersChanges?: CRDTChangeNode<ChangesType>;

  /**
   * CID of the root readers ACL change node.
   */
  writersChangeId?: string;

  /**
   * An optional block of change(s) made to the writer ACL. `undefined` means no change
   * was made to the writer ACL.
   */
  writersChanges?: CRDTChangeNode<ChangesType>;

  /**
   * Optional document keys list. Only populated while loading and receiving a document
   * key update (due to the removal of an ACL reader).
   *
   * NOTE: Keychain changes should only ever be sent over encrypted libp2p streams (not
   * IPFS pubsub).
   */
  keychainChanges?: ChangesType;

  /**
   * Signature of the sync message.
   */
  signature?: string;
};
