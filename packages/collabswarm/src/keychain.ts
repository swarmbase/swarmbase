export interface Keychain<KeychainChange, DocumentKey> {
  add(key: DocumentKey): Promise<KeychainChange>;
  history(): KeychainChange;
  merge(change: KeychainChange): void;
  keys(): Promise<DocumentKey[]>;
}
