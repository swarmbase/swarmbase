/**
 * A keychain contains a CollabswarmDocument's encryption keys.
 * 
 * @tparam KeychainChange Type of a block of change(s) describing edits made to the document keychain.
 * @tparam DocumentKey Type of a document encryption key.
 */
export interface Keychain<KeychainChange, DocumentKey> {
  /**
   * Add a document encryption key to the keychain.
   * 
   * @param key Document encryption key to add.
   * @return A block of change(s) describing the keychain addition.
   */
  add(key: DocumentKey): Promise<KeychainChange>;

  /**
   * Gets a block of change(s) describing the whole state of the keychain.
   * 
   * @return A block of change(s) describing the keychain.
   */
  history(): KeychainChange;

  /**
   * Merges in a block of change(s) to the keychain.
   * 
   * @param change A block of change(s) to apply.
   */
  merge(change: KeychainChange): void;

  /**
   * Gets the current document encryption keys in the keychain.
   * 
   * @return current document encryption keys.
   */
  keys(): Promise<DocumentKey[]>;
}
