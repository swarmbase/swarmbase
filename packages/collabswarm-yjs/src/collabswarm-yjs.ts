import {
  ACL,
  ACLProvider,
  Collabswarm,
  CollabswarmDocument,
  CollabswarmDocumentChangeHandler,
  CRDTProvider,
  CRDTSyncMessage,
  JSONSerializer,
  Keychain,
  KeychainProvider,
} from '@collabswarm/collabswarm';
import {
  applyUpdateV2,
  Doc,
  Map as YMap,
  Array as YArray,
  encodeStateAsUpdateV2,
} from 'yjs';

export type YjsSwarmDocumentChangeHandler = CollabswarmDocumentChangeHandler<Doc>;

// export type YjsSwarmDocument = CollabswarmDocument<Doc, Uint8Array, (doc: Doc) => void, YjsSwarmSyncMessage>;

export class YjsProvider
  implements CRDTProvider<Doc, Uint8Array, (doc: Doc) => void> {
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

export async function hashKey(publicKey: CryptoKey): Promise<string> {
  const buf = await crypto.subtle.exportKey('raw', publicKey);
  let binary = '';
  let bytes = new Uint8Array(buf);
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return window.btoa(binary);
}

export async function unhashKey(publicKey: string): Promise<CryptoKey> {
  let binaryString = window.atob(publicKey);
  let bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return await crypto.subtle.importKey('raw', bytes, 'AES-GCM', true, [
    'encrypt',
    'decrypt',
  ]);
}

export class YjsACLProvider implements ACLProvider<Uint8Array, CryptoKey> {
  initialize(): ACL<Uint8Array, CryptoKey> {
    return new YjsACL();
  }
}

export class YjsACL implements ACL<Uint8Array, CryptoKey> {
  private readonly _acl = new Doc();

  async add(publicKey: CryptoKey): Promise<Uint8Array> {
    const hash = await hashKey(publicKey);
    this._acl.getMap('users').set(hash, true);
    // TODO: This might send the whole document state. Trim this down to only changes not sent yet.
    const aclChanges = encodeStateAsUpdateV2(this._acl);
    return aclChanges;
  }
  async remove(publicKey: CryptoKey): Promise<Uint8Array> {
    const hash = await hashKey(publicKey);
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
    const hash = await hashKey(publicKey);
    return this._acl.getMap('users').has(hash);
  }
}

export class YjsKeychain implements Keychain<Uint8Array, CryptoKey> {
  // TODO: Replace this with a LRU cache of bounded size.
  private readonly _keyCache = new Map<string, CryptoKey>();
  private readonly _keychain = new Doc();

  async add(key: CryptoKey): Promise<Uint8Array> {
    const hash = await hashKey(key);
    this._keyCache.set(hash, key);
    this._keychain.getArray<string>('keys').push([hash]);
    // TODO: This might send the whole document state. Trim this down to only changes not sent yet.
    const keychainChanges = encodeStateAsUpdateV2(this._keychain);
    return keychainChanges;
  }
  history(): Uint8Array {
    return encodeStateAsUpdateV2(this._keychain);
  }
  merge(change: Uint8Array): void {
    applyUpdateV2(this._keychain, change);
  }
  async keys(): Promise<CryptoKey[]> {
    const yarr = this._keychain.getArray<string>('keys');
    const promises: Promise<CryptoKey>[] = [];
    for (let i = 0; i < yarr.length; i++) {
      const hash = yarr.get(i);
      promises.push(
        (async () => {
          let key: CryptoKey | undefined = undefined;
          if (this._keyCache.has(hash)) {
            key = this._keyCache.get(hash);
          }
          if (!key) {
            key = await unhashKey(hash);
          }
          return key;
        })(),
      );
    }

    return await Promise.all(promises);
  }
}

export class YjsKeychainProvider
  implements KeychainProvider<Uint8Array, CryptoKey> {
  initialize(): YjsKeychain {
    return new YjsKeychain();
  }
}

export class YjsJSONSerializer extends JSONSerializer<Uint8Array> {}
