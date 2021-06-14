import { AuthProvider } from "@collabswarm/collabswarm";

/*
subtle.key: CryptoKey = https://developer.mozilla.org/en-US/docs/Web/API/CryptoKey
*/

export class SubtleCrypto<PrivateKey, PublicKey, DocumentKey> implements AuthProvider<PrivateKey, PublicKey, DocumentKey> {
  sign(data: Uint8Array, privateKey: PrivateKey): Promise<Uint8Array> {
    throw new Error("Method not implemented.");
  }
  verify(data: Uint8Array, publicKey: PublicKey, signature: string): Promise<boolean> {
    throw new Error("Method not implemented.");
  }
  decrypt(data: Uint8Array, documentKey: DocumentKey): Promise<Uint8Array> {
    throw new Error("Method not implemented.");
  }
  public async encrypt(data: Uint8Array, signature: Uint8Array, documentKey: DocumentKey): Promise<Uint8Array> {
    throw new Error("Method not implemented.");
  }
}
