/**
 * Orchestration helper for the initial-load quorum gate (#186 / #189 §5.4.2).
 *
 * The pure quorum decision module (`load-quorum.ts`) is responsible for
 * computing whether a set of tip-advertise responses meets the agreement
 * threshold. It is intentionally I/O-free so the trust-critical decision
 * logic can be audited and unit-tested in isolation.
 *
 * This module sits one layer up: it takes a peer list and a caller-supplied
 * probe function and orchestrates the K-of-Q probe round, returning the
 * narrowed agreeing-cohort peer list plus the winning hash (or throwing
 * `LoadQuorumFailedError` on any failure mode). It is also pure with respect
 * to libp2p/Helia -- the only network coupling lives in the `probeFn`
 * callback that `CollabswarmDocument.load()` passes in. That decoupling
 * exists so the production orchestration path can be exercised by unit tests
 * without a real libp2p/Helia stack (the codebase has no precedent for full
 * libp2p test doubles, and the load orchestration is the security gate
 * Copilot's PR #284 r4 review asked to be regression-tested).
 *
 * Callers wire this module by:
 *
 *   1. Computing the peer list (already-deduped by libp2p PeerId so a single
 *      peer with multiple open connections cannot cast multiple votes).
 *   2. Passing a `probeFn` that, given a peer, returns a `Promise<Uint8Array
 *      | null>` -- the peer's advertised `tipsHash` bytes, or `null` for any
 *      non-vote outcome (timeout, decline, decryption failure, etc.).
 *   3. Passing a `peerIdOf` extractor so this module can narrow the peer list
 *      down to the agreeing cohort without knowing about Multiaddrs.
 *
 * The return value is either:
 *   - `{ skipped: true }` — quorum disabled, or no peers (caller falls through
 *     to the legacy single-peer load loop / treats as new document).
 *   - `{ ok: true, narrowedPeers, winningHashHex }` — quorum passed; caller
 *     does the full document-load against `narrowedPeers` with the binding
 *     check pinned to `winningHashHex`.
 *
 * Failures (insufficient responses, no majority, etc.) are thrown as
 * `LoadQuorumFailedError` so the caller's existing `instanceof`-based
 * propagation works unchanged.
 */

import {
  decideLoadQuorum,
  defaultQuorumQ,
  effectiveK,
  effectiveQ,
  LoadQuorumFailedError,
  PeerTipAdvertisement,
} from './load-quorum';
import { tipsHashToHex } from './tips-hash';

/**
 * Config inputs for `runLoadQuorum`. Mirrors the relevant subset of
 * `CollabswarmConfig` so the orchestrator does not import the heavy config
 * module.
 */
export interface LoadQuorumOrchestratorConfig {
  enabled?: boolean;
  /** Maximum number of peers to probe. Defaults to 3. */
  k?: number;
  /** Minimum agreement threshold. Defaults to `defaultQuorumQ(k)`. */
  q?: number;
  /** Per-probe timeout in ms (caller-enforced inside `probeFn`). Stored here
   * for symmetry with `CollabswarmConfig`; this module does not use it
   * directly because `probeFn` is responsible for the wall-clock timeout. */
  timeoutMs?: number;
  /** Allow a single-peer fallback path when only one peer is reachable. */
  allowSinglePeer?: boolean;
}

/**
 * Result of running the quorum orchestration over a peer list.
 */
export type LoadQuorumOrchestratorResult<T> =
  | { skipped: true }
  | { ok: true; narrowedPeers: T[]; winningHashHex: string };

/**
 * Run the initial-load quorum orchestration round.
 *
 * @param peers The de-duplicated list of candidate peers (typically Multiaddrs
 *   from `getConnections()`). Order is preserved into `narrowedPeers` so the
 *   caller's preferred-peer placement survives.
 * @param peerIdOf Extracts a stable peer-id key from each peer entry; used
 *   to match agreeing-cohort PeerIds back to the original peer entries.
 * @param probeFn Probes one peer for a `tipsHash`. Should return `null` for
 *   any non-vote outcome (timeout, decline, decryption failure, malformed
 *   hash, etc.). If `probeFn` throws or rejects, the orchestrator catches
 *   it at the boundary, logs the error, and records the peer as a non-vote
 *   so the surrounding `LoadQuorumFailedError` contract is preserved. Even
 *   so, a thrown probe still indicates a bug in the caller's probe
 *   implementation and should be fixed at the source.
 * @param documentPath Used to construct the `LoadQuorumFailedError` on
 *   failure; carries the document name into operator-visible logs.
 * @param config Quorum tuning knobs (see `LoadQuorumOrchestratorConfig`).
 *
 * @returns Either `{ skipped }` (gate disabled or no peers) or
 *   `{ ok: true, narrowedPeers, winningHashHex }` on success. Throws
 *   `LoadQuorumFailedError` on any failure mode (no responses, no majority,
 *   insufficient single-peer probe).
 */
export async function runLoadQuorum<T>(opts: {
  peers: readonly T[];
  peerIdOf: (peer: T) => string;
  probeFn: (peer: T) => Promise<Uint8Array | null>;
  documentPath: string;
  config?: LoadQuorumOrchestratorConfig;
}): Promise<LoadQuorumOrchestratorResult<T>> {
  const { peers, peerIdOf, probeFn, documentPath, config } = opts;
  const enabled = config?.enabled ?? true;
  if (!enabled) {
    return { skipped: true };
  }
  const configuredK = config?.k ?? 3;
  const allowSinglePeer = config?.allowSinglePeer ?? false;

  // Validate `loadQuorumK >= 1` up-front. A `configuredK <= 0` would
  // collapse `effectiveK(...)` to 0 and the K=0 branch below would return
  // `{ skipped: true }` — which `CollabswarmDocument.load()` then surfaces
  // to `open()` as a "no peer could provide the document" outcome, and
  // `open()` would silently re-initialize the document as brand-new
  // (forking any existing copy held by other peers). Refuse loudly
  // instead. The misconfiguration is a static operator mistake, not a
  // recoverable runtime condition, so we throw regardless of peer count.
  // See PR #284 r5 Copilot review.
  if (configuredK <= 0) {
    throw new LoadQuorumFailedError({
      documentPath,
      reason: 'invalid-config',
      respondingCount: 0,
      requiredQ: 0,
      agreement: new Map(),
      detail: `loadQuorumK must be >= 1; got ${configuredK}`,
    });
  }

  const k = effectiveK(configuredK, peers.length);
  // Compute the default Q from the EFFECTIVE K (after clamping against the
  // known peer count), not the CONFIGURED K. With configured K=7 but only
  // 3 peers reachable, `defaultQuorumQ(7) = 4` but `effectiveK(7, 3) = 3`,
  // so `effectiveQ(4, 3) = 3` would require ALL 3 peers to agree -- losing
  // the one-fault tolerance the formula is meant to provide. Deriving the
  // default from `k` (effective) gives `defaultQuorumQ(3) = 2`, which
  // tolerates one non-vote among the 3 reachable peers. When the operator
  // explicitly set `loadQuorumQ`, the `??` is a no-op and the explicit
  // value flows through `effectiveQ`'s `[1, k]` clamp as before. See PR
  // #284 r7 Copilot review.
  const configuredQ = config?.q ?? defaultQuorumQ(k);
  const q = effectiveQ(configuredQ, k);

  if (k === 0) {
    // No peers known. Treat as "new document" — caller falls through to
    // the legacy "no peer could load" branch.
    return { skipped: true };
  }

  if (k === 1 && !allowSinglePeer) {
    // Only one peer reachable but quorum requires Q>=2 by default. Without
    // a second opinion we cannot distinguish "honest solo peer" from
    // "malicious peer serving a forged state". Refuse.
    throw new LoadQuorumFailedError({
      documentPath,
      reason: 'insufficient-responses',
      respondingCount: 0,
      requiredQ: q,
      agreement: new Map(),
    });
  }

  if (k === 1 && allowSinglePeer) {
    // Single-peer pass-through. Probe the one known peer; if it responds at
    // all we proceed with the legacy load. Warn loudly so operators can
    // spot the regression. Q is forced to 1 here.
    console.warn(
      `[${documentPath}] Initial-load quorum: only one peer known; ` +
        `proceeding under loadQuorumAllowSinglePeer (trust assumptions ` +
        `degraded back to single-peer load). Configure additional peers ` +
        `to restore Byzantine-fault-tolerant quorum semantics.`,
    );
    const probedPeer = peers[0];
    // Contain probe errors at the orchestrator boundary. The orchestrator
    // contract (see module docstring + the per-peer note above on
    // `probeFn`) is that any non-vote outcome — including a thrown/rejected
    // probe — is surfaced as a non-vote. Without this catch a misbehaving
    // `probeFn` would let the underlying error escape past the orchestrator
    // and bypass the `LoadQuorumFailedError` API contract `load()` callers
    // are written against. See PR #284 r5 Copilot review.
    let probe: Uint8Array | null;
    try {
      probe = await probeFn(probedPeer);
    } catch (err) {
      console.warn(
        `[${documentPath}] Initial-load quorum single-peer probe threw; ` +
          `recording as non-vote.`,
        err,
      );
      probe = null;
    }
    if (probe === null) {
      throw new LoadQuorumFailedError({
        documentPath,
        reason: 'insufficient-responses',
        respondingCount: 0,
        requiredQ: 1,
        agreement: new Map(),
      });
    }
    const winningHashHex = tipsHashToHex(probe);
    // Narrow to ONLY the probed peer. Without this, the subsequent
    // snapshot/doc-load loop would also try the other peers in the original
    // peer list (which were never probed) and bind their served state
    // against THIS peer's hash — a non-sequitur that could either pass the
    // binding by coincidence or fail it even though single-peer mode was
    // opted-into.
    return { ok: true, narrowedPeers: [probedPeer], winningHashHex };
  }

  // Standard K-of-Q quorum path. Probe the first K peers in parallel,
  // decide agreement, narrow.
  //
  // Contain probe errors at the orchestrator boundary. The contract is
  // that any non-vote outcome — including a thrown/rejected `probeFn` —
  // is surfaced as a non-vote (`hash: null`). Without the per-probe
  // catch, a single rejecting `probeFn` would reject the whole
  // `Promise.all`, bubble past the orchestrator, and bypass the
  // `LoadQuorumFailedError` API the caller is written against —
  // surfacing a raw probe error from `load()` instead of the structured
  // `LoadQuorumFailedError(insufficient-responses)` callers expect.
  // See PR #284 r5 Copilot review.
  const probedPeers = peers.slice(0, k);
  const advertisements: PeerTipAdvertisement[] = await Promise.all(
    probedPeers.map(async (peer) => {
      let hash: Uint8Array | null;
      try {
        hash = await probeFn(peer);
      } catch (err) {
        console.warn(
          `[${documentPath}] Initial-load quorum probe for peer ${peerIdOf(
            peer,
          )} threw; recording as non-vote.`,
          err,
        );
        hash = null;
      }
      return { peerId: peerIdOf(peer), hash };
    }),
  );
  const decision = decideLoadQuorum(advertisements, q);
  if (!decision.ok) {
    console.warn(
      `[${documentPath}] Initial-load quorum FAILED: ` +
        `${decision.reason} (${decision.respondingCount} responses, ` +
        `required ${decision.effectiveQ}). Aborting load.`,
    );
    throw new LoadQuorumFailedError({
      documentPath,
      reason: decision.reason,
      respondingCount: decision.respondingCount,
      requiredQ: decision.effectiveQ,
      agreement: decision.agreement,
    });
  }
  console.log(
    `[${documentPath}] Initial-load quorum passed: ` +
      `${decision.agreeingPeerIds.length}/${decision.respondingCount} ` +
      `peers agreed on tipsHash=${decision.winningHashHex.slice(0, 12)}...`,
  );
  // Narrow `peers` to only the agreeing cohort. The caller then asks one of
  // these peers for the full state; with quorum agreement, any single
  // agreeing peer's load is defended by Q-1 other peers attesting to the
  // same tip set. Order is preserved.
  const agreeingSet = new Set(decision.agreeingPeerIds);
  const narrowed = peers.filter((p) => agreeingSet.has(peerIdOf(p)));
  // Defensive: at least one agreeing peer must remain. If peer-id
  // extraction loses a peer (should never happen given we built the same
  // set above), fall back to the full list so we don't accidentally
  // degrade to "no peers to load from".
  const finalNarrowed =
    narrowed.length > 0 ? narrowed : ([...peers] as T[]);
  return {
    ok: true,
    narrowedPeers: finalNarrowed,
    winningHashHex: decision.winningHashHex,
  };
}
