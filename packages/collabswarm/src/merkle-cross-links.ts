import { CRDTChangeNodeKind } from './crdt-change-node';

/**
 * Maximum number of recent local tips to track for Merkle-CRDT cross-linking
 * (paper §VI.B.e). When a new change is published, up to `MAX_CROSS_LINKS`
 * cross-links to other recent tips are attached alongside the primary parent
 * link. This bounds per-message overhead while still giving peers with
 * partial DAG views additional anchor points to discover and fetch missing
 * blocks from. Cross-links are emitted as deferred children (no embedded
 * payload), so each adds only a CID-string of message size.
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
