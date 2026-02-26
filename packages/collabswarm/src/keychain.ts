/**
 * A keychain contains a CollabswarmDocument's encryption keys.
 *
 * Keys are identified by a key ID. In the legacy model, key IDs are 16-byte
 * UUID v4 values. In the epoch-based model, key IDs are 32-byte SHA-256
 * hashes (epoch IDs).
 *
 * @typeParam KeychainChange Type of a block of change(s) describing edits made to the document keychain.
 * @typeParam DocumentKey Type of a document encryption key.
 */
export interface Keychain<KeychainChange, DocumentKey> {
  /**
   * Generates and adds a new document encryption key to the keychain.
   *
   * @return The new document key ID, key, and a block of change(s) describing the keychain addition.
   */
  add(): Promise<[Uint8Array, DocumentKey, KeychainChange]>;

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
   * Gets the all document encryption keys in the keychain.
   *
   * @return all document encryption keys.
   */
  keys(): Promise<[Uint8Array, DocumentKey][]>;

  /**
   * Gets the current encryption key that should be used to encrypt new changes.
   */
  current(): Promise<[Uint8Array, DocumentKey]>;

  /**
   * Looks up a document key by its ID.
   *
   * @param keyID An identifier for a document key (16-byte UUID or 32-byte epoch ID).
   * @return The requested document key.
   */
  getKey(keyID: Uint8Array): DocumentKey | undefined;

  /**
   * Add an encryption key for a specific epoch.
   * Used when transitioning to epoch-based key management.
   *
   * @param epochId The 32-byte epoch ID.
   * @param key The encryption key for this epoch.
   * @return A block of change(s) describing the keychain addition.
   */
  addEpochKey?(epochId: Uint8Array, key: DocumentKey): Promise<KeychainChange>;
}
