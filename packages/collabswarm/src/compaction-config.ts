/**
 * Configuration for history compaction behavior.
 *
 * Compaction creates snapshot nodes in the Merkle-DAG that summarize
 * the full CRDT state, allowing peers to skip replaying the full change history.
 */
export interface CompactionConfig {
  /**
   * Enable automatic compaction.
   * When false, snapshots are never created automatically.
   * Manual snapshots can still be triggered via `document.snapshot()`.
   */
  enabled: boolean;

  /**
   * Create a snapshot every N document change nodes.
   * Only document-kind changes count (not reader/writer ACL changes).
   */
  snapshotInterval: number;

  /**
   * Minimum number of document changes before the first snapshot is created.
   * Prevents premature snapshots on short-lived or small documents.
   */
  minChangesBeforeSnapshot: number;

  /**
   * Whether to prune old DAG nodes from sync messages after a snapshot.
   * When true, only the snapshot + post-snapshot changes are included in sync messages.
   * Old blocks remain in IPFS blockstore for peers that already have them.
   */
  pruneAfterSnapshot: boolean;

  /**
   * Keep at least N most recent change nodes in the sync tree even after pruning.
   * Provides a buffer so that slightly-behind peers can still catch up incrementally.
   */
  keepRecentNodes: number;
}

/**
 * Default compaction configuration.
 * Compaction is disabled by default for backward compatibility.
 */
export const defaultCompactionConfig: CompactionConfig = {
  enabled: false,
  snapshotInterval: 500,
  minChangesBeforeSnapshot: 100,
  pruneAfterSnapshot: true,
  keepRecentNodes: 50,
};
