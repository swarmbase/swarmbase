/**
 * CRDTChangeBlock represents a unit of change. Includes a signature for verification of authorship
 * and tamper prevention.
 */
export interface CRDTChangeBlock<ChangesType> {
  /**
   * Identifier for the document encryption key used to encrypt this block.
   * Allows recipients to select the correct decryption key from their keychain.
   * When absent, recipients must try all available keys.
   */
  keyId?: Uint8Array;

  /**
   * Stored nonce for decryption purposes.
   */
  nonce: Uint8Array;

  /**
   * Changes object describing edits made to a CRDT document. CRDTProvider implementation dependent.
   */
  changes: ChangesType;

  /**
   * Optional blind index tokens for encrypted search.
   * Maps field path to HMAC-derived token for equality matching without exposing plaintext.
   */
  blindIndexTokens?: Record<string, string>;
}
