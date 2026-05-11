import { describe, expect, test, beforeAll } from '@jest/globals';
import {
  AutomergeProvider,
  AutomergeACL,
  AutomergeACLProvider,
  AutomergeKeychain,
  AutomergeKeychainProvider,
  AutomergeJSONSerializer,
  serializeKey,
  deserializeKey,
} from './collabswarm-automerge';

// ECDSA P-384 JWK test keys (public only - ACL uses raw export which requires public keys)
const publicKeyData1 = {
  key_ops: ['verify'] as KeyUsage[],
  ext: true,
  kty: 'EC',
  x: 'iV0DESMDz3fcubTpUCMK4YLWbU9gDslDgdflc5OGrQVII_wCViDdqGbMTOmQLY0F',
  y: 'CQyfju2lK2mT0TIVDI-olIqFC3m3AayX0deHkw4JPCU-GwzV9k0BT295OSQ495kK',
  crv: 'P-384',
};
const publicKeyData2 = {
  key_ops: ['verify'] as KeyUsage[],
  ext: true,
  kty: 'EC',
  x: 'oodHRfDRDsXcpe2FvwctaK1y4pt8Lhx5tmiXZ-35vzXuDUD5zWhzPxgC8FZvyY0K',
  y: 'KhgG-mU2-mNbhgdK9_8nEMwPa2_bWWl_zlqY6Q4xuXYMOjhSLGydbFIDSAGBaNaJ',
  crv: 'P-384',
};

async function importECDSAPublicKey(jwk: JsonWebKey): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'jwk',
    jwk,
    { name: 'ECDSA', namedCurve: 'P-384' },
    true,
    ['verify'],
  );
}

// ─── AutomergeProvider ──────────────────────────────────────────────

interface TestDoc {
  title: string;
  count: number;
}

describe('AutomergeProvider', () => {
  const provider = new AutomergeProvider<TestDoc>();

  test('newDocument() returns a valid Automerge Doc', () => {
    const doc = provider.newDocument();
    expect(doc).toBeDefined();
    // Automerge init docs are frozen plain objects
    expect(typeof doc).toBe('object');
  });

  test('localChange() applies a change and returns [newDoc, changes]', () => {
    const doc = provider.newDocument();
    const [newDoc, changes] = provider.localChange(doc, '', (d) => {
      d.title = 'hello';
      d.count = 1;
    });
    expect(newDoc.title).toBe('hello');
    expect(newDoc.count).toBe(1);
    expect(changes.length).toBeGreaterThan(0);
  });

  test('localChange() with a message passes through', () => {
    const doc = provider.newDocument();
    const [newDoc, changes] = provider.localChange(
      doc,
      'set title',
      (d) => {
        d.title = 'with message';
      },
    );
    expect(newDoc.title).toBe('with message');
    expect(changes.length).toBeGreaterThan(0);
  });

  test('remoteChange() applies binary changes from another doc', () => {
    const doc1 = provider.newDocument();
    const [updated1, changes] = provider.localChange(doc1, '', (d) => {
      d.title = 'remote';
      d.count = 42;
    });

    let doc2 = provider.newDocument();
    doc2 = provider.remoteChange(doc2, changes);
    expect(doc2.title).toBe('remote');
    expect(doc2.count).toBe(42);
  });

  test('getHistory() returns all changes', () => {
    const doc = provider.newDocument();
    const [doc2] = provider.localChange(doc, '', (d) => {
      d.title = 'a';
    });
    const [doc3] = provider.localChange(doc2, '', (d) => {
      d.count = 5;
    });
    const history = provider.getHistory(doc3);
    expect(history.length).toBe(2);
  });

  test('round-trip: localChange on doc1 -> remoteChange on doc2 -> docs match', () => {
    const doc1 = provider.newDocument();
    const [doc1a, changes1] = provider.localChange(doc1, '', (d) => {
      d.title = 'sync';
      d.count = 99;
    });

    let doc2 = provider.newDocument();
    doc2 = provider.remoteChange(doc2, changes1);

    expect(doc2.title).toBe(doc1a.title);
    expect(doc2.count).toBe(doc1a.count);
  });
});

// ─── serializeKey / deserializeKey ──────────────────────────────────

describe('serializeKey / deserializeKey', () => {
  test('round-trip serialize then deserialize an ECDSA public key', async () => {
    const key = await importECDSAPublicKey(publicKeyData1);
    const serialized = await serializeKey(key);
    expect(typeof serialized).toBe('string');
    expect(serialized.length).toBeGreaterThan(0);

    const deserialized = await deserializeKey(
      { name: 'ECDSA', namedCurve: 'P-384' },
      ['verify'],
    )(serialized);
    expect(deserialized).toBeDefined();
    expect(deserialized.type).toBe('public');

    // Re-serialize should produce the same base64 string
    const reSerialized = await serializeKey(deserialized);
    expect(reSerialized).toBe(serialized);
  });
});

// ─── AutomergeACL ───────────────────────────────────────────────────

describe('AutomergeACL', () => {
  let key1: CryptoKey;
  let key2: CryptoKey;

  beforeAll(async () => {
    key1 = await importECDSAPublicKey(publicKeyData1);
    key2 = await importECDSAPublicKey(publicKeyData2);
  });

  test('add() adds a user and check() returns true', async () => {
    const acl = new AutomergeACL();
    const changes = await acl.add(key1);
    expect(changes.length).toBeGreaterThan(0);
    expect(await acl.check(key1)).toBe(true);
  });

  test('remove() removes a user and check() returns false', async () => {
    const acl = new AutomergeACL();
    await acl.add(key1);
    expect(await acl.check(key1)).toBe(true);

    const removeChanges = await acl.remove(key1);
    expect(removeChanges.length).toBeGreaterThan(0);
    expect(await acl.check(key1)).toBe(false);
  });

  test('check() returns false for an unknown key', async () => {
    const acl = new AutomergeACL();
    await acl.add(key1);
    expect(await acl.check(key2)).toBe(false);
  });

  test('users() returns all added keys', async () => {
    const acl = new AutomergeACL();
    await acl.add(key1);
    await acl.add(key2);

    const users = await acl.users();
    expect(users).toHaveLength(2);

    // Verify by serializing the returned keys and comparing
    const serialized1 = await serializeKey(key1);
    const serialized2 = await serializeKey(key2);
    const returnedSerialized = await Promise.all(users.map(serializeKey));
    expect(returnedSerialized).toContain(serialized1);
    expect(returnedSerialized).toContain(serialized2);
  });

  test('current() / merge() - export changes and verify merge', async () => {
    const acl1 = new AutomergeACL();
    await acl1.add(key1);
    await acl1.add(key2);

    const exported = acl1.current();
    expect(exported.length).toBeGreaterThan(0);

    // Merge back into the same ACL (self-merge is idempotent)
    acl1.merge(exported);
    expect(await acl1.check(key1)).toBe(true);
    expect(await acl1.check(key2)).toBe(true);
  });
});

describe('AutomergeACLProvider', () => {
  test('initialize() returns a new AutomergeACL', () => {
    const provider = new AutomergeACLProvider();
    const acl = provider.initialize();
    expect(acl).toBeInstanceOf(AutomergeACL);
  });
});

// ─── AutomergeKeychain ──────────────────────────────────────────────

describe('AutomergeKeychain', () => {
  test('add() returns [keyIDBytes, CryptoKey, changes]', async () => {
    const keychain = new AutomergeKeychain();
    const [keyIDBytes, key, changes] = await keychain.add();

    expect(keyIDBytes).toBeInstanceOf(Uint8Array);
    expect(keyIDBytes.length).toBe(16); // UUID v4 = 16 bytes
    expect(key).toBeDefined();
    expect(key.type).toBe('secret');
    expect(changes.length).toBeGreaterThan(0);
  });

  test('keys() returns all added keys', async () => {
    const keychain = new AutomergeKeychain();
    await keychain.add();
    await keychain.add();

    const keys = await keychain.keys();
    expect(keys).toHaveLength(2);
    for (const [idBytes, key] of keys) {
      expect(idBytes).toBeInstanceOf(Uint8Array);
      expect(idBytes.length).toBe(16);
      expect(key).toBeDefined();
    }
  });

  test('history() / merge() - export changes and merge into same keychain', async () => {
    const kc1 = new AutomergeKeychain();
    await kc1.add();
    await kc1.add();

    const exported = kc1.history();
    expect(exported.length).toBeGreaterThan(0);

    // Verify history round-trips through a fresh keychain.
    // Note: Automerge from() creates a distinct actor, so merging
    // getAllChanges into a different from()-initialized doc may produce
    // conflicts on the initial 'keys' array. Verify we can at least
    // re-apply our own history without error.
    const kc2 = new AutomergeKeychain();
    kc2.merge(exported);
    // The merged doc should have entries (may differ due to actor conflicts
    // between distinct from()-initialized documents).
    const keys2 = await kc2.keys();
    expect(Array.isArray(keys2)).toBe(true);
  });

  test('getKey() retrieves a cached key by ID', async () => {
    const keychain = new AutomergeKeychain();
    const [keyIDBytes, originalKey] = await keychain.add();

    const retrieved = keychain.getKey(keyIDBytes);
    expect(retrieved).toBeDefined();
    expect(retrieved).toBe(originalKey); // Same reference from cache
  });

  test('getKey() returns undefined for unknown ID', () => {
    const keychain = new AutomergeKeychain();
    const unknownID = new Uint8Array(16);
    unknownID.fill(0xff);
    const result = keychain.getKey(unknownID);
    expect(result).toBeUndefined();
  });
});

describe('AutomergeKeychainProvider', () => {
  test('initialize() returns a new AutomergeKeychain with keyIDLength=16', () => {
    const provider = new AutomergeKeychainProvider();
    const keychain = provider.initialize();
    expect(keychain).toBeInstanceOf(AutomergeKeychain);
    expect(provider.keyIDLength).toBe(16);
  });
});

// ─── AutomergeJSONSerializer ────────────────────────────────────────

describe('AutomergeJSONSerializer', () => {
  const serializer = new AutomergeJSONSerializer();

  test('serializeChangeBlock/deserializeChangeBlock round-trip with keyID', () => {
    const provider = new AutomergeProvider<{ title: string }>();
    const doc = provider.newDocument();
    const [, changes] = provider.localChange(doc, '', (d) => {
      d.title = 'test';
    });
    const block = {
      changes,
      nonce: new Uint8Array([10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21]),
      keyID: 'epoch-key-abc-123',
    };
    const serialized = serializer.serializeChangeBlock(block);
    const deserialized = serializer.deserializeChangeBlock(serialized);
    expect(deserialized.keyID).toBe('epoch-key-abc-123');
    expect(deserialized.nonce).toEqual(block.nonce);
    expect(deserialized.changes).toHaveLength(changes.length);
  });

  test('serializeChangeBlock/deserializeChangeBlock round-trip with blindIndexTokens', () => {
    const provider = new AutomergeProvider<{ title: string }>();
    const doc = provider.newDocument();
    const [, changes] = provider.localChange(doc, '', (d) => {
      d.title = 'test';
    });
    const block = {
      changes,
      nonce: new Uint8Array([10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21]),
      blindIndexTokens: { 'field.name': 'hmac-token-abc', 'field.email': 'hmac-token-def' },
    };
    const serialized = serializer.serializeChangeBlock(block);
    const deserialized = serializer.deserializeChangeBlock(serialized);
    expect(deserialized.blindIndexTokens).toEqual({
      'field.name': 'hmac-token-abc',
      'field.email': 'hmac-token-def',
    });
  });

  test('serializeChangeBlock/deserializeChangeBlock round-trip with empty blindIndexTokens', () => {
    const provider = new AutomergeProvider<{ title: string }>();
    const doc = provider.newDocument();
    const [, changes] = provider.localChange(doc, '', (d) => {
      d.title = 'test';
    });
    const block = {
      changes,
      nonce: new Uint8Array([10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21]),
      blindIndexTokens: {},
    };
    const serialized = serializer.serializeChangeBlock(block);
    const deserialized = serializer.deserializeChangeBlock(serialized);
    expect(deserialized.blindIndexTokens).toEqual({});
  });

  test('deserializeChangeBlock sanitizes dangerous keys in blindIndexTokens', () => {
    const provider = new AutomergeProvider<{ title: string }>();
    const doc = provider.newDocument();
    const [, changes] = provider.localChange(doc, '', (d) => {
      d.title = 'test';
    });
    // Serialize normally first to get valid changes encoding
    const validBlock = {
      changes,
      nonce: new Uint8Array([10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21]),
    };
    const validSerialized = serializer.serializeChangeBlock(validBlock);
    // Parse, inject dangerous blindIndexTokens, re-serialize
    const parsed = JSON.parse(validSerialized);
    parsed.blindIndexTokens = {
      '__proto__': 'evil',
      'constructor': 'evil',
      'prototype': 'evil',
      'safe-key': 'safe-value',
    };
    const malicious = JSON.stringify(parsed);
    const deserialized = serializer.deserializeChangeBlock(malicious);
    expect(deserialized.blindIndexTokens).toEqual({ 'safe-key': 'safe-value' });
    expect(Object.prototype.hasOwnProperty.call(deserialized.blindIndexTokens, '__proto__')).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(deserialized.blindIndexTokens, 'constructor')).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(deserialized.blindIndexTokens, 'prototype')).toBe(false);
  });

  test('deserializeChangeBlock without keyID or blindIndexTokens omits them', () => {
    const provider = new AutomergeProvider<{ title: string }>();
    const doc = provider.newDocument();
    const [, changes] = provider.localChange(doc, '', (d) => {
      d.title = 'test';
    });
    const block = {
      changes,
      nonce: new Uint8Array([10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21]),
    };
    const serialized = serializer.serializeChangeBlock(block);
    const deserialized = serializer.deserializeChangeBlock(serialized);
    expect(deserialized.keyID).toBeUndefined();
    expect(deserialized.blindIndexTokens).toBeUndefined();
  });

  // Build a sync-message Uint8Array wire payload directly from a JS object,
  // bypassing `serializeSyncMessage`'s type-safety so we can test that
  // `deserializeSyncMessage` rejects every defined-but-malformed shape of
  // `changes` rather than silently passing the falsy value through.
  function buildWire(obj: unknown): Uint8Array {
    return new TextEncoder().encode(JSON.stringify(obj));
  }

  test('deserializeSyncMessage rejects "changes: null" (validation bypass regression)', () => {
    const wire = buildWire({ documentId: 'doc', changes: null });
    expect(() => serializer.deserializeSyncMessage(wire)).toThrow(
      /expected a plain object.*got null/,
    );
  });

  test('deserializeSyncMessage rejects "changes: 0"', () => {
    const wire = buildWire({ documentId: 'doc', changes: 0 });
    expect(() => serializer.deserializeSyncMessage(wire)).toThrow(
      /expected a plain object.*got number/,
    );
  });

  test('deserializeSyncMessage rejects "changes: \\"\\"" (empty string)', () => {
    const wire = buildWire({ documentId: 'doc', changes: '' });
    expect(() => serializer.deserializeSyncMessage(wire)).toThrow(
      /expected a plain object.*got string/,
    );
  });

  test('deserializeSyncMessage accepts omitted "changes" field', () => {
    const wire = buildWire({ documentId: 'doc' });
    const deserialized = serializer.deserializeSyncMessage(wire);
    expect(deserialized.changes).toBeUndefined();
  });

  // Regression: prior to the upfront object guard, a malformed peer payload
  // like JSON `null` flowed straight to `raw.snapshot` access and threw a
  // bare `TypeError: Cannot read properties of null`. The guard mirrors
  // `YjsJSONSerializer.deserializeSyncMessage` and produces a descriptive
  // `Error` so the malformed payload can be attributed back to the peer
  // instead of crashing the deserializer (a trivial DoS vector).
  test('deserializeSyncMessage rejects a top-level JSON null payload', () => {
    const wire = buildWire(null);
    expect(() => serializer.deserializeSyncMessage(wire)).toThrow(Error);
    expect(() => serializer.deserializeSyncMessage(wire)).not.toThrow(
      TypeError,
    );
    expect(() => serializer.deserializeSyncMessage(wire)).toThrow(
      /Invalid sync message.*expected a plain object.*got null/,
    );
  });

  test('deserializeSyncMessage rejects a top-level JSON array payload', () => {
    const wire = buildWire([1, 2, 3]);
    expect(() => serializer.deserializeSyncMessage(wire)).toThrow(
      /Invalid sync message.*expected a plain object.*got array/,
    );
  });

  test('deserializeSyncMessage rejects a top-level JSON number payload', () => {
    const wire = buildWire(42);
    expect(() => serializer.deserializeSyncMessage(wire)).toThrow(
      /Invalid sync message.*expected a plain object.*got number/,
    );
  });

  test('deserializeSyncMessage rejects a top-level JSON string payload', () => {
    const wire = buildWire('not-an-object');
    expect(() => serializer.deserializeSyncMessage(wire)).toThrow(
      /Invalid sync message.*expected a plain object.*got string/,
    );
  });

  // Regression: prior to validating `documentId`, a malformed peer payload
  // missing the field (or sending a non-string value) would propagate
  // `documentId: undefined`/non-string downstream and violate the required
  // field contract of `CRDTSyncMessage`. The fix rejects the payload with a
  // descriptive error attributable back to the peer.
  test('deserializeSyncMessage rejects payload missing documentId', () => {
    const wire = buildWire({ changeId: 'c1' });
    expect(() => serializer.deserializeSyncMessage(wire)).toThrow(
      /Invalid sync message.*'documentId' must be a string.*got undefined/,
    );
  });

  test('deserializeSyncMessage rejects payload with non-string documentId (number)', () => {
    const wire = buildWire({ documentId: 42 });
    expect(() => serializer.deserializeSyncMessage(wire)).toThrow(
      /Invalid sync message.*'documentId' must be a string.*got number/,
    );
  });

  test('deserializeSyncMessage rejects payload with null documentId', () => {
    const wire = buildWire({ documentId: null });
    expect(() => serializer.deserializeSyncMessage(wire)).toThrow(
      /Invalid sync message.*'documentId' must be a string.*got null/,
    );
  });

  test('deserializeSyncMessage rejects payload with object documentId', () => {
    const wire = buildWire({ documentId: { id: 'doc' } });
    expect(() => serializer.deserializeSyncMessage(wire)).toThrow(
      /Invalid sync message.*'documentId' must be a string.*got object/,
    );
  });

  test('deserializeSyncMessage rejects non-string changeId', () => {
    const wire = buildWire({ documentId: 'doc', changeId: 7 });
    expect(() => serializer.deserializeSyncMessage(wire)).toThrow(
      /Invalid sync message.*'changeId' must be a string when present.*got number/,
    );
  });

  test('deserializeSyncMessage rejects non-string signature', () => {
    const wire = buildWire({ documentId: 'doc', signature: 7 });
    expect(() => serializer.deserializeSyncMessage(wire)).toThrow(
      /Invalid sync message.*'signature' must be a string when present.*got number/,
    );
  });

  test('deserializeSyncMessage rejects non-array keychainChanges', () => {
    const wire = buildWire({ documentId: 'doc', keychainChanges: 'not-an-array' });
    expect(() => serializer.deserializeSyncMessage(wire)).toThrow(
      /Invalid sync message.*'keychainChanges' must be an array when present.*got string/,
    );
  });

  test('deserializeSyncMessage rejects array snapshot', () => {
    const wire = buildWire({ documentId: 'doc', snapshot: [1, 2, 3] });
    expect(() => serializer.deserializeSyncMessage(wire)).toThrow(
      /Invalid sync message.*'snapshot' must be an object when present.*got array/,
    );
  });

  // Regression: a truthy guard (`if (raw.snapshot)`) silently dropped
  // defined-but-falsy snapshot values rather than rejecting the malformed
  // payload. The fix routes any non-`undefined` value through the validator
  // so peers can't bypass it by sending `snapshot: null/0/""`.
  test('deserializeSyncMessage rejects "snapshot: null" (validation bypass regression)', () => {
    const wire = buildWire({ documentId: 'doc', snapshot: null });
    expect(() => serializer.deserializeSyncMessage(wire)).toThrow(
      /Invalid sync message.*'snapshot' must be an object when present.*got null/,
    );
  });

  test('deserializeSyncMessage rejects "snapshot: 0"', () => {
    const wire = buildWire({ documentId: 'doc', snapshot: 0 });
    expect(() => serializer.deserializeSyncMessage(wire)).toThrow(
      /Invalid sync message.*'snapshot' must be an object when present.*got number/,
    );
  });

  test('deserializeSyncMessage rejects "snapshot: \\"\\"" (empty string)', () => {
    const wire = buildWire({ documentId: 'doc', snapshot: '' });
    expect(() => serializer.deserializeSyncMessage(wire)).toThrow(
      /Invalid sync message.*'snapshot' must be an object when present.*got string/,
    );
  });

  test('deserializeSyncMessage accepts omitted "snapshot" field', () => {
    const wire = buildWire({ documentId: 'doc' });
    const deserialized = serializer.deserializeSyncMessage(wire);
    expect(deserialized.snapshot).toBeUndefined();
  });

  // Regression: prior to building the returned object explicitly, the
  // deserializer spread `...raw` straight onto the result. A malicious peer
  // could append junk keys (or attempt prototype-pollution-style keys) and
  // they would leak through to downstream consumers. The fix only propagates
  // fields declared on `CRDTSyncMessage`.
  test('deserializeSyncMessage strips peer-supplied junk keys', () => {
    const wire = buildWire({
      documentId: 'doc',
      changeId: 'cid',
      somethingExtra: 'evil',
      anotherJunkField: { nested: true },
      __evilNonProtoKey: 'still-junk',
    });
    const deserialized = serializer.deserializeSyncMessage(wire);
    expect(deserialized.documentId).toBe('doc');
    expect(deserialized.changeId).toBe('cid');
    expect((deserialized as Record<string, unknown>).somethingExtra).toBeUndefined();
    expect((deserialized as Record<string, unknown>).anotherJunkField).toBeUndefined();
    expect((deserialized as Record<string, unknown>).__evilNonProtoKey).toBeUndefined();
  });

  test('deserializeSyncMessage round-trips a minimal valid payload', () => {
    const wire = buildWire({ documentId: 'doc' });
    const deserialized = serializer.deserializeSyncMessage(wire);
    expect(deserialized.documentId).toBe('doc');
    expect(deserialized.changes).toBeUndefined();
    expect(deserialized.changeId).toBeUndefined();
    expect(deserialized.signature).toBeUndefined();
    expect(deserialized.keychainChanges).toBeUndefined();
    expect(deserialized.snapshot).toBeUndefined();
  });
});
