import { AuthProvider } from "@collabswarm/collabswarm";

/*
subtle.key: CryptoKey = https://developer.mozilla.org/en-US/docs/Web/API/CryptoKey
*/

export class SubtleCrypto implements AuthProvider<CryptoKey, CryptoKey, CryptoKey> {
  sign(data: Uint8Array, privateKey: CryptoKey): Promise<Uint8Array> {
    throw new Error("Method not implemented.");
  }
  // data does not include the signature
  verify(data: Uint8Array, publicKey: CryptoKey, signature: string): Promise<boolean> {
    throw new Error("Method not implemented.");
  }
  decrypt(data: Uint8Array, documentKey: CryptoKey): Promise<Uint8Array> {
    throw new Error("Method not implemented.");
  }
  public async encrypt(data: Uint8Array, documentKey: CryptoKey): Promise<Uint8Array> {
    throw new Error("Method not implemented.");
  }
}
