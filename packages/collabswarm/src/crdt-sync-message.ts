import { CRDTChangeNode } from './crdt-change-node';
import { CRDTSnapshotNode } from './snapshot-node';

/**
 * CRDTSyncMessage is the message sent over both GossipSub pubsub topics and in response to
 * load document requests.
 *
 * @typeParam ChangesType A block of CRDT change(s).
 */
export type CRDTSyncMessage<ChangesType, PublicKey = unknown> = {
  /**
   * ID of a collabswarm document.
   */
  documentId: string;

  /**
   * CID of the root change node.
   */
  changeId?: string;

  /**
   * All document changes as an object whose keys are change object hashes and values
   * are change objects or null. A null value means that the change should be fetched
   * from the Helia blockstore (the CID is the hash).
   *
   * Data stored in the blockstore is deserialized using a `MessageSerializer`
   * implementation.
   */
  changes?: CRDTChangeNode<ChangesType>;

  /**
   * Optional snapshot for fast sync.
   * When present, peers can load from the snapshot state instead of replaying
   * the full change history. Post-snapshot changes are still included in `changes`.
   */
  snapshot?: CRDTSnapshotNode<ChangesType, PublicKey>;

  /**
   * Optional document keys list. Only populated while loading and receiving a document
   * key update (due to the removal of an ACL reader).
   *
   * NOTE: Keychain changes should only ever be sent over encrypted libp2p streams (not
   * GossipSub pubsub).
   */
  keychainChanges?: ChangesType;

  /**
   * Signature of the sync message.
   */
  signature?: string;
};
