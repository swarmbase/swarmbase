import {
  ACL,
  ACLProvider,
  CollabswarmDocumentChangeHandler,
  CRDTChangeBlock,
  CRDTChangeNode,
  CRDTChangeNodeDeferred,
  crdtChangeNodeDeferred,
  CRDTChangeNodeKind,
  CRDTProvider,
  CRDTSyncMessage,
  JSONSerializer,
  Keychain,
  KeychainProvider,
} from '@collabswarm/collabswarm';
import { applyUpdateV2, Doc, encodeStateAsUpdateV2 } from 'yjs';
import * as uuid from 'uuid';
import { Base64 } from 'js-base64';

type iCRDTChangeNode = {
  kind: CRDTChangeNodeKind;
  // TODO: Change this to something more efficient.
  change?: string;
  children?: { [hash: string]: iCRDTChangeNode } | CRDTChangeNodeDeferred;
};

function serializeUint8ArrayInMerkleDAG(
  node: CRDTChangeNode<Uint8Array>,
): iCRDTChangeNode {
  const change = node.change ? Base64.fromUint8Array(node.change) : undefined;
  if (node.children !== undefined && node.children !== crdtChangeNodeDeferred) {
    const children: { [hash: string]: iCRDTChangeNode } = {};
    for (const [hash, child] of Object.entries(node.children)) {
      children[hash] = serializeUint8ArrayInMerkleDAG(child);
    }
    return {
      ...node,
      change,
      children,
    };
  } else {
    return {
      ...node,
      change,
      children: node.children,
    };
  }
}

function deserializeUint8ArrayInMerkleDAG(
  node: iCRDTChangeNode,
): CRDTChangeNode<Uint8Array> {
  const change = node.change ? Base64.toUint8Array(node.change) : undefined;
  if (node.children !== undefined && node.children !== crdtChangeNodeDeferred) {
    const children: { [hash: string]: CRDTChangeNode<Uint8Array> } = {};
    for (const [hash, child] of Object.entries(node.children)) {
      children[hash] = deserializeUint8ArrayInMerkleDAG(child);
    }
    return {
      ...node,
      change,
      children,
    };
  } else {
    return {
      ...node,
      change,
      children: node.children,
    };
  }
}

export class YjsJSONSerializer extends JSONSerializer<Uint8Array> {
  serializeChanges(changes: Uint8Array): Uint8Array {
    return changes;
  }
  deserializeChanges(changes: Uint8Array): Uint8Array {
    return changes;
  }

  serializeChangeBlock(changes: CRDTChangeBlock<Uint8Array>): string {
    return this.serialize({
      changes: Base64.fromUint8Array(changes.changes),
      nonce: Base64.fromUint8Array(changes.nonce),
    });
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
    const deserialized = raw as { changes: string; nonce: string };
    return {
      changes: Base64.toUint8Array(deserialized.changes),
      nonce: Base64.toUint8Array(deserialized.nonce),
    };
  }
  serializeSyncMessage(message: CRDTSyncMessage<Uint8Array>): Uint8Array {
    return this.encode(
      this.serialize({
        ...message,
        changes:
          message.changes && serializeUint8ArrayInMerkleDAG(message.changes),
        keychainChanges:
          message.keychainChanges &&
          Base64.fromUint8Array(message.keychainChanges),
      }),
    );
  }
  deserializeSyncMessage(message: Uint8Array): CRDTSyncMessage<Uint8Array> {
    const raw = this.deserialize(this.decode(message));
    if (typeof raw !== 'object' || raw === null || typeof (raw as Record<string, unknown>).documentId !== 'string') {
      throw new Error('Invalid sync message: expected object with documentId string');
    }
    const deserialized = raw as {
      documentId: string;
      changeId?: string;
      changes?: iCRDTChangeNode;
      keychainChanges?: string;
      signature?: string;
    };
    return {
      ...deserialized,
      changes:
        deserialized.changes &&
        deserializeUint8ArrayInMerkleDAG(deserialized.changes),
      keychainChanges: deserialized.keychainChanges
        ? Base64.toUint8Array(deserialized.keychainChanges)
        : undefined,
    };
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
    changeFn(document);

    // TODO: This might send the whole document state. Trim this down to only changes not sent yet.
    const changes = encodeStateAsUpdateV2(document);

    // TODO: This doesn't return a new reference.
    return [document, changes];
  }
  remoteChange(document: Doc, changes: Uint8Array): Doc {
    applyUpdateV2(document, changes);

    // TODO: This doesn't return a new reference.
    return document;
  }
  getHistory(document: Doc): Uint8Array {
    // TODO: This might send the whole document state. Trim this down to only changes not sent yet.
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

  async add(publicKey: CryptoKey): Promise<Uint8Array> {
    const hash = await serializeKey(publicKey);
    this._acl.getMap('users').set(hash, true);
    // TODO: This might send the whole document state. Trim this down to only changes not sent yet.
    const aclChanges = encodeStateAsUpdateV2(this._acl);
    return aclChanges;
  }
  async remove(publicKey: CryptoKey): Promise<Uint8Array> {
    const hash = await serializeKey(publicKey);
    if (this._acl.getMap('users').has(hash)) {
      this._acl.getMap('users').delete(hash);
    }
    // TODO: This might send the whole document state. Trim this down to only changes not sent yet.
    const aclChanges = encodeStateAsUpdateV2(this._acl);
    return aclChanges;
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
  users(): Promise<CryptoKey[]> {
    // TODO: Cache deserialized keys to make this faster.
    return Promise.all(
      [...this._acl.getMap('users').keys()].map(
        deserializeKey(
          {
            name: 'ECDSA',
            namedCurve: 'P-384',
          },
          ['verify'],
        ),
      ),
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
  // TODO: Replace this with a LRU cache of bounded size.
  private readonly _keyCache = new Map<string, CryptoKey>();
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
    this._keychain
      .getArray<[string, string]>('keys')
      .push([[keyID, serialized]]);
    // TODO: This might send the whole document state. Trim this down to only changes not sent yet.
    const keychainChanges = encodeStateAsUpdateV2(this._keychain);
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
    this._keychain
      .getArray<[string, string]>('keys')
      .push([[epochIdHex, serialized]]);
    return encodeStateAsUpdateV2(this._keychain);
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
