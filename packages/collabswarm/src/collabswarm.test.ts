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
 * a full libp2p/Helia stack that is tested via integration tests (see e2e/).
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
  // mock ACL objects with check()/users() -- the same interface the production
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

    // Mock ACLs -- sharedKey appears in both readers and writers
    const readerKeys = [sharedKey.publicKey, readerOnlyKey.publicKey];
    const writerKeys = [sharedKey.publicKey, writerOnlyKey.publicKey];

    // Export keys for fingerprint comparison (same approach as YjsACL.check)
    const fingerprint = async (k: CryptoKey) =>
      new Uint8Array(await crypto.subtle.exportKey('raw', k)).toString();
    const readerFPs = new Set(await Promise.all(readerKeys.map(fingerprint)));

    // Mock _readers.check() -- returns true if the key is in readerKeys
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

/**
 * Tests for the writer-key caching pattern in CollabswarmDocument's
 * `_getWriterKeys` / `_mergeWriters` / `_addWriter` / `_removeWriter` helpers.
 * Replicates the cache + invalidation logic against a mock ACL so we can
 * exercise hit/miss and invalidation paths in isolation, without standing up
 * a full libp2p/Helia stack.
 */
describe('writer key cache', () => {
  // Minimal harness mirroring the document-scoped cache and the three
  // mutation paths (merge / add / remove). Production code lives in
  // CollabswarmDocument (collabswarm-document.ts).
  //
  // The version counter exists for race-safety: an in-flight `getKeys()` that
  // started before an invalidation captures the version at fetch time and
  // refuses to commit its result if the version has advanced. Without it, a
  // stale fetch could overwrite the freshly-invalidated null cache with a
  // pre-revocation writer list.
  class WriterCacheHarness<T> {
    private _cached: T[] | null = null;
    private _version = 0;
    public usersCalls = 0;
    constructor(private readonly _backing: { users: () => Promise<T[]>; merge: () => void; add: () => Promise<void>; remove: () => Promise<void>; }) {}

    async getKeys(): Promise<T[]> {
      if (this._cached !== null) return this._cached;
      this.usersCalls++;
      const versionAtStart = this._version;
      const fetched = await this._backing.users();
      if (this._version === versionAtStart) {
        this._cached = fetched;
      }
      return fetched;
    }
    private _invalidate(): void {
      this._cached = null;
      this._version++;
    }
    merge(): void {
      this._backing.merge();
      this._invalidate();
    }
    async add(): Promise<void> {
      await this._backing.add();
      this._invalidate();
    }
    async remove(): Promise<void> {
      await this._backing.remove();
      this._invalidate();
    }
  }

  test('caches users() and reuses on subsequent calls', async () => {
    const keys = ['k1', 'k2'];
    const backing = {
      users: async () => keys.slice(),
      merge: () => {},
      add: async () => {},
      remove: async () => {},
    };
    const cache = new WriterCacheHarness<string>(backing);

    const a = await cache.getKeys();
    const b = await cache.getKeys();
    const c = await cache.getKeys();

    expect(a).toEqual(keys);
    expect(b).toEqual(keys);
    expect(c).toEqual(keys);
    // backing.users() should have been called exactly once across three lookups
    expect(cache.usersCalls).toBe(1);
  });

  test('invalidates the cache on merge / add / remove', async () => {
    let currentKeys = ['k1'];
    const backing = {
      users: async () => currentKeys.slice(),
      merge: () => { currentKeys = [...currentKeys, 'merged']; },
      add: async () => { currentKeys = [...currentKeys, 'added']; },
      remove: async () => { currentKeys = currentKeys.slice(0, -1); },
    };
    const cache = new WriterCacheHarness<string>(backing);

    expect(await cache.getKeys()).toEqual(['k1']);
    expect(cache.usersCalls).toBe(1);

    // merge invalidates -- next read sees the new state and re-queries.
    cache.merge();
    expect(await cache.getKeys()).toEqual(['k1', 'merged']);
    expect(cache.usersCalls).toBe(2);

    // Reads after merge stay cached.
    expect(await cache.getKeys()).toEqual(['k1', 'merged']);
    expect(cache.usersCalls).toBe(2);

    // add invalidates.
    await cache.add();
    expect(await cache.getKeys()).toEqual(['k1', 'merged', 'added']);
    expect(cache.usersCalls).toBe(3);

    // remove invalidates.
    await cache.remove();
    expect(await cache.getKeys()).toEqual(['k1', 'merged']);
    expect(cache.usersCalls).toBe(4);
  });

  test('invalidation during in-flight users() fetch does not overwrite the cleared cache', async () => {
    // Reproduces the race fixed in the writer-key cache: while a getKeys()
    // call is awaiting users(), an invalidation (e.g. revoking a writer)
    // races in. The pre-invalidation fetch must NOT commit its (now-stale)
    // result back to the cache, or the next reader could see the revoked
    // writer in the trusted set.
    const pendingResolves: Array<(keys: string[]) => void> = [];
    let usersCalls = 0;
    let currentKeys = ['k1', 'revoked'];
    const backing = {
      users: () => {
        usersCalls++;
        return new Promise<string[]>((resolve) => {
          pendingResolves.push(resolve);
        });
      },
      merge: () => { currentKeys = currentKeys.filter((k) => k !== 'revoked'); },
      add: async () => {},
      remove: async () => {},
    };
    const cache = new WriterCacheHarness<string>(backing);

    // Start a getKeys() that captures the OLD writer set.
    const inFlight = cache.getKeys();
    expect(usersCalls).toBe(1);
    expect(pendingResolves.length).toBe(1);

    // Race: an ACL update revokes the writer mid-fetch.
    cache.merge();

    // Resolve the pre-invalidation fetch with the stale list.
    pendingResolves[0](['k1', 'revoked']);
    const result = await inFlight;
    // The resolved value still reflects what users() returned, but...
    expect(result).toEqual(['k1', 'revoked']);

    // ...the next read must NOT reuse it: the cache was cleared by merge,
    // and the in-flight fetch must have refused to assign back. So
    // getKeys() re-queries the backing.
    const nextPromise = cache.getKeys();
    expect(usersCalls).toBe(2);
    expect(pendingResolves.length).toBe(2);
    pendingResolves[1](currentKeys.slice());
    const next = await nextPromise;
    expect(next).toEqual(['k1']); // would be ['k1', 'revoked'] without the version guard
  });
});

/**
 * Tests for the malformed-signature defense in `_verifyWriterSignature`.
 * The production code lives in CollabswarmDocument; the harness below
 * replicates its decode-then-verify control flow so we can drive it with
 * forced-throw decoders (matching the pattern used elsewhere in this file).
 *
 * Why the guard exists: `Base64.toUint8Array` *can* throw on certain inputs
 * (notably non-string values that slip through type erasure in over-the-wire
 * messages). In the topic validator path, a thrown error is caught and
 * mapped to `Ignore`, silently dropping the message -- which is a usable
 * DoS surface for malformed input. Catching decode failures and returning
 * `false` instead surfaces the failure cleanly as "signature did not
 * verify" without crashing.
 */
describe('verifyWriterSignature malformed-signature handling', () => {
  // Replicates the relevant control flow from
  // CollabswarmDocument._verifyWriterSignature so we can test the
  // short-circuit and try/catch in isolation. If the production logic
  // changes, mirror it here.
  async function verifyWriterSignature<PublicKey>(opts: {
    signingEnabled: boolean;
    writerKeys: PublicKey[];
    signature: string;
    deserialize: (s: string) => Uint8Array;
    verify: (raw: Uint8Array, key: PublicKey, sig: Uint8Array) => Promise<boolean>;
    raw: Uint8Array;
  }): Promise<boolean> {
    if (!opts.signingEnabled) return true;
    if (opts.writerKeys.length === 0) return false;
    let signatureBytes: Uint8Array;
    try {
      signatureBytes = opts.deserialize(opts.signature);
    } catch {
      return false;
    }
    const tasks = opts.writerKeys.map((k) => opts.verify(opts.raw, k, signatureBytes));
    const results = await Promise.all(tasks);
    return results.some((r) => r);
  }

  test('returns false when base64 decode throws (does not propagate exception)', async () => {
    // Force a throw to mimic js-base64 throwing on a malformed input
    // (e.g. a non-string sneaking through, or a rejected encoding).
    const throwingDecode = (_: string): Uint8Array => {
      throw new TypeError('malformed base64');
    };
    let verifyCalled = false;
    const result = await verifyWriterSignature<string>({
      signingEnabled: true,
      writerKeys: ['writer1', 'writer2'],
      signature: 'not-actually-decoded-because-throw',
      deserialize: throwingDecode,
      verify: async () => { verifyCalled = true; return true; },
      raw: new Uint8Array([1, 2, 3]),
    });
    expect(result).toBe(false);
    // verify() must NOT be called when decode fails -- otherwise we'd be
    // doing crypto on undefined bytes.
    expect(verifyCalled).toBe(false);
  });

  test('returns false (without decoding) when writerKeys is empty', async () => {
    // No writers -> nothing could possibly verify. Skip the decode entirely
    // so a junk signature on a doc with no writers can't even reach
    // js-base64 in the first place.
    let decodeCalled = false;
    const decode = (_: string): Uint8Array => {
      decodeCalled = true;
      return new Uint8Array();
    };
    const result = await verifyWriterSignature<string>({
      signingEnabled: true,
      writerKeys: [],
      signature: 'anything',
      deserialize: decode,
      verify: async () => true,
      raw: new Uint8Array([1, 2, 3]),
    });
    expect(result).toBe(false);
    expect(decodeCalled).toBe(false);
  });

  test('still verifies normally when decode succeeds', async () => {
    // Sanity: the try/catch guard must not break the happy path.
    const decode = (s: string): Uint8Array => new Uint8Array([s.length]);
    const result = await verifyWriterSignature<string>({
      signingEnabled: true,
      writerKeys: ['writer1'],
      signature: 'AAAA',
      deserialize: decode,
      verify: async (_raw, _key, sig) => sig.length === 1 && sig[0] === 4,
      raw: new Uint8Array([1, 2, 3]),
    });
    expect(result).toBe(true);
  });
});
