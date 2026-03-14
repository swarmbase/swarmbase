import {
  Doc,
  init,
  change,
  getChanges,
  applyChanges,
  Change as BinaryChange,
  getAllChanges,
  from,
} from '@automerge/automerge';

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
import { Base64 } from 'js-base64';

import * as uuid from 'uuid';

export type AutomergeSwarmDocumentChangeHandler<T = any> =
  CollabswarmDocumentChangeHandler<Doc<T>, CryptoKey>;

export class AutomergeProvider<T = any>
  implements CRDTProvider<Doc<T>, BinaryChange[], (doc: T) => void>
{
  newDocument(): Doc<T> {
    return init();
  }
  localChange(
    document: Doc<T>,
    message: string,
    changeFn: (doc: T) => void,
  ): [Doc<T>, BinaryChange[]] {
    const newDocument = message
      ? change(document, message, changeFn)
      : change(document, changeFn);
    const changes = getChanges(document, newDocument);
    return [newDocument, changes];
  }
  remoteChange(document: Doc<T>, changes: BinaryChange[]): Doc<T> {
    const [newDoc] = applyChanges(document, changes);
    return newDoc;
  }
  getHistory(document: Doc<T>): BinaryChange[] {
    return getAllChanges(document);
  }
  getSnapshot(document: Doc<T>): BinaryChange[] {
    // Returns all changes as the snapshot representation. A more compact
    // approach would use Automerge.save() (returns Uint8Array), but that
    // requires a different ChangesType and remoteChange() implementation.
    // For now, getAllChanges() is compatible with the existing applyChanges()
    // path used by remoteChange().
    return getAllChanges(document);
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

export type AutomergeACLDoc = Doc<{
  users: { [hash: string]: true };
}>;

export class AutomergeACL implements ACL<BinaryChange[], CryptoKey> {
  private _acl: AutomergeACLDoc = from({
    users: {},
  });

  async add(publicKey: CryptoKey): Promise<BinaryChange[]> {
    const hash = await serializeKey(publicKey);
    const aclNew = change(this._acl, (doc) => {
      if (!doc.users) {
        doc.users = {};
      }
      doc.users[hash] = true;
    });
    const aclChanges = getChanges(this._acl, aclNew);
    this._acl = aclNew;
    return aclChanges;
  }
  async remove(publicKey: CryptoKey): Promise<BinaryChange[]> {
    const hash = await serializeKey(publicKey);
    const aclNew = change(this._acl, (doc) => {
      if (!doc.users) {
        doc.users = {};
      } else {
        if (doc.users[hash] !== undefined) {
          delete doc.users[hash];
        }
      }
    });
    const aclChanges = getChanges(this._acl, aclNew);
    this._acl = aclNew;
    return aclChanges;
  }
  current(): BinaryChange[] {
    return getAllChanges(this._acl);
  }
  merge(change: BinaryChange[]): void {
    const [doc] = applyChanges(this._acl, change);
    this._acl = doc;
  }
  // AutomergeACL uses binary access control (user is either in the list or not).
  // The capability parameter is accepted for interface compatibility but ignored here;
  // capability-based filtering is handled at the UCANACL wrapper level.
  async check(publicKey: CryptoKey, capability?: string): Promise<boolean> {
    const hash = await serializeKey(publicKey);
    return this._acl.users && this._acl.users[hash] !== undefined;
  }
  // The capability parameter is accepted for interface compatibility but ignored here;
  // capability-based filtering is handled at the UCANACL wrapper level.
  async users(capability?: string): Promise<CryptoKey[]> {
    // TODO: Cache deserialized keys to make this faster.
    return Promise.all(
      Object.keys(this._acl.users).map(
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

export class AutomergeACLProvider
  implements ACLProvider<BinaryChange[], CryptoKey>
{
  initialize(): AutomergeACL {
    return new AutomergeACL();
  }
}

export type AutomergeKeychainDoc = Doc<{
  keys: [string, string][];
}>;

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

export class AutomergeKeychain implements Keychain<BinaryChange[], CryptoKey> {
  // TODO: Replace this with a LRU cache of bounded size.
  private readonly _keyCache = new Map<string, CryptoKey>();
  private _keychain: AutomergeKeychainDoc = from({
    keys: [],
  });

  async add(): Promise<[Uint8Array, CryptoKey, BinaryChange[]]> {
    const keyID = uuid.v4();
    const keyIDBytes = new Uint8Array(uuid.parse(keyID));
    const key = await crypto.subtle.generateKey(
      {
        name: 'AES-GCM',
        length: 256,
      },
      true,
      ['encrypt', 'decrypt'],
    );

    const serialized = await serializeKey(key);
    this._keyCache.set(keyID, key);
    const keychainNew = change(this._keychain, (doc) => {
      if (!doc.keys) {
        doc.keys = [];
      }
      doc.keys.push([keyID, serialized]);
    });
    const keychainChanges = getChanges(this._keychain, keychainNew);
    this._keychain = keychainNew;
    return [keyIDBytes, key, keychainChanges];
  }

  /**
   * Add an epoch-based encryption key to the keychain.
   *
   * Epoch keys are used for key rotation: each epoch has a unique 32-byte ID
   * and an associated AES-GCM symmetric key. The key is cached locally and
   * appended to the Automerge keychain document for synchronization with peers.
   *
   * @param epochId - The 32-byte epoch identifier.
   * @param key - The AES-GCM CryptoKey for this epoch.
   * @returns The Automerge changes representing the keychain update for broadcasting.
   */
  async addEpochKey(epochId: Uint8Array, key: CryptoKey): Promise<BinaryChange[]> {
    const epochIdHex = toHex(epochId);
    this._keyCache.set(epochIdHex, key);
    const serialized = await serializeKey(key);
    const keychainNew = change(this._keychain, (doc) => {
      if (!doc.keys) {
        doc.keys = [];
      }
      doc.keys.push([epochIdHex, serialized]);
    });
    const keychainChanges = getChanges(this._keychain, keychainNew);
    this._keychain = keychainNew;
    return keychainChanges;
  }

  history(): BinaryChange[] {
    return getAllChanges(this._keychain);
  }
  merge(change: BinaryChange[]): void {
    const [doc] = applyChanges(this._keychain, change);
    this._keychain = doc;
  }
  async keys(): Promise<[Uint8Array, CryptoKey][]> {
    if (!this._keychain.keys) {
      return [];
    }
    return await Promise.all(
      this._keychain.keys.map(async ([keyID, serialized]) => {
        const keyIDBytes = cacheKeyToKeyId(keyID);
        let key = this._keyCache.get(keyID);
        if (!key) {
          key = await deserializeKey({ name: 'AES-GCM', length: 256 }, [
            'encrypt',
            'decrypt',
          ])(serialized);
          this._keyCache.set(keyID, key);
        }
        return [keyIDBytes, key] as [Uint8Array, CryptoKey];
      }),
    );
  }
  async current(): Promise<[Uint8Array, CryptoKey]> {
    if (!this._keychain.keys || this._keychain.keys.length === 0) {
      throw new Error("Can't get an empty keychain's current value");
    }

    const [keyID, serialized] = this._keychain.keys[this._keychain.keys.length - 1];
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
  async currentKeyChange(): Promise<BinaryChange[]> {
    if (!this._keychain.keys || this._keychain.keys.length === 0) {
      throw new Error("Can't get current key change from an empty keychain");
    }

    // Build a minimal Automerge doc containing only the current (most recent) key.
    const [keyID, serialized] = this._keychain.keys[this._keychain.keys.length - 1];
    const minimalDoc = change(from({ keys: [] as [string, string][] }), (doc) => {
      doc.keys.push([keyID, serialized]);
    });
    return getAllChanges(minimalDoc);
  }
  getKey(keyIDBytes: Uint8Array): CryptoKey | undefined {
    const cacheKey = keyIdToCacheKey(keyIDBytes);
    return this._keyCache.get(cacheKey);
  }
}

export class AutomergeKeychainProvider
  implements KeychainProvider<BinaryChange[], CryptoKey>
{
  initialize(): AutomergeKeychain {
    return new AutomergeKeychain();
  }

  // UUID v4 is 16 bytes. Epoch IDs are 32 bytes.
  // Use 16 for backward compatibility; will be updated to 32 when
  // epoch-based key management is fully activated.
  keyIDLength = 16;
}

/**
 * Intermediate wire type for Automerge Merkle-DAG nodes where each
 * BinaryChange[] is represented as base64-encoded strings.
 */
type iCRDTChangeNode = {
  kind: CRDTChangeNodeKind;
  change?: string[];
  children?: { [hash: string]: iCRDTChangeNode } | CRDTChangeNodeDeferred;
};

function serializeBinaryChangesInMerkleDAG(
  node: CRDTChangeNode<BinaryChange[]>,
): iCRDTChangeNode {
  const change = node.change
    ? node.change.map((c: Uint8Array) => Base64.fromUint8Array(c))
    : undefined;
  if (node.children !== undefined && node.children !== crdtChangeNodeDeferred) {
    const children: { [hash: string]: iCRDTChangeNode } = {};
    for (const [hash, child] of Object.entries(node.children)) {
      children[hash] = serializeBinaryChangesInMerkleDAG(child);
    }
    return { ...node, change, children };
  }
  return { ...node, change, children: node.children };
}

function deserializeBinaryChangesInMerkleDAG(
  node: iCRDTChangeNode,
): CRDTChangeNode<BinaryChange[]> {
  const change = node.change
    ? (node.change.map((c: string) => Base64.toUint8Array(c)) as BinaryChange[])
    : undefined;
  if (node.children !== undefined && node.children !== crdtChangeNodeDeferred) {
    const children: { [hash: string]: CRDTChangeNode<BinaryChange[]> } = {};
    for (const [hash, child] of Object.entries(node.children)) {
      children[hash] = deserializeBinaryChangesInMerkleDAG(child);
    }
    return { ...node, change, children };
  }
  return { ...node, change, children: node.children };
}

function serializeBinaryChanges(changes: BinaryChange[]): string[] {
  return changes.map((c: Uint8Array) => Base64.fromUint8Array(c));
}

function deserializeBinaryChanges(changes: string[]): BinaryChange[] {
  return changes.map((c: string) => Base64.toUint8Array(c)) as BinaryChange[];
}

export class AutomergeJSONSerializer extends JSONSerializer<BinaryChange[]> {
  serializeChanges(changes: BinaryChange[]): Uint8Array {
    return this.encode(this.serialize(serializeBinaryChanges(changes)));
  }

  deserializeChanges(changes: Uint8Array): BinaryChange[] {
    const raw = this.deserialize(this.decode(changes));
    if (!Array.isArray(raw)) {
      throw new Error('Invalid serialized changes: expected string[]');
    }
    return deserializeBinaryChanges(raw as string[]);
  }

  serializeChangeBlock(changes: CRDTChangeBlock<BinaryChange[]>): string {
    const obj: Record<string, unknown> = {
      changes: serializeBinaryChanges(changes.changes),
      nonce: Base64.fromUint8Array(changes.nonce),
    };
    if ('blindIndexTokens' in changes) {
      obj.blindIndexTokens = changes.blindIndexTokens;
    }
    return this.serialize(obj);
  }

  deserializeChangeBlock(changes: string): CRDTChangeBlock<BinaryChange[]> {
    const raw = this.deserialize(changes);
    if (
      typeof raw !== 'object' || raw === null ||
      !Array.isArray((raw as Record<string, unknown>).changes) ||
      typeof (raw as Record<string, unknown>).nonce !== 'string'
    ) {
      throw new Error('Invalid change block: expected {changes: string[], nonce: string}');
    }
    const deserialized = raw as { changes: string[]; nonce: string; blindIndexTokens?: Record<string, string> };
    const result: CRDTChangeBlock<BinaryChange[]> = {
      changes: deserializeBinaryChanges(deserialized.changes),
      nonce: Base64.toUint8Array(deserialized.nonce),
    };
    if ('blindIndexTokens' in deserialized) {
      result.blindIndexTokens = deserialized.blindIndexTokens;
    }
    return result;
  }

  serializeSyncMessage(message: CRDTSyncMessage<BinaryChange[]>): Uint8Array {
    let snapshotForWire: any;
    if (message.snapshot) {
      snapshotForWire = { ...message.snapshot };
      // Base64-encode each BinaryChange (Uint8Array) in state for JSON safety.
      if (Array.isArray(snapshotForWire.state)) {
        snapshotForWire.state = snapshotForWire.state.map(
          (c: Uint8Array) => Base64.fromUint8Array(c),
        );
      }
      if (snapshotForWire.signature instanceof Uint8Array) {
        snapshotForWire.signature = Base64.fromUint8Array(snapshotForWire.signature);
      }
      // Drop publicKey — CryptoKey is not JSON-serializable and
      // snapshot verification uses writer ACL keys, not the embedded key.
      delete snapshotForWire.publicKey;
    }
    return this.encode(
      this.serialize({
        ...message,
        changes:
          message.changes && serializeBinaryChangesInMerkleDAG(message.changes),
        keychainChanges:
          message.keychainChanges &&
          serializeBinaryChanges(message.keychainChanges),
        snapshot: snapshotForWire,
      }),
    );
  }

  deserializeSyncMessage(message: Uint8Array): CRDTSyncMessage<BinaryChange[]> {
    const raw = this.deserialize(this.decode(message)) as any;
    let snapshot: any;
    if (raw.snapshot) {
      snapshot = { ...raw.snapshot };
      // Decode base64-encoded BinaryChange[] back to Uint8Array[].
      if (Array.isArray(snapshot.state)) {
        snapshot.state = snapshot.state.map(
          (c: string) => Base64.toUint8Array(c),
        );
      }
      if (typeof snapshot.signature === 'string') {
        snapshot.signature = Base64.toUint8Array(snapshot.signature);
      }
    }
    return {
      ...raw,
      changes:
        raw.changes && deserializeBinaryChangesInMerkleDAG(raw.changes),
      keychainChanges:
        raw.keychainChanges
          ? deserializeBinaryChanges(raw.keychainChanges)
          : undefined,
      snapshot,
    } as CRDTSyncMessage<BinaryChange[]>;
  }
}
