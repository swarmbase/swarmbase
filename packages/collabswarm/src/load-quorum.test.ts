import { describe, expect, test } from '@jest/globals';
import {
  constantTimeHexEquals,
  decideLoadQuorum,
  dedupePeersByPeerId,
  defaultQuorumQ,
  effectiveK,
  effectiveQ,
  LoadQuorumFailedError,
} from './load-quorum';

function bytes(hex: string): Uint8Array {
  if (hex.length % 2 !== 0) {
    throw new Error('hex must be even-length');
  }
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(hex.substring(i * 2, i * 2 + 2), 16);
  }
  return out;
}

const HASH_A = bytes('aa'.repeat(32));
const HASH_B = bytes('bb'.repeat(32));
const HASH_C = bytes('cc'.repeat(32));

describe('decideLoadQuorum (initial-load quorum gate, #189 §5.4.2)', () => {
  test('3-of-3 agreement passes quorum (Q=2)', () => {
    const decision = decideLoadQuorum(
      [
        { peerId: 'p1', hash: HASH_A },
        { peerId: 'p2', hash: HASH_A },
        { peerId: 'p3', hash: HASH_A },
      ],
      2,
    );
    expect(decision.ok).toBe(true);
    if (decision.ok) {
      expect(decision.respondingCount).toBe(3);
      expect(decision.agreeingPeerIds).toEqual(['p1', 'p2', 'p3']);
    }
  });

  test('2-of-3 agreement still meets Q=2', () => {
    const decision = decideLoadQuorum(
      [
        { peerId: 'p1', hash: HASH_A },
        { peerId: 'p2', hash: HASH_A },
        { peerId: 'p3', hash: HASH_B },
      ],
      2,
    );
    expect(decision.ok).toBe(true);
    if (decision.ok) {
      expect(decision.agreeingPeerIds).toEqual(['p1', 'p2']);
    }
  });

  test('3-way disagreement fails quorum (no-majority)', () => {
    const decision = decideLoadQuorum(
      [
        { peerId: 'p1', hash: HASH_A },
        { peerId: 'p2', hash: HASH_B },
        { peerId: 'p3', hash: HASH_C },
      ],
      2,
    );
    expect(decision.ok).toBe(false);
    if (!decision.ok) {
      expect(decision.reason).toBe('no-majority');
      expect(decision.respondingCount).toBe(3);
      expect(decision.agreement.size).toBe(3);
    }
  });

  test('timeouts (null hashes) are not counted as disagreement', () => {
    // Two real votes for HASH_A, one timeout. With Q=2 this should pass:
    // the timeout is a non-vote, not a disagreement.
    const decision = decideLoadQuorum(
      [
        { peerId: 'p1', hash: HASH_A },
        { peerId: 'p2', hash: HASH_A },
        { peerId: 'p3', hash: null },
      ],
      2,
    );
    expect(decision.ok).toBe(true);
    if (decision.ok) {
      expect(decision.respondingCount).toBe(2);
      expect(decision.agreeingPeerIds).toEqual(['p1', 'p2']);
    }
  });

  test('all timeouts fails with insufficient-responses', () => {
    const decision = decideLoadQuorum(
      [
        { peerId: 'p1', hash: null },
        { peerId: 'p2', hash: null },
        { peerId: 'p3', hash: null },
      ],
      2,
    );
    expect(decision.ok).toBe(false);
    if (!decision.ok) {
      expect(decision.reason).toBe('insufficient-responses');
      expect(decision.respondingCount).toBe(0);
    }
  });

  test('empty advertisement list fails with no-peers-queried', () => {
    const decision = decideLoadQuorum([], 2);
    expect(decision.ok).toBe(false);
    if (!decision.ok) {
      expect(decision.reason).toBe('no-peers-queried');
    }
  });

  test('single peer with Q=1 (allowSinglePeer path) passes', () => {
    const decision = decideLoadQuorum(
      [{ peerId: 'p1', hash: HASH_A }],
      1,
    );
    expect(decision.ok).toBe(true);
    if (decision.ok) {
      expect(decision.agreeingPeerIds).toEqual(['p1']);
    }
  });

  test('single peer with Q=2 (allowSinglePeer false) fails', () => {
    const decision = decideLoadQuorum(
      [{ peerId: 'p1', hash: HASH_A }],
      2,
    );
    expect(decision.ok).toBe(false);
    if (!decision.ok) {
      expect(decision.reason).toBe('insufficient-responses');
    }
  });

  test('two byte-identical hashes from different instances collide on the same bucket', () => {
    // Reference inequality, value equality.
    const a1 = bytes('11'.repeat(32));
    const a2 = bytes('11'.repeat(32));
    expect(a1).not.toBe(a2);
    const decision = decideLoadQuorum(
      [
        { peerId: 'p1', hash: a1 },
        { peerId: 'p2', hash: a2 },
      ],
      2,
    );
    expect(decision.ok).toBe(true);
  });
});

describe('effectiveK / effectiveQ', () => {
  test('effectiveK clamps to known-peer count', () => {
    expect(effectiveK(3, 5)).toBe(3);
    expect(effectiveK(3, 2)).toBe(2);
    expect(effectiveK(3, 0)).toBe(0);
    expect(effectiveK(0, 5)).toBe(0);
  });

  test('effectiveQ clamps to [1, K]', () => {
    expect(effectiveQ(2, 3)).toBe(2);
    expect(effectiveQ(5, 3)).toBe(3); // Q > K -> K
    expect(effectiveQ(0, 3)).toBe(1); // Q < 1 -> 1
    expect(effectiveQ(-1, 3)).toBe(1);
    expect(effectiveQ(2, 0)).toBe(0); // no peers -> no quorum possible
  });
});

describe('defaultQuorumQ (strict-majority formula, #189 §5.4.2)', () => {
  // The PR description and config docstring require strict majority — i.e.
  // `Math.floor(K/2) + 1`, NOT `Math.ceil(K/2) + 1`. The earlier ceil-based
  // default produced Q=3 at K=3, which made the gate refuse to pass with
  // even one non-vote and silently defeated the BFT intent ("tolerate one
  // fault"). These tests pin the formula so a future change has to
  // explicitly justify breaking the matrix.
  test('K=1 -> Q=1', () => {
    expect(defaultQuorumQ(1)).toBe(1);
  });
  test('K=2 -> Q=2', () => {
    expect(defaultQuorumQ(2)).toBe(2);
  });
  test('K=3 -> Q=2 (one fault tolerated, NOT three-of-three)', () => {
    expect(defaultQuorumQ(3)).toBe(2);
  });
  test('K=4 -> Q=3', () => {
    expect(defaultQuorumQ(4)).toBe(3);
  });
  test('K=5 -> Q=3', () => {
    expect(defaultQuorumQ(5)).toBe(3);
  });
  test('K=7 -> Q=4', () => {
    expect(defaultQuorumQ(7)).toBe(4);
  });
  test('K=0 -> Q=0 (no peers, no quorum possible)', () => {
    expect(defaultQuorumQ(0)).toBe(0);
  });
  test('K<0 -> Q=0 (clamped)', () => {
    expect(defaultQuorumQ(-1)).toBe(0);
  });

  test('rejects the legacy ceil-based formula at K=3', () => {
    // Math.ceil(3 / 2) + 1 === 3 — would require all three peers to agree,
    // refusing a single timeout. defaultQuorumQ must NOT return 3 here.
    expect(defaultQuorumQ(3)).not.toBe(Math.ceil(3 / 2) + 1);
  });
});

describe('dedupePeersByPeerId (multi-connection vote inflation, #186)', () => {
  // libp2p's `getConnections()` returns one entry per OPEN connection, not
  // per remote peer. A peer with both a direct and a relay-circuit
  // connection shows up twice; without dedup they cast two quorum votes,
  // letting a single malicious peer with two connections out-vote one
  // honest peer.
  test('collapses two entries with the same peerId into one', () => {
    const peers = [
      { addr: '/ip4/1.1.1.1/tcp/1/p2p/A' },
      { addr: '/ip4/2.2.2.2/tcp/2/p2p/A' }, // same peerId A, different multiaddr
      { addr: '/ip4/3.3.3.3/tcp/3/p2p/B' },
    ];
    const out = dedupePeersByPeerId(peers, (p) => {
      const m = [...p.addr.matchAll(/\/p2p\/([^/]+)/g)];
      return m.length > 0 ? m[m.length - 1][1] : p.addr;
    });
    expect(out).toHaveLength(2);
    expect(out[0].addr).toBe('/ip4/1.1.1.1/tcp/1/p2p/A');
    expect(out[1].addr).toBe('/ip4/3.3.3.3/tcp/3/p2p/B');
  });

  test('preserves first-seen order (preferredPeer at index 0 stays first)', () => {
    const peers = ['preferred', 'a', 'preferred', 'b', 'a'];
    const out = dedupePeersByPeerId(peers, (s) => s);
    expect(out).toEqual(['preferred', 'a', 'b']);
  });

  test('treats relay-circuit + direct multiaddrs of one peer as one vote', () => {
    // Real-world case: a peer reachable both directly and via a relay
    // circuit shows up as `.../p2p/<remote>` and `.../p2p/<relay>/p2p-circuit/p2p/<remote>`.
    // `_peerIdOf` extracts the LAST `/p2p/<id>` (the remote peer id), so
    // both entries collapse to the same key.
    const peers = [
      { addr: '/ip4/1.1.1.1/tcp/9000/p2p/Q' },
      { addr: '/ip4/2.2.2.2/tcp/9001/p2p/R/p2p-circuit/p2p/Q' },
    ];
    const out = dedupePeersByPeerId(peers, (p) => {
      const m = [...p.addr.matchAll(/\/p2p\/([^/]+)/g)];
      return m.length > 0 ? m[m.length - 1][1] : p.addr;
    });
    expect(out).toHaveLength(1);
  });

  test('empty input returns empty output', () => {
    expect(dedupePeersByPeerId([], (s: string) => s)).toEqual([]);
  });

  test('does not mutate the input array', () => {
    const input = ['a', 'a', 'b'];
    const out = dedupePeersByPeerId(input, (s) => s);
    expect(input).toEqual(['a', 'a', 'b']);
    expect(out).toEqual(['a', 'b']);
  });
});

describe('founding-case removal (#186, suppressed comment fix)', () => {
  // Regression coverage for the unsafe `_hashes.size === 0` bypass. Before
  // this fix, the loader skipped the quorum gate whenever its local
  // `_hashes` was empty on the theory that an empty set could not be
  // "poisoned" — but `_hashes` is ALSO empty on the very first `open()` of
  // an EXISTING document (before load populates it), which is exactly the
  // case the quorum check is meant to defend. The fix removes the bypass
  // entirely; the gate now runs uniformly. These tests verify that the
  // decision logic does not give the gate any escape hatch keyed on the
  // local hash-set state — the only legitimate "no quorum" paths are
  // `k === 0` (no peers at all) and the explicit `allowSinglePeer` knob.
  test('with K>=2 known peers, decideLoadQuorum still requires Q votes regardless of caller state', () => {
    // Caller passes Q=2; a single agreeing vote (the rest non-votes) is
    // not enough. This holds whether the caller is a fresh founder or
    // a partitioned existing-document opener — `decideLoadQuorum` is
    // stateless w.r.t. the caller, by design.
    const decision = decideLoadQuorum(
      [
        { peerId: 'p1', hash: new Uint8Array(32).fill(0xaa) },
        { peerId: 'p2', hash: null },
        { peerId: 'p3', hash: null },
      ],
      2,
    );
    expect(decision.ok).toBe(false);
    if (!decision.ok) {
      expect(decision.reason).toBe('insufficient-responses');
    }
  });

  test('effectiveK + defaultQuorumQ together force the gate on K>=2 even when local state is empty', () => {
    // Simulate "fresh open with peers available": local hashes empty
    // (irrelevant to these pure helpers), known peers = 3, configured K = 3.
    const k = effectiveK(3, 3);
    const q = effectiveQ(defaultQuorumQ(3), k);
    expect(k).toBe(3);
    expect(q).toBe(2); // strict majority; founders no longer get a free pass
  });
});

describe('constantTimeHexEquals (hash-binding comparison)', () => {
  test('equal lowercase hex strings compare equal', () => {
    expect(constantTimeHexEquals('aa'.repeat(32), 'aa'.repeat(32))).toBe(true);
  });

  test('different hex strings of the same length compare unequal', () => {
    expect(constantTimeHexEquals('aa'.repeat(32), 'ab'.repeat(32))).toBe(false);
  });

  test('strings of different lengths compare unequal', () => {
    expect(constantTimeHexEquals('aa', 'aabb')).toBe(false);
  });

  test('empty strings compare equal', () => {
    expect(constantTimeHexEquals('', '')).toBe(true);
  });

  test('case-sensitive (matches `tipsHashToHex` lowercase output)', () => {
    expect(constantTimeHexEquals('aabb', 'AABB')).toBe(false);
  });
});

describe('LoadQuorumFailedError', () => {
  test('carries structured fields for application-level recovery', () => {
    const err = new LoadQuorumFailedError({
      documentPath: '/docs/x',
      reason: 'no-majority',
      respondingCount: 3,
      requiredQ: 2,
      agreement: new Map([
        ['aa', 1],
        ['bb', 1],
        ['cc', 1],
      ]),
    });
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe('LoadQuorumFailedError');
    expect(err.documentPath).toBe('/docs/x');
    expect(err.reason).toBe('no-majority');
    expect(err.respondingCount).toBe(3);
    expect(err.requiredQ).toBe(2);
    expect(err.agreement.size).toBe(3);
    expect(err.message).toMatch(/quorum failed/i);
  });

  test("invalid-config reason carries operator-visible detail (PR #284 r5)", () => {
    // The 'invalid-config' variant is surfaced by `runLoadQuorum` when
    // `loadQuorumK <= 0`, where the structured `respondingCount`/
    // `requiredQ` fields are not meaningful (no probes were run). The
    // `detail` constructor field is the surface used to carry the
    // offending value into the operator-visible message.
    const err = new LoadQuorumFailedError({
      documentPath: '/docs/x',
      reason: 'invalid-config',
      respondingCount: 0,
      requiredQ: 0,
      agreement: new Map(),
      detail: 'loadQuorumK must be >= 1; got 0',
    });
    expect(err.reason).toBe('invalid-config');
    expect(err.message).toMatch(/loadQuorumK must be >= 1; got 0/);
  });
});
