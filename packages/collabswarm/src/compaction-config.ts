/**
 * Configuration for history compaction behavior.
 *
 * Compaction creates snapshot nodes in the Merkle-DAG that summarize
 * the full CRDT state, allowing peers to skip replaying the full change history.
 */
export interface CompactionConfig {
  /** Enable automatic compaction; when false, only manual `document.snapshot()` is available. */
  enabled: boolean;

  /** Create a snapshot every N document changes (ACL changes do not count). */
  snapshotInterval: number;

  /** Minimum document changes before the first snapshot, to avoid premature snapshots. */
  minChangesBeforeSnapshot: number;

  /** Prune old nodes from the sync tree and delete their blocks from the Helia blockstore after a snapshot. ACL blocks are always preserved. */
  pruneAfterSnapshot: boolean;

  /** Keep at least N recent change nodes after pruning so slightly-behind peers can catch up. */
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
