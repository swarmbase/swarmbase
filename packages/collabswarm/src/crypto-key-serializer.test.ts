import { describe, expect, test } from '@jest/globals';
import { CryptoKeySerializer } from './crypto-key-serializer';

const serializedKey1 = new Uint8Array([
  201,
  195,
  4,
  111,
  113,
  98,
  140,
  217,
  42,
  208,
  142,
  245,
  177,
  74,
  62,
  133,
  151,
  83,
  183,
  129,
  124,
  243,
  165,
  173,
  149,
  120,
  158,
  92,
  175,
  91,
  177,
  4,
]);

async function importDocumentKey(key: Uint8Array) {
  return await crypto.subtle.importKey(
    'raw',
    key,
    {
      name: 'AES-GCM',
    },
    true,
    ['encrypt', 'decrypt'],
  );
}

describe('serialize CryptoKey to Uint8Array', () => {
  test.each([[serializedKey1]])(
    `serialize CryptoKey`,
    async (data: Uint8Array) => {
      const testKey = await importDocumentKey(data);

      const cryptoKeySerializer = new CryptoKeySerializer('AES-GCM', [
        'encrypt',
        'decrypt',
      ]);
      const actual = await cryptoKeySerializer.serializeKey(testKey);

      expect(actual).toStrictEqual(data);
    },
  );
});

describe('deserialize CryptoKey to Uint8Array', () => {
  test.each([[serializedKey1]])(
    `deserialize CryptoKey`,
    async (data: Uint8Array) => {
      const testKey = await importDocumentKey(data);

      const cryptoKeySerializer = new CryptoKeySerializer('AES-GCM', [
        'encrypt',
        'decrypt',
      ]);
      const actual = await cryptoKeySerializer.deserializeKey(data);

      expect(actual).toStrictEqual(testKey);
    },
  );
});
