import {
  Doc,
  init,
  change,
  getChanges,
  applyChanges,
  BinaryChange,
  getAllChanges,
  from,
} from "automerge";

import {
  ACL,
  ACLProvider,
  CollabswarmDocumentChangeHandler,
  CRDTProvider,
  JSONSerializer,
  Keychain,
  KeychainProvider,
} from "@collabswarm/collabswarm";

export type AutomergeSwarmDocumentChangeHandler<
  T = any
  > = CollabswarmDocumentChangeHandler<Doc<T>>;

export class AutomergeProvider<T = any>
  implements
  CRDTProvider<
  Doc<T>,
  BinaryChange[],
  (doc: T) => void
  > {
  newDocument(): Doc<T> {
    return init();
  }
  localChange(
    document: Doc<T>,
    message: string,
    changeFn: (doc: T) => void
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

export async function hashKey(publicKey: CryptoKey): Promise<string> {
  const buf = await crypto.subtle.exportKey("raw", publicKey);
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
  return await crypto.subtle.importKey("raw", bytes, "AES-GCM", true, [
    "encrypt",
    "decrypt",
  ]);
}

export type AutomergeACLDoc = Doc<{
  users: { [hash: string]: true };
}>;

export class AutomergeACL implements ACL<BinaryChange[], CryptoKey> {
  private _acl: AutomergeACLDoc = from({
    users: {},
  });

  async add(publicKey: CryptoKey): Promise<BinaryChange[]> {
    const hash = await hashKey(publicKey);
    const aclNew = change(this._acl, doc => {
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
    const hash = await hashKey(publicKey);
    const aclNew = change(this._acl, doc => {
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
    const hash = await hashKey(publicKey);
    return this._acl.users && (this._acl.users[hash] !== undefined);
  }
}

export class AutomergeACLProvider implements ACLProvider<BinaryChange[], CryptoKey> {
  initialize(): AutomergeACL {
    return new AutomergeACL();
  }
}

export type AutomergeKeychainDoc = Doc<{
  keys: string[];
}>;

export class AutomergeKeychain implements Keychain<BinaryChange[], CryptoKey> {
  // TODO: Replace this with a LRU cache of bounded size.
  private readonly _keyCache = new Map<string, CryptoKey>();
  private _keychain: AutomergeKeychainDoc = from({
    keys: [],
  });

  async add(key: CryptoKey): Promise<BinaryChange[]> {
    const hash = await hashKey(key);
    this._keyCache.set(hash, key);
    const keychainNew = change(this._keychain, doc => {
      if (!doc.keys) {
        doc.keys = [];
      }
      doc.keys.push(hash);
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
  async keys(): Promise<CryptoKey[]> {
    if (!this._keychain.keys) {
      return [];
    }

    return await Promise.all(this._keychain.keys.map(async hash => {
      let key: CryptoKey | undefined = undefined;
      if (this._keyCache.has(hash)) {
        key = this._keyCache.get(hash);
      }
      if (!key) {
        key = await unhashKey(hash);
      }
      return key;
    }));
  }
}

export class AutomergeKeychainProvider implements KeychainProvider<BinaryChange[], CryptoKey> {
  initialize(): AutomergeKeychain {
    return new AutomergeKeychain();
  }
}

export class AutomergeJSONSerializer extends JSONSerializer<BinaryChange[]> { }
