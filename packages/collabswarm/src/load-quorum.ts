/**
 * Pure quorum-decision logic for the initial-load quorum protocol.
 *
 * Closes the "no quorum protocol for verifying initial document state" gap
 * tracked under issue #189 §5.4 item 2 (also a bullet under #186). The
 * design:
 *
 *   - Loader asks up to K peers in parallel for a `tipsHash` (see
 *     `tips-hash.ts`) advertising their view of the document's tip set.
 *   - Each peer either returns a hash, returns `null` (decline, e.g. unknown
 *     document or unauthorized), or fails to respond before the timeout
 *     (also represented as `null` here).
 *   - This module decides whether enough peers (>= Q) agreed on a single
 *     tip-set hash. If so, the loader proceeds with a normal single-peer
 *     document-load against any peer in the agreeing set. If not, the
 *     loader raises `LoadQuorumFailedError` and the application can decide
 *     how to recover (retry, surface to the user, etc.).
 *
 * The functions in this module are intentionally pure (no I/O, no clock,
 * no network) so the decision logic can be unit-tested in isolation and
 * audited as the trust-critical core of the gate.
 */

import { tipsHashToHex } from './tips-hash';

/**
 * A single peer's response to a tip-advertise probe.
 *
 * `hash`:
 *   - `Uint8Array` -- the peer returned a tip-set hash (32 bytes
 *     post-validation; see `tips-hash.ts`).
 *   - `null` -- the peer did not return a usable hash. This covers BOTH
 *     timeouts AND explicit declines (empty response, unauthorized, wrong
 *     document id, deserialization failure, etc.). Non-responding peers
 *     are NOT counted toward "disagreement" -- they simply do not vote.
 */
export interface PeerTipAdvertisement {
  peerId: string;
  hash: Uint8Array | null;
}

/**
 * Result of running `decideLoadQuorum` over a set of peer advertisements.
 *
 * On success, `winningHashHex` identifies the agreeing tip set and
 * `agreeingPeerIds` lists the peers that returned that hash -- the loader
 * should pick any one of these for the follow-up full document-load.
 *
 * On failure, `reason` describes why quorum could not be met (used for
 * error messages and observability) and `agreement` records the
 * per-hash vote counts so callers can log the disagreement pattern.
 */
export type LoadQuorumDecision =
  | {
      ok: true;
      winningHashHex: string;
      agreeingPeerIds: string[];
      respondingCount: number;
      effectiveQ: number;
    }
  | {
      ok: false;
      reason:
        | 'insufficient-responses'
        | 'no-majority'
        | 'no-peers-queried';
      respondingCount: number;
      effectiveQ: number;
      agreement: Map<string, number>;
    };

/**
 * Decide whether a set of tip-advertise responses meets quorum.
 *
 * @param advertisements One entry per peer queried. `hash: null` represents
 *   a non-vote (timeout or decline). Order is irrelevant.
 * @param q The minimum number of *agreeing* peers required. Already clamped
 *   to `[1, K]` by the caller; this function does not re-clamp.
 * @returns A {@link LoadQuorumDecision} describing the outcome. Pure: same
 *   inputs always yield the same result.
 */
export function decideLoadQuorum(
  advertisements: readonly PeerTipAdvertisement[],
  q: number,
): LoadQuorumDecision {
  if (advertisements.length === 0) {
    return {
      ok: false,
      reason: 'no-peers-queried',
      respondingCount: 0,
      effectiveQ: q,
      agreement: new Map(),
    };
  }

  // Tally agreement keyed by the hex form of each peer's hash. Hex is used
  // as the Map key because `Uint8Array` reference equality is not what we
  // want -- two peers returning byte-identical hashes must collide on the
  // same bucket. The hex encoding mirrors `tipsHashToHex`, so logged
  // mismatches are human-readable.
  const agreement = new Map<string, string[]>();
  let respondingCount = 0;
  for (const adv of advertisements) {
    if (adv.hash === null) {
      // Non-vote: timeout or explicit decline. Skip without penalty -- a
      // stale `knownPeers` cache that points at offline peers must not be
      // counted as disagreement, otherwise a partition + small mesh would
      // be indistinguishable from active Byzantine behaviour.
      continue;
    }
    respondingCount++;
    const key = tipsHashToHex(adv.hash);
    let bucket = agreement.get(key);
    if (!bucket) {
      bucket = [];
      agreement.set(key, bucket);
    }
    bucket.push(adv.peerId);
  }

  if (respondingCount === 0) {
    // No peer voted -- partition, all timed out, all declined.
    const summary = new Map<string, number>();
    return {
      ok: false,
      reason: 'insufficient-responses',
      respondingCount,
      effectiveQ: q,
      agreement: summary,
    };
  }

  // Find the largest bucket. Ties are broken arbitrarily by Map iteration
  // order (insertion order); ties never affect ok/!ok because both buckets
  // would have the same size and we only accept if size >= q.
  let bestKey: string | null = null;
  let bestPeers: string[] = [];
  for (const [key, peers] of agreement.entries()) {
    if (peers.length > bestPeers.length) {
      bestKey = key;
      bestPeers = peers;
    }
  }

  if (bestKey === null || bestPeers.length < q) {
    // Either no responses (handled above) or the largest agreeing cohort
    // is too small. Build a compact `hash -> count` snapshot for diagnostics.
    const summary = new Map<string, number>();
    for (const [key, peers] of agreement.entries()) {
      summary.set(key, peers.length);
    }
    // Distinguish "we got responses but none agreed enough" from the
    // earlier "no one responded" branch.
    const reason =
      respondingCount < q ? 'insufficient-responses' : 'no-majority';
    return {
      ok: false,
      reason,
      respondingCount,
      effectiveQ: q,
      agreement: summary,
    };
  }

  return {
    ok: true,
    winningHashHex: bestKey,
    agreeingPeerIds: bestPeers,
    respondingCount,
    effectiveQ: q,
  };
}

/**
 * Compute the effective `K` (number of peers to query) given a configured
 * upper bound and the number of currently-known peers. Pulled out so the
 * loader and the quorum decision can share a single source of truth and so
 * the clamp is unit-testable.
 */
export function effectiveK(
  configuredK: number,
  knownPeersCount: number,
): number {
  // K should be at least 1 (otherwise no probes happen) and at most the
  // number of peers we actually know about (otherwise we'd query the same
  // peer twice or fewer-than-K real peers).
  if (configuredK <= 0) return 0;
  if (knownPeersCount <= 0) return 0;
  return Math.min(configuredK, knownPeersCount);
}

/**
 * Compute the effective `Q` (quorum threshold) given a configured value and
 * the effective K. Clamped to `[1, K]` so a misconfigured `Q > K` cannot
 * make quorum unreachable, and `Q <= 0` does not silently bypass the gate.
 */
export function effectiveQ(configuredQ: number, k: number): number {
  if (k <= 0) return 0;
  if (configuredQ < 1) return 1;
  if (configuredQ > k) return k;
  return configuredQ;
}

/**
 * Error thrown by `CollabswarmDocument.load()` when the initial-load quorum
 * gate fails -- i.e. fewer than `Q` peers agreed on a tip-set hash within
 * the configured timeout. Applications should catch this and either retry
 * later (peers may converge), surface the failure to the user, or fall
 * back to an explicit `loadQuorumEnabled: false` path if they have an
 * out-of-band trust model.
 *
 * Defined here (alongside the pure decision logic) so callers can `instanceof`
 * test without importing the heavy `CollabswarmDocument` module.
 */
export class LoadQuorumFailedError extends Error {
  /** The document path the quorum was being computed for. */
  public readonly documentPath: string;
  /** Why quorum failed -- mirrors `LoadQuorumDecision.reason` on the
   *  failure case so callers can branch on the specific failure mode. */
  public readonly reason:
    | 'insufficient-responses'
    | 'no-majority'
    | 'no-peers-queried';
  /** Number of peers that actually returned a usable hash. */
  public readonly respondingCount: number;
  /** The effective Q threshold the loader was holding peers to. */
  public readonly requiredQ: number;
  /** Snapshot of (hash hex -> vote count) at the moment of failure, used
   *  for observability. Empty when no peer responded. */
  public readonly agreement: ReadonlyMap<string, number>;

  constructor(opts: {
    documentPath: string;
    reason: 'insufficient-responses' | 'no-majority' | 'no-peers-queried';
    respondingCount: number;
    requiredQ: number;
    agreement: ReadonlyMap<string, number>;
  }) {
    const detail =
      opts.reason === 'no-peers-queried'
        ? 'no peers were queried'
        : opts.reason === 'insufficient-responses'
          ? `only ${opts.respondingCount} of the required ${opts.requiredQ} peers responded`
          : `no tip-set hash reached the required ${opts.requiredQ}-of-${opts.respondingCount} agreement`;
    super(
      `Initial-load quorum failed for "${opts.documentPath}": ${detail}. ` +
        `Configure CollabswarmConfig.loadQuorumK/Q/loadQuorumTimeoutMs, ` +
        `or set loadQuorumEnabled: false to bypass (weakens trust assumptions).`,
    );
    this.name = 'LoadQuorumFailedError';
    this.documentPath = opts.documentPath;
    this.reason = opts.reason;
    this.respondingCount = opts.respondingCount;
    this.requiredQ = opts.requiredQ;
    this.agreement = opts.agreement;
  }
}
