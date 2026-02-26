import { describe, expect, test, beforeAll } from '@jest/globals';
import { SubtleBlindIndexProvider } from './subtle-blind-index-provider';

describe('SubtleBlindIndexProvider', () => {
  let provider: SubtleBlindIndexProvider;
  let masterKey: CryptoKey;

  beforeAll(async () => {
    provider = new SubtleBlindIndexProvider();
    // Generate a random master key
    masterKey = await crypto.subtle.generateKey(
      { name: 'HMAC', hash: 'SHA-256' },
      true, // extractable so we can use it with HKDF
      ['sign'],
    );
  });

  describe('deriveFieldKey', () => {
    test('should derive different keys for different field paths', async () => {
      const key1 = await provider.deriveFieldKey(masterKey, 'title');
      const key2 = await provider.deriveFieldKey(masterKey, 'author');
      // Keys should be different CryptoKey objects
      expect(key1).not.toBe(key2);
      // Compute tokens with each to verify they produce different results
      const token1 = await provider.computeToken(key1, 'test');
      const token2 = await provider.computeToken(key2, 'test');
      expect(token1).not.toEqual(token2);
    });

    test('should derive the same key for the same field path (deterministic)', async () => {
      const key1 = await provider.deriveFieldKey(masterKey, 'title');
      const key2 = await provider.deriveFieldKey(masterKey, 'title');
      const token1 = await provider.computeToken(key1, 'hello');
      const token2 = await provider.computeToken(key2, 'hello');
      expect(token1).toEqual(token2);
    });
  });

  describe('computeToken', () => {
    test('should produce deterministic tokens', async () => {
      const fieldKey = await provider.deriveFieldKey(masterKey, 'name');
      const token1 = await provider.computeToken(fieldKey, 'Alice');
      const token2 = await provider.computeToken(fieldKey, 'Alice');
      expect(token1).toEqual(token2);
    });

    test('should produce different tokens for different values', async () => {
      const fieldKey = await provider.deriveFieldKey(masterKey, 'name');
      const token1 = await provider.computeToken(fieldKey, 'Alice');
      const token2 = await provider.computeToken(fieldKey, 'Bob');
      expect(token1).not.toEqual(token2);
    });

    test('should normalize case for string values', async () => {
      const fieldKey = await provider.deriveFieldKey(masterKey, 'name');
      const token1 = await provider.computeToken(fieldKey, 'Alice');
      const token2 = await provider.computeToken(fieldKey, 'alice');
      expect(token1).toEqual(token2);
    });

    test('should handle numeric values', async () => {
      const fieldKey = await provider.deriveFieldKey(masterKey, 'age');
      const token1 = await provider.computeToken(fieldKey, 42);
      const token2 = await provider.computeToken(fieldKey, 42);
      expect(token1).toEqual(token2);
    });

    test('should distinguish strings from numbers', async () => {
      const fieldKey = await provider.deriveFieldKey(masterKey, 'value');
      const tokenStr = await provider.computeToken(fieldKey, '42');
      const tokenNum = await provider.computeToken(fieldKey, 42);
      expect(tokenStr).not.toEqual(tokenNum);
    });

    test('should return base64url-encoded string', async () => {
      const fieldKey = await provider.deriveFieldKey(masterKey, 'field');
      const token = await provider.computeToken(fieldKey, 'test');
      // Base64url: only alphanumeric, -, _
      expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
      // Should not contain padding
      expect(token).not.toContain('=');
    });
  });

  describe('computeCompoundToken', () => {
    test('should produce deterministic tokens', async () => {
      const fieldKey = await provider.deriveFieldKey(masterKey, 'compound');
      const token1 = await provider.computeCompoundToken(fieldKey, ['Alice', 42]);
      const token2 = await provider.computeCompoundToken(fieldKey, ['Alice', 42]);
      expect(token1).toEqual(token2);
    });

    test('should produce different tokens for different value sets', async () => {
      const fieldKey = await provider.deriveFieldKey(masterKey, 'compound');
      const token1 = await provider.computeCompoundToken(fieldKey, ['Alice', 42]);
      const token2 = await provider.computeCompoundToken(fieldKey, ['Bob', 42]);
      expect(token1).not.toEqual(token2);
    });

    test('should be order-sensitive', async () => {
      const fieldKey = await provider.deriveFieldKey(masterKey, 'compound');
      const token1 = await provider.computeCompoundToken(fieldKey, ['a', 'b']);
      const token2 = await provider.computeCompoundToken(fieldKey, ['b', 'a']);
      expect(token1).not.toEqual(token2);
    });
  });

  describe('token truncation', () => {
    test('should produce shorter tokens with smaller tokenLengthBytes', async () => {
      const shortProvider = new SubtleBlindIndexProvider(8);
      const longProvider = new SubtleBlindIndexProvider(16);
      const fieldKey8 = await shortProvider.deriveFieldKey(masterKey, 'field');
      const fieldKey16 = await longProvider.deriveFieldKey(masterKey, 'field');
      const shortToken = await shortProvider.computeToken(fieldKey8, 'test');
      const longToken = await longProvider.computeToken(fieldKey16, 'test');
      expect(shortToken.length).toBeLessThan(longToken.length);
    });
  });
});
