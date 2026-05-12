import { describe, expect, test } from '@jest/globals';
import {
  decideLoadQuorum,
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
});
