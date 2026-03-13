/**
 * A snapshot node represents a compacted point in the Merkle-DAG change history.
 *
 * Instead of replaying individual change nodes from the beginning, a peer can
 * load the snapshot state and then apply only post-snapshot changes.
 *
 * @typeParam ChangesType The serialized CRDT type used for both incremental changes
 *   and full-state snapshots. The `state` field contains a snapshot produced by
 *   `CRDTProvider.getSnapshot()` that can be applied via `remoteChange()`.
 *   For Yjs this is `Uint8Array` (from `encodeStateAsUpdateV2`); for Automerge
 *   this is `BinaryChange[]` (from `getAllChanges`).
 * @typeParam PublicKey The type of key used to identify a user publicly.
 */
export interface CRDTSnapshotNode<ChangesType, PublicKey> {
  /**
   * Full serialized CRDT state at this point.
   * Produced by `CRDTProvider.getSnapshot(doc)`.
   */
  state: ChangesType;

  /**
   * CID of the most recent change node included in this snapshot.
   * All change nodes up to (and including) this CID are represented by the snapshot state.
   */
  lastChangeNodeCID: string;

  /**
   * Number of change nodes compacted into this snapshot.
   * Used to compare snapshots — higher count means more compaction.
   */
  compactedCount: number;

  /**
   * Signature of the snapshot creator.
   * Signs a versioned binary payload (see `_buildSnapshotSignPayload` for format).
   * Verified by trying all writer keys rather than relying on the `publicKey` field.
   */
  signature: Uint8Array;

  /**
   * Public key of the snapshot creator.
   * Must be in the document's writer ACL for the snapshot to be valid.
   */
  publicKey: PublicKey;

  /**
   * Timestamp of snapshot creation (milliseconds since epoch).
   */
  timestamp: number;
}
