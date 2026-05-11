import {
  CRDTChangeNode,
  CRDTChangeNodeKind,
  crdtChangeNodeDeferred,
} from './crdt-change-node';

/**
 * Maximum number of recent tips to track for Merkle-CRDT cross-linking
 * (paper §VI.B.e). When a new change is published, up to `MAX_CROSS_LINKS`
 * cross-links to other recent tips are attached alongside the primary parent
 * link. This bounds per-message overhead while still giving peers with
 * partial DAG views additional anchor points to discover and fetch missing
 * blocks from. Cross-links are emitted as deferred children (no embedded
 * payload), so each adds only one CID key plus a small `{ kind }` tag in
 * the `children` map -- bounded and small per cross-link.
 *
 * `MAX_CROSS_LINKS` is chosen as 3 (so up to 3 cross-links plus the primary
 * parent per outgoing message):
 *   - small enough to keep gossip messages compact;
 *   - large enough that bursty concurrent writes from 2-3 peers can be
 *     cross-linked together within a few messages.
 *
 * `MAX_RECENT_TIPS` is one larger than `MAX_CROSS_LINKS` so the immediate
 * primary parent and up to `MAX_CROSS_LINKS` additional candidates can all
 * be retained at once.
 */
export const MAX_RECENT_TIPS = 4;
export const MAX_CROSS_LINKS = 3;

/**
 * A recently-known DAG tip used by `selectCrossLinks` / `trackTipInList`.
 * `cid` is a Helia CID string; `kind` is preserved so receivers can route
 * a deferred-fetch result through the correct merge path (document /
 * reader-ACL / writer-ACL).
 */
export type RecentTip = {
  cid: string;
  kind: CRDTChangeNodeKind;
};

/**
 * Pure helper: select up to `maxCrossLinks` cross-link tips from
 * `recentTips`, excluding the primary parent and the new CID itself.
 *
 * Iterates newest -> oldest so the most recent tips are preferred when
 * the cap is reached (more likely to be reachable on the peer side, since
 * gossip ordering tends to deliver recent messages first to most peers).
 *
 * Returns a new array; does not mutate `recentTips`.
 */
export function selectCrossLinks<Tip extends { cid: string }>(
  recentTips: ReadonlyArray<Tip>,
  primaryParentId: string | undefined,
  newCid: string,
  maxCrossLinks: number = MAX_CROSS_LINKS,
): Tip[] {
  const out: Tip[] = [];
  const seen = new Set<string>();
  for (let i = recentTips.length - 1; i >= 0; i--) {
    if (out.length >= maxCrossLinks) break;
    const tip = recentTips[i]!;
    if (tip.cid === primaryParentId) continue;
    if (tip.cid === newCid) continue;
    if (seen.has(tip.cid)) continue;
    seen.add(tip.cid);
    out.push(tip);
  }
  return out;
}

/**
 * A flattened entry produced by walking a remote sync tree: a CID, the kind
 * of node (document/reader/writer), and the inline `change` payload if the
 * remote included one. An `undefined` payload means the entry is a deferred
 * leaf (cross-link or other deferred reference) and the receiver must fetch
 * the block from the blockstore by CID.
 */
export type MergedSyncEntry<ChangesType> = [
  string,
  CRDTChangeNodeKind,
  ChangesType | undefined,
];

/**
 * Pure helper: walk a remote sync tree and return the entries that are new
 * relative to `localHashes` and `localRootId`, deduplicated per traversal.
 *
 * **Per-message dedup (paper §VI.B.e cross-links):** cross-link entries can
 * legitimately reference an ancestor CID that is already embedded in the
 * primary parent's inline subtree (e.g. linear history where a cross-link
 * targets an older ancestor). Without per-message dedup, the same CID would
 * appear twice in the returned entries -- once with the inline payload (via
 * the parent subtree) and once as a deferred leaf -- causing the receiver
 * to apply or fetch+apply the same change twice, which can corrupt CRDT
 * state and double-fire local handlers/counters.
 *
 * Dedup strategy:
 *   - Skip any CID already present in `localHashes` (already applied locally).
 *   - During traversal, accumulate entries in a per-CID map. When the same
 *     CID is encountered more than once within a single sync message, the
 *     entry that carries an inline `change` payload is preferred over a
 *     deferred-leaf entry. This is robust regardless of traversal order
 *     (inline-first or deferred-first).
 *   - Track whether a CID's children have been walked. If a CID is first
 *     encountered as a deferred leaf (no `children`) and later encountered
 *     inline with a populated `children` map (possible if serializer or key
 *     ordering varies), upgrade the stored entry AND walk the
 *     newly-discovered children. Skipping the walk in this case would drop
 *     the inline descendants entirely.
 *   - A CID whose children have already been walked is not re-walked --
 *     safe because CIDs are content-addressed: the same CID always names
 *     the same subtree.
 *
 * Returns a new array; does not mutate the inputs.
 */
export function mergeRemoteSyncTree<ChangesType>(
  remoteRootId: string | undefined,
  remoteRoot: CRDTChangeNode<ChangesType>,
  localRootId: string | undefined,
  localHashes: ReadonlySet<string>,
): MergedSyncEntry<ChangesType>[] {
  // CID -> winning entry for this message. Entries with an inline `change`
  // payload beat deferred-leaf entries; otherwise the first-seen entry wins.
  const byCid = new Map<string, MergedSyncEntry<ChangesType>>();
  // CIDs whose `children` have already been walked. A CID may be in `byCid`
  // without being in `walked` if it was first seen as a deferred leaf
  // (no `children`). When the same CID later appears inline with children,
  // we must descend into those children even though the entry already exists.
  const walked = new Set<string>();

  function walk(
    nodeId: string | undefined,
    node: CRDTChangeNode<ChangesType>,
  ): void {
    if (nodeId === undefined) return;
    // The remote root matches our local head: nothing new under it.
    if (nodeId === localRootId) return;
    // Already applied locally (or marked seen via a snapshot boundary).
    if (localHashes.has(nodeId)) return;

    const existing = byCid.get(nodeId);
    if (existing) {
      // Same CID seen earlier in this traversal. Upgrade a deferred-leaf
      // entry to an inline-payload entry if this visit carries the payload.
      if (existing[2] === undefined && node.change !== undefined) {
        byCid.set(nodeId, [nodeId, node.kind, node.change]);
      }
      // Fall through to the children walk below: if the prior visit was a
      // deferred leaf (no children) and this visit carries children, we must
      // still descend so we don't drop the inline descendants.
    } else {
      byCid.set(nodeId, [nodeId, node.kind, node.change]);
    }

    // Don't re-walk children we've already walked. Content addressing means
    // the same CID names the same subtree, so once we've descended through
    // a CID's children we know its full inline subtree.
    if (walked.has(nodeId)) return;

    if (node.children === undefined) return;
    if (node.children === crdtChangeNodeDeferred) {
      throw new Error('IPLD dereferencing is not supported yet!');
    }
    // Mark as walked BEFORE descending so cycles (shouldn't happen with
    // content addressing, but defensively) don't infinitely recurse.
    walked.add(nodeId);
    for (const [childId, childNode] of Object.entries(node.children)) {
      walk(childId, childNode);
    }
  }

  walk(remoteRootId, remoteRoot);
  return Array.from(byCid.values());
}

/**
 * Pure helper: append `entry` to `recentTips` with LRU semantics
 * (most-recently-used to the back), evicting the oldest entries when the
 * list exceeds `maxRecentTips`. If `entry.cid` is already present, it is
 * moved to the back without growing the list. Mutates `recentTips` in
 * place and returns it for convenience.
 *
 * Entries with empty `cid` are ignored (defensive guard for the initial
 * sync-message state before any change has been published).
 */
export function trackTipInList<Tip extends { cid: string }>(
  recentTips: Tip[],
  entry: Tip,
  maxRecentTips: number = MAX_RECENT_TIPS,
): Tip[] {
  if (!entry.cid) return recentTips;
  // Clamp `maxRecentTips` to non-negative so a misconfigured zero or
  // negative cap clears the list instead of looping forever (the eviction
  // loop below uses `> cap`, which would never become false against an
  // empty array if `cap` were negative).
  const cap = Math.max(0, maxRecentTips);
  if (cap === 0) {
    recentTips.length = 0;
    return recentTips;
  }
  const existingIdx = recentTips.findIndex((t) => t.cid === entry.cid);
  if (existingIdx !== -1) {
    recentTips.splice(existingIdx, 1);
  }
  recentTips.push(entry);
  while (recentTips.length > cap) {
    recentTips.shift();
  }
  return recentTips;
}
