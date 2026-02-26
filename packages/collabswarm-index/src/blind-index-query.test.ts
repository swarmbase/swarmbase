import { describe, expect, test, beforeAll } from '@jest/globals';
import { SubtleBlindIndexProvider } from './subtle-blind-index-provider';
import { BlindIndexQuery, BlindIndexEntry } from './blind-index-query';

describe('BlindIndexQuery', () => {
  let provider: SubtleBlindIndexProvider;
  let query: BlindIndexQuery;
  let masterKey: CryptoKey;
  let nameKey: CryptoKey;

  beforeAll(async () => {
    provider = new SubtleBlindIndexProvider();
    query = new BlindIndexQuery(provider);
    masterKey = await crypto.subtle.generateKey(
      { name: 'HMAC', hash: 'SHA-256' },
      true,
      ['sign'],
    );
    nameKey = await provider.deriveFieldKey(masterKey, 'name');
  });

  async function makeEntry(documentPath: string, name: string): Promise<BlindIndexEntry> {
    const token = await provider.computeToken(nameKey, name);
    return { documentPath, blindIndexTokens: { name: token } };
  }

  describe('exactMatch', () => {
    test('should find matching entries', async () => {
      const entries = [
        await makeEntry('/users/1', 'Alice'),
        await makeEntry('/users/2', 'Bob'),
        await makeEntry('/users/3', 'Alice'),
      ];

      const results = await query.exactMatch(nameKey, 'name', 'Alice', entries);
      expect(results).toHaveLength(2);
      expect(results.map(r => r.documentPath)).toEqual(['/users/1', '/users/3']);
    });

    test('should return empty array when no match', async () => {
      const entries = [
        await makeEntry('/users/1', 'Alice'),
        await makeEntry('/users/2', 'Bob'),
      ];

      const results = await query.exactMatch(nameKey, 'name', 'Charlie', entries);
      expect(results).toHaveLength(0);
    });

    test('should handle empty entries array', async () => {
      const results = await query.exactMatch(nameKey, 'name', 'Alice', []);
      expect(results).toHaveLength(0);
    });

    test('should match case-insensitively (via normalization)', async () => {
      const entries = [await makeEntry('/users/1', 'Alice')];
      const results = await query.exactMatch(nameKey, 'name', 'alice', entries);
      expect(results).toHaveLength(1);
    });
  });

  describe('compoundMatch', () => {
    test('should find matching entries by compound key', async () => {
      const compoundKey = await provider.deriveFieldKey(masterKey, 'name+age');
      const token = await provider.computeCompoundToken(compoundKey, ['Alice', 30]);
      const entries: BlindIndexEntry[] = [
        { documentPath: '/users/1', blindIndexTokens: { 'name+age': token } },
        { documentPath: '/users/2', blindIndexTokens: { 'name+age': await provider.computeCompoundToken(compoundKey, ['Bob', 25]) } },
      ];

      const results = await query.compoundMatch(compoundKey, 'name+age', ['Alice', 30], entries);
      expect(results).toHaveLength(1);
      expect(results[0].documentPath).toBe('/users/1');
    });

    test('should return empty when no compound match', async () => {
      const compoundKey = await provider.deriveFieldKey(masterKey, 'name+age');
      const entries: BlindIndexEntry[] = [
        { documentPath: '/users/1', blindIndexTokens: { 'name+age': await provider.computeCompoundToken(compoundKey, ['Alice', 30]) } },
      ];

      const results = await query.compoundMatch(compoundKey, 'name+age', ['Bob', 25], entries);
      expect(results).toHaveLength(0);
    });
  });
});
