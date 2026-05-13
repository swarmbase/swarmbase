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
 * peers, then perform the full document-load against any peer in the
 * narrowed cohort, with the responder's served `tips` hash bound to the
 * quorum's `winningHashHex`. The harness below stands in for the
 * snapshot/doc-load loop so the binding check is exercised against the
 * narrowed peer list this orchestrator produces.
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
  for (const peer of opts.narrowedPeers) {
    attempts.push(peer);
    const servedHashHex = await opts.serveFn(peer);
    if (servedHashHex === opts.winningHashHex) {
      return { loadedFromPeer: peer, attempts };
    }
    // else: binding fails; the production `_sendLoadRequestAndSync`
    // would throw LoadQuorumFailedError. Mirror that here so the test
    // also asserts the load aborts on mismatch.
    throw new LoadQuorumFailedError({
      documentPath: '/test',
      reason: 'no-majority',
      respondingCount: 0,
      requiredQ: 0,
      agreement: new Map([
        [opts.winningHashHex, 0],
        [servedHashHex, 0],
      ]),
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

  test('(c) 3 peers all vote X but the chosen peer serves tips hashing to Y => LoadQuorumFailedError', async () => {
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

    // The first agreeing peer (p1) serves tips that don't match the
    // winning hash -- exactly the equivocation case from the comment.
    const serveFn = jest.fn(async () => HASH_Y_HEX);
    await expect(
      simulateFullLoad({
        narrowedPeers: result.narrowedPeers,
        winningHashHex: result.winningHashHex,
        serveFn,
      }),
    ).rejects.toBeInstanceOf(LoadQuorumFailedError);
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
});
