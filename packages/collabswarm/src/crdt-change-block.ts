/**
 * CRDTChangeBlock represents a unit of change. Includes a signature for verification of authorship
 * and tamper prevention.
 */
export interface CRDTChangeBlock<ChangesType> {
  /**
   * Reserved: Identifier for the document encryption key used to encrypt this block.
   * Not yet wired through serializers or producers — present for forward compatibility.
   * When implemented, will allow recipients to select the correct decryption key
   * from their keychain. Encoded as a base64 string for JSON serialization safety.
   */
  keyID?: string;

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
