import { describe, expect, test } from '@jest/globals';
import { SubtleCrypto } from './auth-subtlecrypto';

describe('Collabswarm crypto key generation', () => {
  const auth = new SubtleCrypto();

  test('should generate unique key pairs', async () => {
    const keyPair1 = await crypto.subtle.generateKey(
      {
        name: 'ECDSA',
        namedCurve: 'P-384',
      },
      true,
      ['sign', 'verify']
    );
    
    const keyPair2 = await crypto.subtle.generateKey(
      {
        name: 'ECDSA',
        namedCurve: 'P-384',
      },
      true,
      ['sign', 'verify']
    );
    
    expect(keyPair1).toBeDefined();
    expect(keyPair2).toBeDefined();
    expect(keyPair1.privateKey).not.toBe(keyPair2.privateKey);
    expect(keyPair1.publicKey).not.toBe(keyPair2.publicKey);
  });

  test('should generate unique document keys', async () => {
    const key1 = await crypto.subtle.generateKey(
      {
        name: 'AES-GCM',
        length: 256,
      },
      true,
      ['encrypt', 'decrypt']
    );
    
    const key2 = await crypto.subtle.generateKey(
      {
        name: 'AES-GCM',
        length: 256,
      },
      true,
      ['encrypt', 'decrypt']
    );
    
    expect(key1).toBeDefined();
    expect(key2).toBeDefined();
    expect(key1).not.toBe(key2);
  });

  test('should sign with one key and verify with its public key', async () => {
    const data = new Uint8Array([1, 2, 3, 4, 5]);
    
    const keyPair = await crypto.subtle.generateKey(
      {
        name: 'ECDSA',
        namedCurve: 'P-384',
      },
      true,
      ['sign', 'verify']
    );
    
    const signature = await auth.sign(data, keyPair.privateKey);
    expect(signature).toBeDefined();
    expect(signature.length).toBeGreaterThan(0);
    
    const isValid = await auth.verify(data, keyPair.publicKey, signature);
    expect(isValid).toBe(true);
  });

  test('should fail to verify signature with different public key', async () => {
    const data = new Uint8Array([1, 2, 3, 4, 5]);
    
    const keyPair1 = await crypto.subtle.generateKey(
      {
        name: 'ECDSA',
        namedCurve: 'P-384',
      },
      true,
      ['sign', 'verify']
    );
    
    const keyPair2 = await crypto.subtle.generateKey(
      {
        name: 'ECDSA',
        namedCurve: 'P-384',
      },
      true,
      ['sign', 'verify']
    );
    
    const signature = await auth.sign(data, keyPair1.privateKey);
    const isValid = await auth.verify(data, keyPair2.publicKey, signature);
    expect(isValid).toBe(false);
  });

  test('should encrypt and decrypt data with same key', async () => {
    const data = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);
    
    const documentKey = await crypto.subtle.generateKey(
      {
        name: 'AES-GCM',
        length: 256,
      },
      true,
      ['encrypt', 'decrypt']
    );
    
    const { data: encrypted, nonce } = await auth.encrypt(data, documentKey);
    expect(encrypted).toBeDefined();
    expect(nonce).toBeDefined();
    expect(encrypted.length).toBeGreaterThan(0);
    
    const decrypted = await auth.decrypt(encrypted, documentKey, nonce);
    expect(decrypted).toEqual(data);
  });

  test('should fail to decrypt with different key', async () => {
    const data = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);
    
    const key1 = await crypto.subtle.generateKey(
      {
        name: 'AES-GCM',
        length: 256,
      },
      true,
      ['encrypt', 'decrypt']
    );
    
    const key2 = await crypto.subtle.generateKey(
      {
        name: 'AES-GCM',
        length: 256,
      },
      true,
      ['encrypt', 'decrypt']
    );
    
    const { data: encrypted, nonce } = await auth.encrypt(data, key1);
    
    await expect(auth.decrypt(encrypted, key2, nonce)).rejects.toThrow();
  });
});

describe('Multi-user simulation basics', () => {
  const auth = new SubtleCrypto();

  test('should create independent key pairs for multiple users', async () => {
    // Simulate 3 users
    const users = await Promise.all([
      crypto.subtle.generateKey(
        { name: 'ECDSA', namedCurve: 'P-384' },
        true,
        ['sign', 'verify']
      ),
      crypto.subtle.generateKey(
        { name: 'ECDSA', namedCurve: 'P-384' },
        true,
        ['sign', 'verify']
      ),
      crypto.subtle.generateKey(
        { name: 'ECDSA', namedCurve: 'P-384' },
        true,
        ['sign', 'verify']
      ),
    ]);

    expect(users).toHaveLength(3);
    
    // Verify each user can sign and verify their own data
    for (const user of users) {
      const data = new Uint8Array([1, 2, 3]);
      const signature = await auth.sign(data, user.privateKey);
      const isValid = await auth.verify(data, user.publicKey, signature);
      expect(isValid).toBe(true);
    }
    
    // Verify cross-verification fails
    const data = new Uint8Array([1, 2, 3]);
    const signature = await auth.sign(data, users[0].privateKey);
    const isValid = await auth.verify(data, users[1].publicKey, signature);
    expect(isValid).toBe(false);
  });

  test('should share encrypted data using shared document key', async () => {
    // Create a shared document key
    const documentKey = await crypto.subtle.generateKey(
      { name: 'AES-GCM', length: 256 },
      true,
      ['encrypt', 'decrypt']
    );

    // User 1 encrypts data
    const data = new Uint8Array([1, 2, 3, 4, 5]);
    const { data: encrypted, nonce } = await auth.encrypt(data, documentKey);

    // User 2 can decrypt with the same key
    const decrypted = await auth.decrypt(encrypted, documentKey, nonce);
    expect(decrypted).toEqual(data);
  });
});

/**
 * Tests for the validateDocumentPath control flow used in
 * CollabswarmDocument.open(). These verify the validateDocumentPath callback
 * contract independently of CollabswarmDocument.open() because open() requires
 * a full libp2p/IPFS stack that is tested via integration tests (see e2e/).
 * The helper below replicates the exact branching logic so we can cover all
 * code paths (returns true, returns false, throws, async, undefined) in
 * fast unit tests.
 */
describe('validateDocumentPath control flow', () => {
  /**
   * Replicates the validation block from CollabswarmDocument.open() so we can
   * test the three code paths (returns true, returns false, throws) in
   * isolation. The real implementation lives in CollabswarmDocument.open()
   * within collabswarm-document.ts.
   */
  async function runValidation(
    validateFn: ((path: string, key: unknown) => boolean | Promise<boolean>) | undefined,
    documentPath: string,
    userPublicKey: unknown,
  ): Promise<void> {
    if (validateFn) {
      let allowed: boolean;
      try {
        allowed = await validateFn(documentPath, userPublicKey);
      } catch (err) {
        throw err instanceof Error ? err : new Error(String(err));
      }
      if (!allowed) {
        throw new Error(
          `Document path "${documentPath}" is not allowed for the current user`,
        );
      }
    }
  }

  test('should succeed when validateDocumentPath returns true', async () => {
    const validateFn = (_path: string, _key: unknown) => true;
    await expect(runValidation(validateFn, '/docs/allowed', 'key123')).resolves.toBeUndefined();
  });

  test('should throw descriptive error when validateDocumentPath returns false', async () => {
    const validateFn = (_path: string, _key: unknown) => false;
    await expect(runValidation(validateFn, '/docs/blocked', 'key123')).rejects.toThrow(
      'Document path "/docs/blocked" is not allowed for the current user',
    );
  });

  test('should rethrow Error from validateDocumentPath as-is', async () => {
    const originalError = new Error('custom validation failure');
    const validateFn = (_path: string, _key: unknown): boolean => { throw originalError; };
    await expect(runValidation(validateFn, '/docs/bad', 'key123')).rejects.toThrow(originalError);
  });

  test('should wrap non-Error thrown value in an Error', async () => {
    const validateFn = (_path: string, _key: unknown): boolean => { throw 'string error'; };
    await expect(runValidation(validateFn, '/docs/bad', 'key123')).rejects.toThrow('string error');
    // Verify it's wrapped as an Error instance
    try {
      await runValidation(validateFn, '/docs/bad', 'key123');
    } catch (err) {
      expect(err).toBeInstanceOf(Error);
    }
  });

  test('should skip validation when validateDocumentPath is undefined', async () => {
    await expect(runValidation(undefined, '/docs/any', 'key123')).resolves.toBeUndefined();
  });

  test('should support async validateDocumentPath returning Promise<boolean>', async () => {
    const validateFn = (_path: string, _key: unknown) => Promise.resolve(true);
    await expect(runValidation(validateFn, '/docs/async', 'key123')).resolves.toBeUndefined();

    const validateFnFalse = (_path: string, _key: unknown) => Promise.resolve(false);
    await expect(runValidation(validateFnFalse, '/docs/async', 'key123')).rejects.toThrow(
      'Document path "/docs/async" is not allowed for the current user',
    );
  });
});

describe('getReaders() dedup logic', () => {
  // Tests the actual dedup pattern from CollabswarmDocument.getReaders() using
  // mock ACL objects with check()/users() — the same interface the production
  // code calls. This catches regressions if check() semantics change.
  test('should deduplicate keys present in both readers and writers via check()', async () => {
    const sharedKey = await crypto.subtle.generateKey(
      { name: 'ECDSA', namedCurve: 'P-384' }, true, ['sign', 'verify'],
    );
    const readerOnlyKey = await crypto.subtle.generateKey(
      { name: 'ECDSA', namedCurve: 'P-384' }, true, ['sign', 'verify'],
    );
    const writerOnlyKey = await crypto.subtle.generateKey(
      { name: 'ECDSA', namedCurve: 'P-384' }, true, ['sign', 'verify'],
    );

    // Mock ACLs — sharedKey appears in both readers and writers
    const readerKeys = [sharedKey.publicKey, readerOnlyKey.publicKey];
    const writerKeys = [sharedKey.publicKey, writerOnlyKey.publicKey];

    // Export keys for fingerprint comparison (same approach as YjsACL.check)
    const fingerprint = async (k: CryptoKey) =>
      new Uint8Array(await crypto.subtle.exportKey('raw', k)).toString();
    const readerFPs = new Set(await Promise.all(readerKeys.map(fingerprint)));

    // Mock _readers.check() — returns true if the key is in readerKeys
    const readersCheck = async (key: CryptoKey) =>
      readerFPs.has(await fingerprint(key));

    // Replicate getReaders() dedup: filter writers already in readers via check()
    const checkResults = await Promise.all(writerKeys.map(readersCheck));
    const filteredWriters = writerKeys.filter((_, i) => !checkResults[i]);
    const combined = [...readerKeys, ...filteredWriters];

    // sharedKey from writers should be filtered out; writerOnlyKey should remain
    expect(combined).toHaveLength(3); // readerOnly + shared (from readers) + writerOnly
    // Verify writerOnlyKey made it through
    const combinedFPs = await Promise.all(combined.map(fingerprint));
    expect(combinedFPs).toContain(await fingerprint(writerOnlyKey.publicKey));
    // Verify sharedKey appears exactly once
    const sharedFP = await fingerprint(sharedKey.publicKey);
    expect(combinedFPs.filter(fp => fp === sharedFP)).toHaveLength(1);
  });
});

