// Restrict access to those on ACL

/** Supported AES encryption algorithm names. */
export type AesAlgorithmName = 'AES-GCM' | 'AES-CTR' | 'AES-CBC';

export type EncryptionResult = {
  data: Uint8Array;
  nonce?: Uint8Array;
};

export interface AuthProvider<PrivateKey, PublicKey, DocumentKey = string> {
  sign(data: Uint8Array, privateKey: PrivateKey): Promise<Uint8Array>;
  verify(
    data: Uint8Array,
    publicKey: PublicKey,
    signature: Uint8Array,
  ): Promise<boolean>;
  encrypt(
    data: Uint8Array,
    documentKey: DocumentKey,
  ): Promise<EncryptionResult>;
  decrypt(
    data: Uint8Array,
    documentKey: DocumentKey,
    nonce?: Uint8Array,
  ): Promise<Uint8Array>;

  /**
   * Returns the nonce/IV size **in bytes** for the configured encryption
   * algorithm. The property name is a historical artifact — it represents
   * a byte count, not a bit count.
   */
  readonly nonceBits: number;

  /**
   * Serialize a `PublicKey` to a stable string representation. The
   * representation MUST be deterministic for a given key so two peers
   * can compare serialized strings for equality and reach the same
   * conclusion about whether a `PublicKey` is the same identity.
   *
   * This is currently used by the BeeKEM Welcome flow (recipient
   * binding) and is intentionally generic so non-CryptoKey providers
   * (e.g. opaque/hash-based identities) can supply their own
   * canonical encoding.
   */
  serializePublicKey(publicKey: PublicKey): Promise<string>;
}
