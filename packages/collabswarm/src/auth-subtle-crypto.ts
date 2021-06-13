// https://developer.mozilla.org/en-US/docs/Web/API/SubtleCrypto

let subtle = window.crypto.subtle;

import { AuthProvider } from "./auth-provider";

export class SubtleCrypto<PrivateKey, PublicKey> implements AuthProvider<PrivateKey, PublicKey> {
  sign(data: Uint8Array, privateKey: PrivateKey): Promise<Uint8Array> {
    throw new Error("Method not implemented.");
  }
  verify(data: Uint8Array, publicKey: PublicKey, signature: string): Promise<boolean> {
    throw new Error("Method not implemented.");
  }
  encrypt(data: Uint8Array, key: string): Promise<Uint8Array> {
    throw new Error("Method not implemented.");
  }
  decrypt(data: Uint8Array, key: string): Promise<Uint8Array> {
    throw new Error("Method not implemented.");
  }
}
