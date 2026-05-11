/**
 * A keychain contains a CollabswarmDocument's encryption keys.
 *
 * Keys are identified by a key ID. Two key-ID schemes coexist: 16-byte UUID v4
 * values (used by `add()` for keys not tied to a specific epoch) and 32-byte
 * SHA-256 hashes from `addEpochKey()` for epoch-based key management.
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
   * Gets a block of change(s) describing only the current (most recent) key.
   * Used for `current_only` history visibility where new members should only
   * receive the current encryption key, not the full key history.
   *
   * @return A block of change(s) containing only the current key.
   */
  currentKeyChange(): Promise<KeychainChange>;

  /**
   * Add an encryption key for a specific epoch.
   * Used when transitioning to epoch-based key management.
   *
   * @param epochId The 32-byte epoch ID.
   * @param key The encryption key for this epoch.
   * @return A block of change(s) describing the keychain addition.
   */
  addEpochKey(epochId: Uint8Array, key: DocumentKey): Promise<KeychainChange>;

  /**
   * Gets a block of change(s) describing only the keys at or after the given
   * key ID (an epoch ID or legacy UUID). Used for the `since_invited` history
   * visibility mode where a new member should receive every key from the
   * moment they were invited onward, but no earlier history.
   *
   * If the supplied `keyID` is not present in the keychain, the keychain is
   * not yet aware of that epoch -- the method returns the full history so the
   * recipient can still decrypt; this errs on the side of availability.
   *
   * @param keyID The key ID marking the start of the visible window.
   * @return A block of change(s) containing only keys at or after `keyID`.
   */
  historySince(keyID: Uint8Array): Promise<KeychainChange>;
}
