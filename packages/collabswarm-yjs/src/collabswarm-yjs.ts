import {
  ACL,
  ACLProvider,
  CollabswarmDocumentChangeHandler,
  CRDTChangeBlock,
  CRDTChangeNodeWire,
  CRDTProvider,
  CRDTSyncMessage,
  deserializeChangeNodeFromJSON,
  JSONSerializer,
  Keychain,
  KeychainProvider,
  LRUCache,
  serializeChangeNodeForJSON,
} from '@collabswarm/collabswarm';
import { validateChangeBlockMetadata } from '@collabswarm/collabswarm';
import { applyUpdateV2, Doc, encodeStateAsUpdateV2, encodeStateVector } from 'yjs';
import * as uuid from 'uuid';
import { Base64 } from 'js-base64';

// Binary data is stored as a base64 string for JSON serialization.
// Base64 has only ~33% payload expansion and is the standard encoding for
// binary data in JSON, so this is an acceptable trade-off.
type iCRDTChangeNode = CRDTChangeNodeWire<string>;

export class YjsJSONSerializer extends JSONSerializer<Uint8Array> {
  serializeChanges(changes: Uint8Array): Uint8Array {
    return changes;
  }
  deserializeChanges(changes: Uint8Array): Uint8Array {
    return changes;
  }

  serializeChangeBlock(changes: CRDTChangeBlock<Uint8Array>): string {
    const obj: Record<string, unknown> = {
      changes: Base64.fromUint8Array(changes.changes),
      nonce: Base64.fromUint8Array(changes.nonce),
    };
    if (changes.keyID !== undefined) obj.keyID = changes.keyID;
    if (changes.blindIndexTokens !== undefined && changes.blindIndexTokens !== null) obj.blindIndexTokens = changes.blindIndexTokens;
    return this.serialize(obj);
  }
  deserializeChangeBlock(changes: string): CRDTChangeBlock<Uint8Array> {
    const raw = this.deserialize(changes);
    if (
      typeof raw !== 'object' || raw === null ||
      typeof (raw as Record<string, unknown>).changes !== 'string' ||
      typeof (raw as Record<string, unknown>).nonce !== 'string'
    ) {
      throw new Error('Invalid change block: expected {changes: string, nonce: string}');
    }
    const deserialized = raw as { changes: string; nonce: string; keyID?: string; blindIndexTokens?: Record<string, string> };
    const result: CRDTChangeBlock<Uint8Array> = {
      changes: Base64.toUint8Array(deserialized.changes),
      nonce: Base64.toUint8Array(deserialized.nonce),
    };
    validateChangeBlockMetadata(deserialized, result);
    return result;
  }
  serializeSyncMessage(message: CRDTSyncMessage<Uint8Array>): Uint8Array {
    // Encode snapshot Uint8Array fields (state, signature) as base64 for JSON safety.
    let snapshotForWire: any;
    if (message.snapshot) {
      snapshotForWire = { ...message.snapshot };
      if (snapshotForWire.state instanceof Uint8Array) {
        snapshotForWire.state = Base64.fromUint8Array(snapshotForWire.state);
      }
      if (snapshotForWire.signature instanceof Uint8Array) {
        snapshotForWire.signature = Base64.fromUint8Array(snapshotForWire.signature);
      }
      // Drop publicKey from wire -- CryptoKey is not JSON-serializable and
      // snapshot verification uses writer ACL keys, not the embedded key.
      delete snapshotForWire.publicKey;
    }
    return this.encode(
      this.serialize({
        ...message,
        // Mirror the deserializer: only `undefined` skips the
        // serialization path. Any defined value flows through
        // `serializeChangeNodeForJSON` so the wire shape matches what
        // the deserializer will validate on the receiving end.
        changes:
          message.changes === undefined
            ? undefined
            : serializeChangeNodeForJSON(message.changes, Base64.fromUint8Array),
        keychainChanges:
          message.keychainChanges &&
          Base64.fromUint8Array(message.keychainChanges),
        snapshot: snapshotForWire,
      }),
    );
  }
  deserializeSyncMessage(message: Uint8Array): CRDTSyncMessage<Uint8Array> {
    const decoded = this.deserialize(this.decode(message));
    // Wire input is untrusted: reject non-object payloads up front with a
    // descriptive error so the malformed payload can be attributed back to
    // the peer instead of throwing a bare `TypeError`. Mirrors the guard in
    // `AutomergeJSONSerializer.deserializeSyncMessage`.
    if (typeof decoded !== 'object' || decoded === null || Array.isArray(decoded)) {
      throw new Error(
        `Invalid sync message: expected a plain object (got ${
          decoded === null
            ? 'null'
            : Array.isArray(decoded)
              ? 'array'
              : typeof decoded
        })`,
      );
    }
    const raw = decoded as {
      documentId?: unknown;
      changeId?: unknown;
      changes?: unknown;
      keychainChanges?: unknown;
      snapshot?: unknown;
      signature?: unknown;
    };
    // `documentId` is a required field on the wire contract. A malformed peer
    // could omit it or send a non-string value, which would otherwise
    // propagate as `documentId: undefined`/non-string into downstream
    // consumers that key documents by string ID.
    if (typeof raw.documentId !== 'string') {
      throw new Error(
        `Invalid sync message: 'documentId' must be a string (got ${
          raw.documentId === null ? 'null' : typeof raw.documentId
        })`,
      );
    }
    if (raw.changeId !== undefined && typeof raw.changeId !== 'string') {
      throw new Error(
        `Invalid sync message: 'changeId' must be a string when present (got ${typeof raw.changeId})`,
      );
    }
    if (raw.signature !== undefined && typeof raw.signature !== 'string') {
      throw new Error(
        `Invalid sync message: 'signature' must be a string when present (got ${typeof raw.signature})`,
      );
    }
    // Decode snapshot base64 fields back to Uint8Array.
    let snapshot: any;
    if (raw.snapshot) {
      if (typeof raw.snapshot !== 'object' || Array.isArray(raw.snapshot)) {
        throw new Error(
          `Invalid sync message: 'snapshot' must be an object when present (got ${
            Array.isArray(raw.snapshot) ? 'array' : typeof raw.snapshot
          })`,
        );
      }
      snapshot = { ...(raw.snapshot as Record<string, unknown>) };
      if (typeof snapshot.state === 'string') {
        snapshot.state = Base64.toUint8Array(snapshot.state);
      }
      if (typeof snapshot.signature === 'string') {
        snapshot.signature = Base64.toUint8Array(snapshot.signature);
      }
    }
    let keychainChanges: Uint8Array | undefined;
    if (raw.keychainChanges !== undefined) {
      if (typeof raw.keychainChanges !== 'string') {
        throw new Error(
          `Invalid sync message: 'keychainChanges' must be a string when present (got ${typeof raw.keychainChanges})`,
        );
      }
      keychainChanges = Base64.toUint8Array(raw.keychainChanges);
    }
    // Build the returned object explicitly rather than spreading `...raw` so
    // that peer-supplied junk keys don't leak into the deserialized sync
    // message. Only fields declared on `CRDTSyncMessage` are propagated.
    const result: CRDTSyncMessage<Uint8Array> = {
      documentId: raw.documentId,
    };
    if (raw.changeId !== undefined) result.changeId = raw.changeId as string;
    if (raw.signature !== undefined) result.signature = raw.signature as string;
    // Any value other than `undefined` (including `null`, `0`, `""`, etc.)
    // must be routed through the validator -- using a truthy guard like
    // `raw.changes && ...` would let a malformed peer message bypass
    // `deserializeChangeNodeFromJSON`'s shape checks by sending e.g.
    // `changes: null`, with the falsy value flowing through.
    if (raw.changes !== undefined) {
      result.changes = deserializeChangeNodeFromJSON(
        raw.changes as iCRDTChangeNode,
        Base64.toUint8Array,
      );
    }
    if (keychainChanges !== undefined) result.keychainChanges = keychainChanges;
    if (snapshot !== undefined) result.snapshot = snapshot;
    return result;
  }
}

export type YjsSwarmDocumentChangeHandler = CollabswarmDocumentChangeHandler<
  Doc,
  CryptoKey
>;

export class YjsProvider
  implements CRDTProvider<Doc, Uint8Array, (doc: Doc) => void>
{
  newDocument(): Doc {
    return new Doc();
  }
  localChange(
    document: Doc,
    message: string,
    changeFn: (doc: Doc) => void,
  ): [Doc, Uint8Array] {
    const beforeSV = encodeStateVector(document);
    changeFn(document);
    const changes = encodeStateAsUpdateV2(document, beforeSV);

    // Y.Doc is always mutated in-place -- returning the same reference is
    // correct Yjs behavior. Callers must not rely on reference equality to
    // detect changes.
    return [document, changes];
  }
  remoteChange(document: Doc, changes: Uint8Array): Doc {
    applyUpdateV2(document, changes);

    // Y.Doc is always mutated in-place -- returning the same reference is
    // correct Yjs behavior. Callers must not rely on reference equality to
    // detect changes.
    return document;
  }
  getHistory(document: Doc): Uint8Array {
    // This intentionally encodes the full document state. getHistory() is
    // used for initial sync with new peers, so the complete state is needed.
    // Incremental deltas are handled by localChange() which captures only
    // the changes made during a single mutation via
    // Y.encodeStateAsUpdate(doc, lastSyncState).
    return encodeStateAsUpdateV2(document);
  }
  getSnapshot(document: Doc): Uint8Array {
    return encodeStateAsUpdateV2(document);
  }
}

export async function serializeKey(publicKey: CryptoKey): Promise<string> {
  const buf = await crypto.subtle.exportKey('raw', publicKey);
  return Base64.fromUint8Array(new Uint8Array(buf));
}

export function deserializeKey(
  algorithm:
    | AlgorithmIdentifier
    | RsaHashedImportParams
    | EcKeyImportParams
    | HmacImportParams
    | AesKeyAlgorithm,
  keyUsages: KeyUsage[],
): (publicKey: string) => Promise<CryptoKey> {
  return (publicKey: string) => {
    const bytes = Base64.toUint8Array(publicKey);
    // Cast needed: Uint8Array<ArrayBufferLike> does not satisfy BufferSource (excludes SharedArrayBuffer)
    return crypto.subtle.importKey('raw', bytes as Uint8Array<ArrayBuffer>, algorithm, true, keyUsages);
  };
}


export class YjsACLProvider implements ACLProvider<Uint8Array, CryptoKey> {
  initialize(): ACL<Uint8Array, CryptoKey> {
    return new YjsACL();
  }
}

export class YjsACL implements ACL<Uint8Array, CryptoKey> {
  private readonly _acl = new Doc();
  private readonly _keyCache = new LRUCache<string, CryptoKey>(1000);

  async add(publicKey: CryptoKey): Promise<Uint8Array> {
    const hash = await serializeKey(publicKey);
    const beforeSV = encodeStateVector(this._acl);
    this._acl.getMap('users').set(hash, true);
    return encodeStateAsUpdateV2(this._acl, beforeSV);
  }
  async remove(publicKey: CryptoKey): Promise<Uint8Array> {
    const hash = await serializeKey(publicKey);
    const beforeSV = encodeStateVector(this._acl);
    if (this._acl.getMap('users').has(hash)) {
      this._acl.getMap('users').delete(hash);
    }
    return encodeStateAsUpdateV2(this._acl, beforeSV);
  }
  current(): Uint8Array {
    return encodeStateAsUpdateV2(this._acl);
  }
  merge(change: Uint8Array): void {
    applyUpdateV2(this._acl, change);
  }
  async check(publicKey: CryptoKey): Promise<boolean> {
    const hash = await serializeKey(publicKey);
    return this._acl.getMap('users').has(hash);
  }
  async users(): Promise<CryptoKey[]> {
    // Parallel deserialization for cold cache performance.
    // Create importer once to avoid per-miss closure allocation.
    const importKey = deserializeKey(
      { name: 'ECDSA', namedCurve: 'P-384' },
      ['verify'],
    );
    const entries = [...this._acl.getMap('users').keys()];
    return Promise.all(
      entries.map(async (serializedKey) => {
        let key = this._keyCache.get(serializedKey);
        if (!key) {
          key = await importKey(serializedKey);
          this._keyCache.set(serializedKey, key);
        }
        return key;
      }),
    );
  }
}

/**
 * Convert a Uint8Array to a hex string for use as a cache key.
 */
function toHex(bytes: Uint8Array): string {
  const hexChars: string[] = new Array(bytes.length);
  for (let i = 0; i < bytes.length; i++) {
    hexChars[i] = bytes[i].toString(16).padStart(2, '0');
  }
  return hexChars.join('');
}

/**
 * Convert a key ID (either 16-byte UUID or 32-byte epoch ID) to a cache key string.
 */
function keyIdToCacheKey(keyIDBytes: Uint8Array): string {
  if (keyIDBytes.length === 16) {
    return uuid.stringify(keyIDBytes);
  }
  return toHex(keyIDBytes);
}

/**
 * Parse a cache key string back to a Uint8Array key ID.
 * Validates UUID format with regex before parsing, and validates hex strings
 * for correct format and even length.
 *
 * @throws {Error} If the cache key is not a valid UUID or hex string.
 */
function cacheKeyToKeyId(cacheKey: string): Uint8Array {
  // UUID format: 8-4-4-4-12 hex digits with dashes
  const uuidRegex = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$/;
  if (uuidRegex.test(cacheKey)) {
    return new Uint8Array(uuid.parse(cacheKey));
  }
  // Hex-encoded epoch ID: must be even-length and only hex characters
  const hexRegex = /^[0-9a-fA-F]+$/;
  if (!hexRegex.test(cacheKey) || cacheKey.length % 2 !== 0) {
    throw new Error(`Invalid cache key format: expected UUID or even-length hex string, got "${cacheKey}"`);
  }
  const bytes = new Uint8Array(cacheKey.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(cacheKey.substring(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

export class YjsKeychain implements Keychain<Uint8Array, CryptoKey> {
  private readonly _keyCache = new LRUCache<string, CryptoKey>(1000);
  private readonly _keychain = new Doc();

  async add(): Promise<[Uint8Array, CryptoKey, Uint8Array]> {
    const keyID = uuid.v4();
    const keyIDBytes = new Uint8Array(uuid.parse(keyID));

    const keyIDBytesID = uuid.stringify(keyIDBytes);
    if (keyID !== keyIDBytesID) {
      console.error(`Key ID ${keyID} is not equal to ${keyIDBytesID}`);
      throw new Error(`Key ID ${keyID} is not equal to ${keyIDBytesID}`);
    }

    const key = await crypto.subtle.generateKey(
      {
        name: 'AES-GCM',
        length: 256,
      },
      true,
      ['encrypt', 'decrypt'],
    );

    this._keyCache.set(keyID, key);
    const serialized = await serializeKey(key);
    const beforeSV = encodeStateVector(this._keychain);
    this._keychain
      .getArray<[string, string]>('keys')
      .push([[keyID, serialized]]);
    const keychainChanges = encodeStateAsUpdateV2(this._keychain, beforeSV);
    return [keyIDBytes, key, keychainChanges];
  }

  /**
   * Add an epoch-based encryption key to the keychain.
   *
   * Epoch keys are used for key rotation: each epoch has a unique 32-byte ID
   * and an associated AES-GCM symmetric key. The key is cached locally and
   * appended to the CRDT keychain for synchronization with peers.
   *
   * @param epochId - The 32-byte epoch identifier.
   * @param key - The AES-GCM CryptoKey for this epoch.
   * @returns The serialized keychain state as a Yjs update for broadcasting.
   */
  async addEpochKey(epochId: Uint8Array, key: CryptoKey): Promise<Uint8Array> {
    const epochIdHex = toHex(epochId);
    this._keyCache.set(epochIdHex, key);
    const serialized = await serializeKey(key);
    const beforeSV = encodeStateVector(this._keychain);
    this._keychain
      .getArray<[string, string]>('keys')
      .push([[epochIdHex, serialized]]);
    return encodeStateAsUpdateV2(this._keychain, beforeSV);
  }

  history(): Uint8Array {
    return encodeStateAsUpdateV2(this._keychain);
  }
  merge(change: Uint8Array): void {
    applyUpdateV2(this._keychain, change);
  }
  async keys(): Promise<[Uint8Array, CryptoKey][]> {
    const yarr = this._keychain.getArray<[string, string]>('keys');
    const promises: Promise<[Uint8Array, CryptoKey]>[] = [];
    for (let i = 0; i < yarr.length; i++) {
      const [keyID, serialized] = yarr.get(i);
      const keyIDBytes = cacheKeyToKeyId(keyID);
      promises.push(
        (async () => {
          let key = this._keyCache.get(keyID);
          if (!key) {
            key = await deserializeKey({ name: 'AES-GCM', length: 256 }, [
              'encrypt',
              'decrypt',
            ])(serialized);
            this._keyCache.set(keyID, key);
          }
          return [keyIDBytes, key] as [Uint8Array, CryptoKey];
        })(),
      );
    }

    return await Promise.all(promises);
  }
  async current(): Promise<[Uint8Array, CryptoKey]> {
    const yarr = this._keychain.getArray<string>('keys');
    if (yarr.length === 0) {
      throw new Error("Can't get an empty keychain's current value");
    }

    const [keyID, serialized] = yarr.get(yarr.length - 1);
    const keyIDBytes = cacheKeyToKeyId(keyID);

    let key = this._keyCache.get(keyID);
    if (!key) {
      key = await deserializeKey({ name: 'AES-GCM', length: 256 }, [
        'encrypt',
        'decrypt',
      ])(serialized);
      this._keyCache.set(keyID, key);
    }
    return [keyIDBytes, key];
  }
  async currentKeyChange(): Promise<Uint8Array> {
    const yarr = this._keychain.getArray<[string, string]>('keys');
    if (yarr.length === 0) {
      throw new Error("Can't get current key change from an empty keychain");
    }

    // Build a minimal Y.Doc containing only the current (most recent) key.
    const minimalDoc = new Doc();
    const [keyID, serialized] = yarr.get(yarr.length - 1);
    minimalDoc.getArray<[string, string]>('keys').push([[keyID, serialized]]);
    return encodeStateAsUpdateV2(minimalDoc);
  }
  /**
   * Synchronous cache lookup for a key by its ID bytes.
   *
   * This is intentionally a pure cache lookup. Use keys() or current() to
   * ensure keys are imported and cached before calling getKey.
   */
  getKey(keyIDBytes: Uint8Array): CryptoKey | undefined {
    const cacheKey = keyIdToCacheKey(keyIDBytes);
    return this._keyCache.get(cacheKey);
  }
}

export class YjsKeychainProvider
  implements KeychainProvider<Uint8Array, CryptoKey>
{
  initialize(): YjsKeychain {
    return new YjsKeychain();
  }

  // UUID v4 is 16 bytes. Epoch IDs are 32 bytes.
  // Use 16 for backward compatibility; will be updated to 32 when
  // epoch-based key management is fully activated.
  keyIDLength = 16;
}
