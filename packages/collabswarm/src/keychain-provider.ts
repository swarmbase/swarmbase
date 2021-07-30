import { Keychain } from './keychain';

/**
 * Factory for Keychain objects.
 *
 * @typeParam KeychainChange Type of a block of change(s) describing edits made to the document keychain.
 * @typeParam DocumentKey Type of a document encryption key.
 */
export interface KeychainProvider<KeychainChange, DocumentKey> {
  /**
   * Construct a new Keychain object.
   *
   * @return A new Keychain object.
   */
  initialize(): Keychain<KeychainChange, DocumentKey>;

  /**
   * Number of bytes in a document key.
   */
  readonly keyIDLength: number;
}
