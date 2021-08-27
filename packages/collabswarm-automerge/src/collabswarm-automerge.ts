import {
  Doc,
  init,
  change,
  getChanges,
  applyChanges,
  BinaryChange,
  getAllChanges,
  from,
} from 'automerge';

import {
  ACL,
  ACLProvider,
  CollabswarmDocumentChangeHandler,
  CRDTProvider,
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
    const [newDoc, patch] = applyChanges(document, changes);
    return newDoc;
  }
  getHistory(document: Doc<T>): BinaryChange[] {
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
    | DhImportKeyParams
    | AesKeyAlgorithm,
  keyUsages: KeyUsage[],
): (publicKey: string) => Promise<CryptoKey> {
  return (publicKey: string) => {
    const bytes = Base64.toUint8Array(publicKey);
    return crypto.subtle.importKey('raw', bytes, algorithm, true, keyUsages);
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
  async check(publicKey: CryptoKey): Promise<boolean> {
    const hash = await serializeKey(publicKey);
    return this._acl.users && this._acl.users[hash] !== undefined;
  }
  async users(): Promise<CryptoKey[]> {
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
        const keyIDBytes = new Uint8Array(uuid.parse(keyID));
        let key = this._keyCache.get(keyID);
        if (!key) {
          key = await deserializeKey({ name: 'AES-GCM', length: 256 }, [
            'encrypt',
            'decrypt',
          ])(serialized);
        }
        return [keyIDBytes, key] as [Uint8Array, CryptoKey];
      }),
    );
  }
  async current(): Promise<[Uint8Array, CryptoKey]> {
    if (!this._keychain.keys) {
      throw new Error("Can't get an empty keychain's current value");
    }

    const [keyID, serialized] = this._keychain.keys[this._keychain.keys.length];
    const keyIDBytes = new Uint8Array(uuid.parse(keyID));

    let key = this._keyCache.get(keyID);
    if (!key) {
      key = await deserializeKey({ name: 'AES-GCM', length: 256 }, [
        'encrypt',
        'decrypt',
      ])(serialized);
    }
    return [keyIDBytes, key];
  }
  getKey(keyIDBytes: Uint8Array): CryptoKey | undefined {
    const keyID = uuid.stringify(keyIDBytes);
    return this._keyCache.get(keyID);
  }
}

export class AutomergeKeychainProvider
  implements KeychainProvider<BinaryChange[], CryptoKey>
{
  initialize(): AutomergeKeychain {
    return new AutomergeKeychain();
  }

  // UUID v4 is 32 characters as a string and 16 bytes parsed (Uint8Array).
  keyIDLength = 16;
}

export class AutomergeJSONSerializer extends JSONSerializer<BinaryChange[]> {}
