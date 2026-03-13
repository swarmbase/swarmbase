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
   * Root of the Merkle-DAG change tree. Each `CRDTChangeNode` contains a change
   * payload and optional `children` linking to prior nodes. A node whose `change`
   * is `undefined` (deferred) should be fetched from the Helia blockstore by CID.
   *
   * Changes are decrypted via `ChangesSerializer` and sync messages via
   * `SyncMessageSerializer`.
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
