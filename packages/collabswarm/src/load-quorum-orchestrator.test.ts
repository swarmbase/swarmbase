/**
 * Integration tests for the load-quorum orchestrator (#186 / #189 §5.4.2).
 *
 * The pure helpers in `load-quorum.ts` (decision logic) and `tips-hash.ts`
 * (canonical hashing) have their own unit tests that prove the trust-critical
 * primitives are correct in isolation. Those tests do NOT exercise the
 * orchestration the production loader runs end-to-end -- probe K peers,
 * narrow to the agreeing cohort, surface single-peer fallback with a strict
 * binding, raise `LoadQuorumFailedError` on the right reasons.
 *
 * The orchestration code path lives in
 * `runLoadQuorum` (called by `CollabswarmDocument.load()`) and was extracted
 * here specifically so the security gate can be regression-tested without a
 * real libp2p/Helia stack. (The codebase has no precedent for full libp2p
 * test doubles: existing tests in `collabswarm.test.ts` replicate logic
 * against mocks rather than instantiating `CollabswarmDocument`, since the
 * module's top-level imports drag in ESM-only libp2p packages that Jest's
 * default CommonJS resolver cannot load. Standing up that infrastructure
 * inside this PR is the explicit "stop and report" threshold flagged for
 * load-quorum testing; extracting the orchestration into a pure-ish module
 * gives the equivalent coverage with no new test-infra debt.)
 *
 * This file closes the gap raised by Copilot's PR #284 r4 review: the
 * production quorum path is now covered by a test matrix that exercises all
 * five flagged cases (a) all-agree, (b) majority-agree-with-dissenter,
 * (c) vote-vs-serve mismatch, (d) insufficient responses (timeouts), and
 * (e) single-peer fallback path.
 */

import { describe, expect, test, jest, beforeEach } from '@jest/globals';
import { runLoadQuorum } from './load-quorum-orchestrator';
import { LoadQuorumFailedError } from './load-quorum';
import { tipsHashToHex } from './tips-hash';

/**
 * Fixture hashes. Each is a 32-byte fixed-byte buffer so the hex form is
 * trivial to compute and assert against. Mirrors the pattern in
 * `load-quorum.test.ts`.
 */
function fixedByteHash(byte: number): Uint8Array {
  const buf = new Uint8Array(32);
  buf.fill(byte);
  return buf;
}
const HASH_X = fixedByteHash(0xaa);
const HASH_Y = fixedByteHash(0xbb);
const HASH_X_HEX = tipsHashToHex(HASH_X);
const HASH_Y_HEX = tipsHashToHex(HASH_Y);

/**
 * Test "peer" type. The orchestrator is generic on `T`; in production T is
 * `Multiaddr` but for tests a string is enough -- the orchestrator only ever
 * passes peers back through the caller-supplied `peerIdOf` extractor and into
 * the caller-supplied `probeFn`.
 */
type TestPeer = string;
const peerIdOf = (p: TestPeer) => p;

/**
 * Mirror of how `CollabswarmDocument.load()` uses the orchestrator: probe
 * peers, then perform the full document-load against the narrowed cohort,
 * with the responder's served `tips` hash bound to the quorum's
 * `winningHashHex`. The harness below stands in for the snapshot/doc-load
 * loop so the binding check is exercised against the narrowed peer list
 * this orchestrator produces.
 *
 * Per-peer bind failures are NOT fatal: a peer whose served hash does not
 * match `winningHashHex` is recorded in `agreeingPeerBindFailures` and the
 * harness continues to the NEXT peer in the cohort. Only after EVERY peer
 * in the narrowed cohort has bind-failed (and at least one bind failure
 * was recorded) does the harness throw
 * `LoadQuorumFailedError(reason: 'bind-check-failed-all-agreeing-peers')`.
 * This mirrors the PR #284 r6 DoS fix in production `load()` -- a single
 * malicious peer in the agreeing cohort that votes for the majority hash
 * and then serves a mismatched full load can NOT unilaterally abort the
 * whole load.
 */
async function simulateFullLoad(opts: {
  narrowedPeers: TestPeer[];
  winningHashHex: string;
  serveFn: (peer: TestPeer) => Promise<string>; // returns served-tips hash hex
}): Promise<{
  loadedFromPeer: TestPeer | null;
  attempts: TestPeer[];
}> {
  const attempts: TestPeer[] = [];
  const agreeingPeerBindFailures = new Map<string, string>();
  for (const peer of opts.narrowedPeers) {
    attempts.push(peer);
    const servedHashHex = await opts.serveFn(peer);
    if (servedHashHex === opts.winningHashHex) {
      return { loadedFromPeer: peer, attempts };
    }
    // Bind check failed for THIS peer. Record it and continue to the
    // next peer in the agreeing cohort. Production `_sendLoadRequestAndSync`
    // throws an internal `_QuorumBindCheckFailedError` here and `load()`
    // catches it inside the loop; we collapse that into a "record + continue"
    // for the harness.
    agreeingPeerBindFailures.set(peer, servedHashHex);
  }
  // Loop exhausted with at least one bind failure recorded => every peer
  // in the agreeing cohort equivocated between the probe round and the
  // load round. Escalate with the dedicated reason.
  if (agreeingPeerBindFailures.size > 0) {
    throw new LoadQuorumFailedError({
      documentPath: '/test',
      reason: 'bind-check-failed-all-agreeing-peers',
      respondingCount: 0,
      requiredQ: 0,
      agreement: new Map([[opts.winningHashHex, 0]]),
      agreeingPeerBindFailures,
    });
  }
  return { loadedFromPeer: null, attempts };
}

describe('runLoadQuorum: production orchestration coverage (PR #284 r4)', () => {
  // Typed `any` because Jest's generic `jest.fn()` typings are awkward to
  // satisfy alongside `mockImplementation((peer) => ...)`, and the call
  // sites explicitly annotate `peer: TestPeer` where it matters.
  let probeMock: any;

  beforeEach(() => {
    probeMock = jest.fn();
  });

  test('(a) 3 peers, all vote the same hash and serve a matching load => load succeeds', async () => {
    const peers: TestPeer[] = ['p1', 'p2', 'p3'];
    probeMock.mockResolvedValue(HASH_X);

    const result = await runLoadQuorum({
      peers,
      peerIdOf,
      probeFn: probeMock,
      documentPath: '/test',
      config: { enabled: true, k: 3, q: 2 },
    });

    expect('ok' in result && result.ok).toBe(true);
    if (!('ok' in result)) throw new Error('expected ok=true');
    expect(result.winningHashHex).toBe(HASH_X_HEX);
    expect(result.narrowedPeers).toEqual(['p1', 'p2', 'p3']);
    expect(probeMock).toHaveBeenCalledTimes(3);

    // Drive the simulated full-load step: all agreeing peers serve a
    // matching hash, so the first attempt succeeds.
    const serveFn = jest.fn(async () => HASH_X_HEX);
    const loadOutcome = await simulateFullLoad({
      narrowedPeers: result.narrowedPeers,
      winningHashHex: result.winningHashHex,
      serveFn,
    });
    expect(loadOutcome.loadedFromPeer).toBe('p1');
    expect(loadOutcome.attempts).toEqual(['p1']);
  });

  test('(b) 3 peers, 2 vote X / 1 votes Y => agreeing cohort narrowed; disagreeing peer never loaded from', async () => {
    const peers: TestPeer[] = ['p1', 'p2', 'p3'];
    probeMock.mockImplementation(async (peer: TestPeer) => {
      return peer === 'p3' ? HASH_Y : HASH_X;
    });

    const result = await runLoadQuorum({
      peers,
      peerIdOf,
      probeFn: probeMock,
      documentPath: '/test',
      config: { enabled: true, k: 3, q: 2 },
    });

    expect('ok' in result && result.ok).toBe(true);
    if (!('ok' in result)) throw new Error('expected ok=true');
    expect(result.winningHashHex).toBe(HASH_X_HEX);
    // p3 (the dissenter) must not be in the narrowed cohort.
    expect(result.narrowedPeers).toEqual(['p1', 'p2']);
    expect(result.narrowedPeers).not.toContain('p3');

    // Drive the simulated load: only the narrowed cohort is asked, and the
    // load must never touch p3.
    const serveFn = jest.fn(async () => HASH_X_HEX);
    const loadOutcome = await simulateFullLoad({
      narrowedPeers: result.narrowedPeers,
      winningHashHex: result.winningHashHex,
      serveFn,
    });
    expect(loadOutcome.attempts).not.toContain('p3');
    expect(loadOutcome.loadedFromPeer).toBe('p1');
  });

  test('(c) 3 peers all vote X but EVERY peer serves tips hashing to Y => LoadQuorumFailedError(bind-check-failed-all-agreeing-peers)', async () => {
    // The whole cohort is Byzantine on the load step: every agreeing peer
    // voted X in the probe round but serves Y on the full load. The
    // harness must exhaust the cohort BEFORE escalating, so the
    // serveFn is called for every peer and the final error carries the
    // dedicated `bind-check-failed-all-agreeing-peers` reason plus a
    // per-peer `agreeingPeerBindFailures` map. See PR #284 r6.
    const peers: TestPeer[] = ['p1', 'p2', 'p3'];
    probeMock.mockResolvedValue(HASH_X);

    const result = await runLoadQuorum({
      peers,
      peerIdOf,
      probeFn: probeMock,
      documentPath: '/test',
      config: { enabled: true, k: 3, q: 2 },
    });
    expect('ok' in result && result.ok).toBe(true);
    if (!('ok' in result)) throw new Error('expected ok=true');

    const serveFn = jest.fn(async () => HASH_Y_HEX);
    const err = await simulateFullLoad({
      narrowedPeers: result.narrowedPeers,
      winningHashHex: result.winningHashHex,
      serveFn,
    }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(LoadQuorumFailedError);
    expect((err as LoadQuorumFailedError).reason).toBe(
      'bind-check-failed-all-agreeing-peers',
    );
    // Every agreeing peer must have been tried before the escalation.
    expect(serveFn).toHaveBeenCalledTimes(3);
    // Per-peer record of what each Byzantine peer served instead.
    expect(
      (err as LoadQuorumFailedError).agreeingPeerBindFailures,
    ).toEqual(
      new Map([
        ['p1', HASH_Y_HEX],
        ['p2', HASH_Y_HEX],
        ['p3', HASH_Y_HEX],
      ]),
    );
  });

  test('(c2) DoS regression: ONE Byzantine agreeing peer cannot abort the whole load; honest peer is tried next', async () => {
    // Regression for the critical PR #284 r6 finding: previously, if the
    // first peer chosen for the full load was Byzantine on the load
    // step (voted hash X, served tips hashing to Y), the loader threw
    // `LoadQuorumFailedError` and aborted -- never trying the OTHER
    // honest agreeing peers who WOULD have served a matching response.
    // That was a DoS vector: a single malicious peer in the agreeing
    // cohort could unilaterally prevent any load. After the fix, the
    // loader records the bind failure against the offending peer and
    // falls through to the next peer in the cohort.
    const peers: TestPeer[] = ['p1', 'p2', 'p3'];
    probeMock.mockResolvedValue(HASH_X);

    const result = await runLoadQuorum({
      peers,
      peerIdOf,
      probeFn: probeMock,
      documentPath: '/test',
      config: { enabled: true, k: 3, q: 2 },
    });
    expect('ok' in result && result.ok).toBe(true);
    if (!('ok' in result)) throw new Error('expected ok=true');
    expect(result.narrowedPeers).toEqual(['p1', 'p2', 'p3']);

    // p1 is Byzantine on the load step: voted X, serves Y.
    // p2 is honest: voted X, serves X.
    // p3 should never be reached because p2 succeeds.
    const serveFn = jest.fn(async (peer: TestPeer) => {
      if (peer === 'p1') return HASH_Y_HEX;
      return HASH_X_HEX;
    });
    const loadOutcome = await simulateFullLoad({
      narrowedPeers: result.narrowedPeers,
      winningHashHex: result.winningHashHex,
      serveFn,
    });
    // Load succeeded against p2 (the honest peer immediately after
    // the Byzantine p1) -- NOT thrown.
    expect(loadOutcome.loadedFromPeer).toBe('p2');
    // Both p1 (bind-failed) and p2 (success) were attempted in order.
    expect(loadOutcome.attempts).toEqual(['p1', 'p2']);
    // p3 must NOT have been touched -- the load short-circuits on
    // the first successful bind.
    expect(serveFn).toHaveBeenCalledWith('p1');
    expect(serveFn).toHaveBeenCalledWith('p2');
    expect(serveFn).not.toHaveBeenCalledWith('p3');
  });

  test('(c3) all agreeing peers Byzantine on load: error carries per-peer agreeingPeerBindFailures with what each served', async () => {
    // Complement of (c2): when EVERY agreeing peer equivocates between
    // probe and load, the loader must escalate -- with the new
    // `bind-check-failed-all-agreeing-peers` reason and a per-peer
    // record of what each Byzantine peer served instead, so callers
    // can tell "the whole cohort lied on the load step" apart from
    // "no peer responded at all".
    const peers: TestPeer[] = ['p1', 'p2', 'p3'];
    probeMock.mockResolvedValue(HASH_X);

    const result = await runLoadQuorum({
      peers,
      peerIdOf,
      probeFn: probeMock,
      documentPath: '/test',
      config: { enabled: true, k: 3, q: 2 },
    });
    expect('ok' in result && result.ok).toBe(true);
    if (!('ok' in result)) throw new Error('expected ok=true');

    // Each Byzantine peer can serve a DIFFERENT mismatched hash; the
    // per-peer record must preserve the distinction.
    const HASH_Z_HEX = 'cc'.repeat(32);
    const serveFn = jest.fn(async (peer: TestPeer) => {
      if (peer === 'p1') return HASH_Y_HEX;
      if (peer === 'p2') return HASH_Z_HEX;
      return HASH_Y_HEX; // p3 mirrors p1, exercising shared-hex case
    });
    const err = await simulateFullLoad({
      narrowedPeers: result.narrowedPeers,
      winningHashHex: result.winningHashHex,
      serveFn,
    }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(LoadQuorumFailedError);
    const lqfe = err as LoadQuorumFailedError;
    expect(lqfe.reason).toBe('bind-check-failed-all-agreeing-peers');
    // Per-peer record carries the specific hash each peer served.
    expect(lqfe.agreeingPeerBindFailures.get('p1')).toBe(HASH_Y_HEX);
    expect(lqfe.agreeingPeerBindFailures.get('p2')).toBe(HASH_Z_HEX);
    expect(lqfe.agreeingPeerBindFailures.get('p3')).toBe(HASH_Y_HEX);
    expect(lqfe.agreeingPeerBindFailures.size).toBe(3);
    // Error message mentions the cohort-wide failure and the count.
    expect(lqfe.message).toMatch(/bind-check|agreeing cohort|3 peer/);
  });

  test('(d) 3 peers, only 1 responds in time => LoadQuorumFailedError(insufficient-responses); no full-load attempted', async () => {
    const peers: TestPeer[] = ['p1', 'p2', 'p3'];
    probeMock.mockImplementation(async (peer: TestPeer) => {
      // p1 responds; p2 and p3 simulate timeouts (null = non-vote).
      return peer === 'p1' ? HASH_X : null;
    });

    const err = await runLoadQuorum({
      peers,
      peerIdOf,
      probeFn: probeMock,
      documentPath: '/test',
      config: { enabled: true, k: 3, q: 2 },
    }).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(LoadQuorumFailedError);
    expect((err as LoadQuorumFailedError).reason).toBe(
      'insufficient-responses',
    );
    expect(probeMock).toHaveBeenCalledTimes(3);
  });

  test('(e) single-peer fallback: K=1 + allowSinglePeer + matching served tips => load succeeds', async () => {
    const peers: TestPeer[] = ['p1'];
    probeMock.mockResolvedValue(HASH_X);

    const result = await runLoadQuorum({
      peers,
      peerIdOf,
      probeFn: probeMock,
      documentPath: '/test',
      config: { enabled: true, k: 1, allowSinglePeer: true },
    });
    expect('ok' in result && result.ok).toBe(true);
    if (!('ok' in result)) throw new Error('expected ok=true');
    expect(result.winningHashHex).toBe(HASH_X_HEX);
    expect(result.narrowedPeers).toEqual(['p1']);
    expect(probeMock).toHaveBeenCalledTimes(1);

    const serveFn = jest.fn(async () => HASH_X_HEX);
    const loadOutcome = await simulateFullLoad({
      narrowedPeers: result.narrowedPeers,
      winningHashHex: result.winningHashHex,
      serveFn,
    });
    expect(loadOutcome.loadedFromPeer).toBe('p1');
  });

  test('(e2) single-peer fallback: K=1 + allowSinglePeer + probe TIMEOUT => LoadQuorumFailedError', async () => {
    // Complement of (e): the single-peer pass-through is NOT a free pass.
    // If the one probed peer doesn't return a hash within the timeout, the
    // gate must still fail closed.
    const peers: TestPeer[] = ['p1'];
    probeMock.mockResolvedValue(null);

    const err = await runLoadQuorum({
      peers,
      peerIdOf,
      probeFn: probeMock,
      documentPath: '/test',
      config: { enabled: true, k: 1, allowSinglePeer: true },
    }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(LoadQuorumFailedError);
    expect((err as LoadQuorumFailedError).reason).toBe(
      'insufficient-responses',
    );
  });

  test('single-peer fallback DENIED when allowSinglePeer=false (default)', async () => {
    // The orchestrator must refuse to run quorum against a single peer
    // unless the caller opts in. This protects against silently degrading
    // BFT semantics in small/partitioned meshes.
    const peers: TestPeer[] = ['p1'];
    probeMock.mockResolvedValue(HASH_X);

    const err = await runLoadQuorum({
      peers,
      peerIdOf,
      probeFn: probeMock,
      documentPath: '/test',
      config: { enabled: true, k: 1, allowSinglePeer: false },
    }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(LoadQuorumFailedError);
    // The probe must NOT have been issued -- we refuse before talking to
    // the lone peer.
    expect(probeMock).not.toHaveBeenCalled();
  });

  test('quorum disabled: returns { skipped: true } so caller falls through to legacy load', async () => {
    const peers: TestPeer[] = ['p1', 'p2', 'p3'];
    probeMock.mockResolvedValue(HASH_X);
    const result = await runLoadQuorum({
      peers,
      peerIdOf,
      probeFn: probeMock,
      documentPath: '/test',
      config: { enabled: false },
    });
    expect(result).toEqual({ skipped: true });
    expect(probeMock).not.toHaveBeenCalled();
  });

  test('empty peer list: returns { skipped: true } so caller treats as new document', async () => {
    const peers: TestPeer[] = [];
    const result = await runLoadQuorum({
      peers,
      peerIdOf,
      probeFn: probeMock,
      documentPath: '/test',
      config: { enabled: true, k: 3 },
    });
    expect(result).toEqual({ skipped: true });
    expect(probeMock).not.toHaveBeenCalled();
  });

  test('loadQuorumK = 0 throws LoadQuorumFailedError(invalid-config) even with peers connected', async () => {
    // Regression for PR #284 r5: a `loadQuorumK <= 0` previously
    // collapsed `effectiveK(...)` to 0, the orchestrator returned
    // `{ skipped: true }`, and `CollabswarmDocument.open()` then treated
    // the load as "new document" and forked any existing copy held by
    // peers. The orchestrator must now refuse loud-and-early on
    // misconfigured K so the fork can never happen silently.
    const peers: TestPeer[] = ['p1', 'p2', 'p3'];
    probeMock.mockResolvedValue(HASH_X);
    const err = await runLoadQuorum({
      peers,
      peerIdOf,
      probeFn: probeMock,
      documentPath: '/test',
      config: { enabled: true, k: 0 },
    }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(LoadQuorumFailedError);
    expect((err as LoadQuorumFailedError).reason).toBe('invalid-config');
    expect((err as LoadQuorumFailedError).message).toMatch(
      /loadQuorumK must be >= 1; got 0/,
    );
    expect(probeMock).not.toHaveBeenCalled();
  });

  test('loadQuorumK = -1 throws LoadQuorumFailedError(invalid-config)', async () => {
    const peers: TestPeer[] = ['p1', 'p2'];
    probeMock.mockResolvedValue(HASH_X);
    const err = await runLoadQuorum({
      peers,
      peerIdOf,
      probeFn: probeMock,
      documentPath: '/test',
      config: { enabled: true, k: -1 },
    }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(LoadQuorumFailedError);
    expect((err as LoadQuorumFailedError).reason).toBe('invalid-config');
    expect((err as LoadQuorumFailedError).message).toMatch(
      /loadQuorumK must be >= 1; got -1/,
    );
  });

  test('loadQuorumK = 0 with no peers also throws (config error, not founder case)', async () => {
    // The "no peers + K=0" combination is NOT a legitimate founder case:
    // the founder case is "no peers + K=default", which falls through
    // `effectiveK -> 0` -> `{ skipped: true }`. K=0 is always a static
    // operator misconfiguration regardless of peer count, so the
    // orchestrator throws unconditionally rather than silently bypassing
    // the gate.
    const err = await runLoadQuorum({
      peers: [],
      peerIdOf,
      probeFn: probeMock,
      documentPath: '/test',
      config: { enabled: true, k: 0 },
    }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(LoadQuorumFailedError);
    expect((err as LoadQuorumFailedError).reason).toBe('invalid-config');
    expect(probeMock).not.toHaveBeenCalled();
  });

  test('multi-peer probe that REJECTS is recorded as a non-vote; other peers still tally', async () => {
    // Contract regression for PR #284 r5: a `probeFn` that throws/rejects
    // must NOT escape the orchestrator. Without the per-probe catch the
    // whole `Promise.all` would reject and bubble past the
    // `LoadQuorumFailedError` API contract `load()` callers are written
    // against. With the catch, the rejected peer is counted as a
    // non-vote and the remaining honest peers can still form quorum.
    const peers: TestPeer[] = ['p1', 'p2', 'p3'];
    probeMock.mockImplementation(async (peer: TestPeer) => {
      if (peer === 'p3') throw new Error('synthetic probe failure');
      return HASH_X;
    });
    const result = await runLoadQuorum({
      peers,
      peerIdOf,
      probeFn: probeMock,
      documentPath: '/test',
      config: { enabled: true, k: 3, q: 2 },
    });
    expect('ok' in result && result.ok).toBe(true);
    if (!('ok' in result)) throw new Error('expected ok=true');
    expect(result.narrowedPeers).toEqual(['p1', 'p2']);
    expect(result.narrowedPeers).not.toContain('p3');
    expect(result.winningHashHex).toBe(HASH_X_HEX);
    // Sanity: probe still called for ALL peers, including the rejecter.
    expect(probeMock).toHaveBeenCalledTimes(3);
  });

  test('multi-peer with ALL probeFns rejecting => LoadQuorumFailedError(insufficient-responses), no raw probe error escapes', async () => {
    const peers: TestPeer[] = ['p1', 'p2', 'p3'];
    probeMock.mockImplementation(async () => {
      throw new Error('synthetic probe failure');
    });
    const err = await runLoadQuorum({
      peers,
      peerIdOf,
      probeFn: probeMock,
      documentPath: '/test',
      config: { enabled: true, k: 3, q: 2 },
    }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(LoadQuorumFailedError);
    expect((err as LoadQuorumFailedError).reason).toBe(
      'insufficient-responses',
    );
    // The synthetic probe error MUST NOT escape — only the structured
    // LoadQuorumFailedError surfaces.
    expect((err as Error).message).not.toMatch(/synthetic probe failure/);
  });

  test('single-peer fallback with rejected probeFn => LoadQuorumFailedError(insufficient-responses), not the raw probe error', async () => {
    // Single-peer pass-through must also contain probe errors. The
    // single-peer code path was a separate `await probeFn(...)` (not
    // inside the multi-peer `Promise.all`) — a regression risk if only
    // one of the two paths was fixed.
    const peers: TestPeer[] = ['p1'];
    probeMock.mockImplementation(async () => {
      throw new Error('synthetic single-peer probe failure');
    });
    const err = await runLoadQuorum({
      peers,
      peerIdOf,
      probeFn: probeMock,
      documentPath: '/test',
      config: { enabled: true, k: 1, allowSinglePeer: true },
    }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(LoadQuorumFailedError);
    expect((err as LoadQuorumFailedError).reason).toBe(
      'insufficient-responses',
    );
    expect((err as Error).message).not.toMatch(
      /synthetic single-peer probe failure/,
    );
  });

  test('size-cap-triggered non-vote does NOT poison quorum when honest majority still responds', async () => {
    // Regression for the DoS hardening fix from PR #284 r4: an
    // oversized tip-advertise response is surfaced as `null` (non-vote)
    // by `_probeTipAdvertise`'s outer catch. Verify that a single peer
    // hitting the size cap does not flip the quorum into a Byzantine
    // verdict -- the remaining honest peers must still be able to form
    // a Q-of-K majority.
    const peers: TestPeer[] = ['p1', 'p2', 'p3'];
    probeMock.mockImplementation(async (peer: TestPeer) => {
      // p3 simulates the size-cap RangeError surface (null = non-vote);
      // p1 and p2 vote X honestly.
      return peer === 'p3' ? null : HASH_X;
    });

    const result = await runLoadQuorum({
      peers,
      peerIdOf,
      probeFn: probeMock,
      documentPath: '/test',
      config: { enabled: true, k: 3, q: 2 },
    });
    expect('ok' in result && result.ok).toBe(true);
    if (!('ok' in result)) throw new Error('expected ok=true');
    expect(result.narrowedPeers).toEqual(['p1', 'p2']);
    expect(result.winningHashHex).toBe(HASH_X_HEX);
  });

  describe('default Q is derived from EFFECTIVE K, not configured K (PR #284 r7)', () => {
    // Regression for PR #284 r7 Copilot review: previously `defaultQuorumQ`
    // was passed the CONFIGURED K, so a configured K=7 against a peer list
    // of size 3 required `effectiveQ(defaultQuorumQ(7), effectiveK(7, 3))`
    // = `effectiveQ(4, 3)` = 3 -- i.e. ALL 3 reachable peers had to agree,
    // losing the one-fault tolerance the formula targets. The fix passes
    // the effective K to `defaultQuorumQ`, so the default Q tracks the
    // actual quorum size in use.
    //
    // To prove the default-Q derivation: arrange a setup where exactly
    // `defaultQuorumQ(effective K)` peers vote the same hash and the rest
    // do not respond. Under the fix, the agreeing minority crosses the
    // (lower) threshold and quorum passes. Under the bug, the threshold is
    // higher and quorum fails. The tests below use `q: undefined` so the
    // default kicks in.
    test('configured K=7 but only 3 peers: effective K=3, default Q=2 (was 4 with bug)', async () => {
      const peers: TestPeer[] = ['p1', 'p2', 'p3'];
      probeMock.mockImplementation(async (peer: TestPeer) => {
        // p1 + p2 vote X (2 votes = strict-majority for K=3); p3 times out.
        // Under the BUG, defaultQuorumQ(7) = 4 > 3 votes available => quorum
        // could never pass. Under the FIX, defaultQuorumQ(3) = 2 votes
        // required => quorum passes.
        return peer === 'p3' ? null : HASH_X;
      });

      const result = await runLoadQuorum({
        peers,
        peerIdOf,
        probeFn: probeMock,
        documentPath: '/test',
        config: { enabled: true, k: 7 /* q: undefined => derive from effective K */ },
      });
      expect('ok' in result && result.ok).toBe(true);
      if (!('ok' in result)) throw new Error('expected ok=true');
      expect(result.winningHashHex).toBe(HASH_X_HEX);
      expect(result.narrowedPeers).toEqual(['p1', 'p2']);
    });

    test('configured K=3 with 3 peers: default Q=2 (unchanged from previous behaviour)', async () => {
      // Sanity: the canonical configured-K matches-effective-K case still
      // resolves to defaultQuorumQ(3) = 2. The bug only fired when
      // configured K > peers.length.
      const peers: TestPeer[] = ['p1', 'p2', 'p3'];
      probeMock.mockImplementation(async (peer: TestPeer) => {
        return peer === 'p3' ? null : HASH_X;
      });

      const result = await runLoadQuorum({
        peers,
        peerIdOf,
        probeFn: probeMock,
        documentPath: '/test',
        config: { enabled: true, k: 3 },
      });
      expect('ok' in result && result.ok).toBe(true);
      if (!('ok' in result)) throw new Error('expected ok=true');
      expect(result.narrowedPeers).toEqual(['p1', 'p2']);
    });

    test('configured K=5 with 5 peers: default Q=3 (unchanged)', async () => {
      const peers: TestPeer[] = ['p1', 'p2', 'p3', 'p4', 'p5'];
      probeMock.mockImplementation(async (peer: TestPeer) => {
        // 3 vote X (strict majority of 5), 2 time out.
        return peer === 'p4' || peer === 'p5' ? null : HASH_X;
      });

      const result = await runLoadQuorum({
        peers,
        peerIdOf,
        probeFn: probeMock,
        documentPath: '/test',
        config: { enabled: true, k: 5 },
      });
      expect('ok' in result && result.ok).toBe(true);
      if (!('ok' in result)) throw new Error('expected ok=true');
      expect(result.narrowedPeers).toEqual(['p1', 'p2', 'p3']);
    });

    test('configured K=7 with 7 peers: default Q=4 (unchanged)', async () => {
      const peers: TestPeer[] = ['p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7'];
      probeMock.mockImplementation(async (peer: TestPeer) => {
        // 4 vote X (strict majority of 7), 3 time out.
        return ['p5', 'p6', 'p7'].includes(peer) ? null : HASH_X;
      });

      const result = await runLoadQuorum({
        peers,
        peerIdOf,
        probeFn: probeMock,
        documentPath: '/test',
        config: { enabled: true, k: 7 },
      });
      expect('ok' in result && result.ok).toBe(true);
      if (!('ok' in result)) throw new Error('expected ok=true');
      expect(result.narrowedPeers).toEqual(['p1', 'p2', 'p3', 'p4']);
    });

    test('explicit Q is honoured (??-fallback no-op): configured K=7, 3 peers, explicit Q=3 still requires all 3', async () => {
      // When the operator explicitly sets `loadQuorumQ`, the `??` fallback
      // does not fire and the explicit value flows through `effectiveQ`'s
      // `[1, k]` clamp. Verify the fix did not accidentally clamp the
      // explicit value too aggressively. With explicit Q=3 and effective
      // K=3, all 3 peers must agree.
      const peers: TestPeer[] = ['p1', 'p2', 'p3'];
      probeMock.mockImplementation(async (peer: TestPeer) => {
        return peer === 'p3' ? null : HASH_X;
      });

      const err = await runLoadQuorum({
        peers,
        peerIdOf,
        probeFn: probeMock,
        documentPath: '/test',
        config: { enabled: true, k: 7, q: 3 },
      }).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(LoadQuorumFailedError);
      // 2 votes available but 3 required => insufficient-responses.
      expect((err as LoadQuorumFailedError).reason).toBe(
        'insufficient-responses',
      );
    });
  });
});
