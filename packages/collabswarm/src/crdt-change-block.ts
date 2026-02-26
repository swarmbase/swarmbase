/**
 * CRDTChangeBlock represents a unit of change. Includes a signature for verification of authorship
 * and tamper prevention.
 */
export interface CRDTChangeBlock<ChangesType> {
  // TODO: Add identifier for document key that should be used to decrypt (or just prepend it to the Uint8Array).

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
   *
   * TODO: Update ChangesSerializer implementations (JSONSerializer in collabswarm-yjs and
   * collabswarm-automerge) to include this field in serialize/deserialize so tokens
   * propagate through the system.
   */
  blindIndexTokens?: Record<string, string>;
}
