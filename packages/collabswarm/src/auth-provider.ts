// Restrict access to those on ACL

export type EncryptionResult = {
  data: Uint8Array;
  iv?: Uint8Array;
};

export interface AuthProvider<PrivateKey, PublicKey, DocumentKey = string> {
  sign(data: Uint8Array, privateKey: PrivateKey): Promise<Uint8Array>;
  verify(
    data: Uint8Array,
    publicKey: PublicKey,
    signature: Uint8Array
  ): Promise<boolean>;
  encrypt(
    data: Uint8Array,
    documentKey: DocumentKey
  ): Promise<EncryptionResult>;
  decrypt(
    data: Uint8Array,
    documentKey: DocumentKey,
    iv?: Uint8Array
  ): Promise<Uint8Array>;
}
