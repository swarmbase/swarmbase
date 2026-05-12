import { describe, expect, test } from '@jest/globals';
import { tipsHash, tipsHashToHex, TIPS_HASH_LENGTH } from './tips-hash';
import { constantTimeHexEquals } from './load-quorum';

describe('tipsHash (initial-load quorum, #189 §5.4.2)', () => {
  test('returns a 32-byte SHA-256 digest', async () => {
    const hash = await tipsHash(['bafy1', 'bafy2']);
    expect(hash).toBeInstanceOf(Uint8Array);
    expect(hash.length).toBe(TIPS_HASH_LENGTH);
  });

  test('is deterministic regardless of input order', async () => {
    const a = await tipsHash(['bafy1', 'bafy2', 'bafy3']);
    const b = await tipsHash(['bafy3', 'bafy1', 'bafy2']);
    expect(tipsHashToHex(a)).toBe(tipsHashToHex(b));
  });

  test('accepts a Set<string> and matches the array form', async () => {
    const fromSet = await tipsHash(new Set(['bafy1', 'bafy2']));
    const fromArr = await tipsHash(['bafy2', 'bafy1']);
    expect(tipsHashToHex(fromSet)).toBe(tipsHashToHex(fromArr));
  });

  test('different tip sets produce different hashes', async () => {
    const a = await tipsHash(['bafy1', 'bafy2']);
    const b = await tipsHash(['bafy1', 'bafy3']);
    expect(tipsHashToHex(a)).not.toBe(tipsHashToHex(b));
  });

  test('empty tip set has a stable hash (founding-member case)', async () => {
    const a = await tipsHash([]);
    const b = await tipsHash(new Set<string>());
    expect(tipsHashToHex(a)).toBe(tipsHashToHex(b));
    expect(a.length).toBe(TIPS_HASH_LENGTH);
  });

  test('boundary-ambiguous inputs do not collide (separator works)', async () => {
    // If the canonicalizer concatenated CIDs without a separator,
    // ["ab", "c"] and ["a", "bc"] would hash identically.
    const a = await tipsHash(['ab', 'c']);
    const b = await tipsHash(['a', 'bc']);
    expect(tipsHashToHex(a)).not.toBe(tipsHashToHex(b));
  });

  test('does not mutate the caller-provided collection', async () => {
    const input = ['z', 'a', 'm'];
    await tipsHash(input);
    expect(input).toEqual(['z', 'a', 'm']);
  });
});

describe('tipsHashToHex', () => {
  test('produces lowercase hex of correct length', () => {
    const bytes = new Uint8Array([0x00, 0x0f, 0xff, 0xab]);
    expect(tipsHashToHex(bytes)).toBe('000fffab');
  });
});

describe('hash binding: equivocating peer rejection (#186, suppressed comment fix)', () => {
  // Models `CollabswarmDocument._enforceQuorumHashBinding`. The quorum-agreed
  // hash (the "vote") must match the recomputed `tipsHash` of the
  // locally-applied state (the "serve"). A peer that votes for tip set X
  // but serves a load whose tips hash to Y is treated as Byzantine
  // equivocation and rejected — without this binding, a malicious peer
  // in the agreeing cohort could vote with the majority and then serve
  // arbitrary state, completely defeating the gate.
  test('matching vote and serve passes the binding check', async () => {
    const advertisedTips = ['cidA', 'cidB', 'cidC'];
    const servedTips = ['cidC', 'cidA', 'cidB']; // same set, different order
    const advertisedHex = tipsHashToHex(await tipsHash(advertisedTips));
    const servedHex = tipsHashToHex(await tipsHash(servedTips));
    expect(constantTimeHexEquals(advertisedHex, servedHex)).toBe(true);
  });

  test('mismatched vote vs serve fails the binding check', async () => {
    const advertisedTips = ['cidA', 'cidB'];
    // Malicious peer voted for {A,B} but then served only {A} — the
    // served state has a different tipsHash and the binding catches it.
    const servedTips = ['cidA'];
    const advertisedHex = tipsHashToHex(await tipsHash(advertisedTips));
    const servedHex = tipsHashToHex(await tipsHash(servedTips));
    expect(constantTimeHexEquals(advertisedHex, servedHex)).toBe(false);
  });

  test('extra-CID injection (vote {A,B}, serve {A,B,evil}) fails the binding check', async () => {
    // The most security-critical case: the agreeing cohort attested to
    // {A,B} but a member sneaks in an extra "evil" CID in the load
    // response. Post-sync `tipsHash(_hashes)` reflects {A,B,evil}, which
    // does NOT match the voted `winningHashHex`.
    const advertisedHex = tipsHashToHex(await tipsHash(['cidA', 'cidB']));
    const servedHex = tipsHashToHex(
      await tipsHash(['cidA', 'cidB', 'cidEvil']),
    );
    expect(constantTimeHexEquals(advertisedHex, servedHex)).toBe(false);
  });

  test('empty-set vote vs non-empty serve fails (founding-case spoof)', async () => {
    // A peer that voted "I have nothing" (empty tip-set hash) but then
    // serves a non-empty document must be rejected — the founding-case
    // bypass that this fix removes would otherwise let this through.
    const advertisedHex = tipsHashToHex(await tipsHash([]));
    const servedHex = tipsHashToHex(await tipsHash(['cidA']));
    expect(constantTimeHexEquals(advertisedHex, servedHex)).toBe(false);
  });
});
