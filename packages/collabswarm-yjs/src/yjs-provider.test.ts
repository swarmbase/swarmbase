import { describe, expect, test, beforeAll } from '@jest/globals';
import { Doc } from 'yjs';
import {
  YjsProvider,
  YjsACL,
  YjsACLProvider,
  YjsKeychain,
  YjsKeychainProvider,
  YjsJSONSerializer,
} from './collabswarm-yjs';

// ECDSA P-384 test keys (extractable, verify-only)
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

let key1: CryptoKey;
let key2: CryptoKey;

beforeAll(async () => {
  key1 = await crypto.subtle.importKey(
    'jwk',
    publicKeyData1,
    { name: 'ECDSA', namedCurve: 'P-384' },
    true,
    ['verify'],
  );
  key2 = await crypto.subtle.importKey(
    'jwk',
    publicKeyData2,
    { name: 'ECDSA', namedCurve: 'P-384' },
    true,
    ['verify'],
  );
});

describe('YjsProvider', () => {
  test('newDocument returns a valid Yjs Doc', () => {
    const provider = new YjsProvider();
    const doc = provider.newDocument();
    expect(doc).toBeInstanceOf(Doc);
  });

  test('localChange applies change function and returns [doc, changes]', () => {
    const provider = new YjsProvider();
    const doc = provider.newDocument();
    const [resultDoc, changes] = provider.localChange(
      doc,
      'set greeting',
      (d) => {
        d.getMap('test').set('hello', 'world');
      },
    );
    expect(resultDoc).toBe(doc);
    expect(resultDoc.getMap('test').get('hello')).toBe('world');
    expect(changes).toBeInstanceOf(Uint8Array);
    expect(changes.length).toBeGreaterThan(0);
  });

  test('remoteChange applies encoded update to document', () => {
    const provider = new YjsProvider();
    const doc1 = provider.newDocument();
    const [, changes] = provider.localChange(doc1, 'set value', (d) => {
      d.getMap('data').set('key', 42);
    });

    const doc2 = provider.newDocument();
    const resultDoc = provider.remoteChange(doc2, changes);
    expect(resultDoc).toBe(doc2);
    expect(resultDoc.getMap('data').get('key')).toBe(42);
  });

  test('getHistory returns encoded state', () => {
    const provider = new YjsProvider();
    const doc = provider.newDocument();
    provider.localChange(doc, 'add data', (d) => {
      d.getMap('m').set('a', 1);
    });
    const history = provider.getHistory(doc);
    expect(history).toBeInstanceOf(Uint8Array);
    expect(history.length).toBeGreaterThan(0);
  });

  test('round-trip: localChange on doc1, remoteChange on doc2 syncs data', () => {
    const provider = new YjsProvider();
    const doc1 = provider.newDocument();
    const doc2 = provider.newDocument();

    const [, changes] = provider.localChange(doc1, 'edit', (d) => {
      d.getMap('shared').set('x', 'synced');
      d.getArray('list').push(['item1']);
    });

    provider.remoteChange(doc2, changes);
    expect(doc2.getMap('shared').get('x')).toBe('synced');
    expect(doc2.getArray('list').get(0)).toBe('item1');
  });
});

describe('YjsACL', () => {
  test('add() adds user and check() returns true', async () => {
    const acl = new YjsACL();
    const changes = await acl.add(key1);
    expect(changes).toBeInstanceOf(Uint8Array);
    expect(changes.length).toBeGreaterThan(0);
    expect(await acl.check(key1)).toBe(true);
  });

  test('remove() removes user and check() returns false', async () => {
    const acl = new YjsACL();
    await acl.add(key1);
    expect(await acl.check(key1)).toBe(true);
    const removeChanges = await acl.remove(key1);
    expect(removeChanges).toBeInstanceOf(Uint8Array);
    expect(await acl.check(key1)).toBe(false);
  });

  test('check() returns false for unknown key', async () => {
    const acl = new YjsACL();
    expect(await acl.check(key1)).toBe(false);
  });

  test('users() returns all added keys', async () => {
    const acl = new YjsACL();
    await acl.add(key1);
    await acl.add(key2);
    const users = await acl.users();
    expect(users).toHaveLength(2);

    // Verify the exported raw bytes match both test keys
    const rawKeys = await Promise.all(
      users.map((k) => crypto.subtle.exportKey('raw', k)),
    );
    const rawKey1 = await crypto.subtle.exportKey('raw', key1);
    const rawKey2 = await crypto.subtle.exportKey('raw', key2);

    const rawSet = new Set(
      rawKeys.map((buf) =>
        Array.from(new Uint8Array(buf))
          .map((b) => b.toString(16).padStart(2, '0'))
          .join(''),
      ),
    );
    const hex1 = Array.from(new Uint8Array(rawKey1))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
    const hex2 = Array.from(new Uint8Array(rawKey2))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
    expect(rawSet.has(hex1)).toBe(true);
    expect(rawSet.has(hex2)).toBe(true);
  });

  test('current() and merge() export and sync between ACLs', async () => {
    const acl1 = new YjsACL();
    await acl1.add(key1);

    const snapshot = acl1.current();
    expect(snapshot).toBeInstanceOf(Uint8Array);

    const acl2 = new YjsACL();
    acl2.merge(snapshot);
    expect(await acl2.check(key1)).toBe(true);
  });

  test('YjsACLProvider.initialize() returns a new YjsACL', () => {
    const provider = new YjsACLProvider();
    const acl = provider.initialize();
    expect(acl).toBeInstanceOf(YjsACL);
  });
});

describe('YjsKeychain', () => {
  test('add() returns [keyIDBytes, CryptoKey, changes]', async () => {
    const keychain = new YjsKeychain();
    const [keyIDBytes, key, changes] = await keychain.add();
    expect(keyIDBytes).toBeInstanceOf(Uint8Array);
    expect(keyIDBytes.length).toBe(16); // UUID v4 = 16 bytes
    expect(key).toBeDefined();
    expect(key.type).toBe('secret');
    expect(changes).toBeInstanceOf(Uint8Array);
    expect(changes.length).toBeGreaterThan(0);
  });

  test('keys() returns all added keys', async () => {
    const keychain = new YjsKeychain();
    await keychain.add();
    await keychain.add();
    const allKeys = await keychain.keys();
    expect(allKeys).toHaveLength(2);
    for (const [idBytes, key] of allKeys) {
      expect(idBytes).toBeInstanceOf(Uint8Array);
      expect(idBytes.length).toBe(16);
      expect(key.type).toBe('secret');
    }
  });

  test('getKey() retrieves cached key by ID bytes', async () => {
    const keychain = new YjsKeychain();
    const [keyIDBytes, originalKey] = await keychain.add();
    const retrieved = keychain.getKey(keyIDBytes);
    expect(retrieved).toBe(originalKey);
  });

  test('getKey() returns undefined for unknown ID', () => {
    const keychain = new YjsKeychain();
    const unknownID = new Uint8Array(16);
    expect(keychain.getKey(unknownID)).toBeUndefined();
  });

  test('current() throws on empty keychain', async () => {
    const keychain = new YjsKeychain();
    await expect(keychain.current()).rejects.toThrow(
      "Can't get an empty keychain's current value",
    );
  });

  test('current() returns last added key', async () => {
    const keychain = new YjsKeychain();
    await keychain.add();
    const [keyIDBytes2, key2] = await keychain.add();
    const [currentID, currentKey] = await keychain.current();
    // Compare UUID bytes
    expect(Array.from(currentID)).toEqual(Array.from(keyIDBytes2));
    // Same raw key material
    const rawCurrent = await crypto.subtle.exportKey('raw', currentKey);
    const rawKey2 = await crypto.subtle.exportKey('raw', key2);
    expect(new Uint8Array(rawCurrent)).toEqual(new Uint8Array(rawKey2));
  });

  test('history() and merge() export and sync between keychains', async () => {
    const kc1 = new YjsKeychain();
    const [keyIDBytes] = await kc1.add();

    const snapshot = kc1.history();
    expect(snapshot).toBeInstanceOf(Uint8Array);

    const kc2 = new YjsKeychain();
    kc2.merge(snapshot);
    const kc2Keys = await kc2.keys();
    expect(kc2Keys).toHaveLength(1);
    expect(Array.from(kc2Keys[0][0])).toEqual(Array.from(keyIDBytes));
  });

  test('YjsKeychainProvider.initialize() returns YjsKeychain with keyIDLength=16', () => {
    const provider = new YjsKeychainProvider();
    const keychain = provider.initialize();
    expect(keychain).toBeInstanceOf(YjsKeychain);
    expect(provider.keyIDLength).toBe(16);
  });
});

describe('YjsJSONSerializer', () => {
  test('serializeChanges/deserializeChanges are identity (passthrough)', () => {
    const serializer = new YjsJSONSerializer();
    const data = new Uint8Array([10, 20, 30, 40]);
    expect(serializer.serializeChanges(data)).toBe(data);
    expect(serializer.deserializeChanges(data)).toBe(data);
  });

  test('serializeChangeBlock/deserializeChangeBlock round-trip', () => {
    const serializer = new YjsJSONSerializer();
    const block = {
      changes: new Uint8Array([1, 2, 3, 4, 5]),
      nonce: new Uint8Array([10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21]),
    };
    const serialized = serializer.serializeChangeBlock(block);
    expect(typeof serialized).toBe('string');

    const deserialized = serializer.deserializeChangeBlock(serialized);
    expect(deserialized.changes).toEqual(block.changes);
    expect(deserialized.nonce).toEqual(block.nonce);
  });

  test('serializeSyncMessage/deserializeSyncMessage round-trip with Merkle DAG', () => {
    const serializer = new YjsJSONSerializer();
    const message = {
      documentId: 'test-doc-123',
      changeId: 'cid-abc',
      changes: {
        kind: 'document' as const,
        change: new Uint8Array([100, 101, 102]),
        children: {
          'child-hash-1': {
            kind: 'writer' as const,
            change: new Uint8Array([200, 201]),
          },
        },
      },
      keychainChanges: new Uint8Array([50, 51, 52]),
    };

    const serialized = serializer.serializeSyncMessage(message);
    expect(serialized).toBeInstanceOf(Uint8Array);

    const deserialized = serializer.deserializeSyncMessage(serialized);
    expect(deserialized.documentId).toBe('test-doc-123');
    expect(deserialized.changeId).toBe('cid-abc');
    expect(deserialized.changes).toBeDefined();
    expect(deserialized.changes!.kind).toBe('document');
    expect(deserialized.changes!.change).toEqual(new Uint8Array([100, 101, 102]));
    expect(deserialized.changes!.children).toBeDefined();
    const children = deserialized.changes!.children as {
      [hash: string]: { kind: string; change?: Uint8Array };
    };
    expect(children['child-hash-1'].kind).toBe('writer');
    expect(children['child-hash-1'].change).toEqual(new Uint8Array([200, 201]));
    expect(deserialized.keychainChanges).toEqual(new Uint8Array([50, 51, 52]));
  });

  test('serializeSyncMessage handles message without optional fields', () => {
    const serializer = new YjsJSONSerializer();
    const message = {
      documentId: 'minimal-doc',
    };

    const serialized = serializer.serializeSyncMessage(message);
    const deserialized = serializer.deserializeSyncMessage(serialized);
    expect(deserialized.documentId).toBe('minimal-doc');
    expect(deserialized.changes).toBeUndefined();
    expect(deserialized.keychainChanges).toBeUndefined();
  });
});
