// Restrict access to those on ACL

import internal from "stream";

export interface AuthProvider<PrivateKey, PublicKey, DocumentKey=string> {
  _nonce_bits: number;
  sign(data: Uint8Array, privateKey: PrivateKey): Promise<Uint8Array>;
  verify(data: Uint8Array, publicKey: PublicKey, signature: Uint8Array): Promise<boolean>;
  // return dictionary of ciphertext, nonce
  encrypt(data: Uint8Array, documentKey: DocumentKey): 
    Promise <Record<string, Uint8Array>>;
  decrypt(data: Uint8Array, documentKey: DocumentKey, nonce: Uint8Array): Promise<Uint8Array>;
}
