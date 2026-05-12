import { describe, expect, test } from '@jest/globals';
import { tipsHash, tipsHashToHex, TIPS_HASH_LENGTH } from './tips-hash';

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
