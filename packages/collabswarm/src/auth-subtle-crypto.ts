// https://developer.mozilla.org/en-US/docs/Web/API/SubtleCrypto

// const encoder = new TextEncoder();
// return encoder.encode(JSON.stringify(message));
const concatTypedArray = require('concat-typed-array');
let subtle = window.crypto.subtle;
let getRandomValues = window.crypto.getRandomValues;
import { resourceLimits } from "worker_threads";
import { AuthProvider } from "./auth-provider";

const CRYPTO_ALGORITHM = 'AES-GCM';


export class SubtleCrypto<PrivateKey, PublicKey> implements AuthProvider<PrivateKey, PublicKey> {

  /// Given a raw key, return the CryptoKey type needed for crypto operations
  private async _importKey(rawKey: PrivateKey | PublicKey): Promise<CryptoKey> {
    return subtle.importKey(
      "raw",
      rawKey,
      CRYPTO_ALGORITHM,
      true,
      ["sign", "verify"]
    );
  }

  
  // Given serialized data,
  // return as serialized data with signature included
  public async sign(data: Uint8Array, privateKey: PrivateKey): Promise<Uint8Array> {
    // data expects serialized 
    // privateKey expects AES or HMAC secret keys as ArrayBuffer
    let signature = await window.crypto.subtle.sign(
      {
        name: "ECDSA",
        hash: {name: "SHA-256"},
      },
      await this._importKey(privateKey),
      data
    );
    return new Uint8Array(signature);
  }

  public async verify(data: Uint8Array, publicKey: PublicKey): Promise<boolean> {
    // data = sig_length, sig, data array
    // algorithm must match that used in sign()
    let sig_length = data[0];
    let signature = data.slice(1,sig_length);
    try {
      return await window.crypto.subtle.verify(
        CRYPTO_ALGORITHM,
        await this._importKey(publicKey),
        signature,
        data
      );
    } catch (err) {
      console.error("encryption key is not a key for the requested verifying algorithm or when trying to use an algorithm that is either unknown or isn't suitable for a verify operation")
      throw err;
    }
  }

  // Given a key as a string, return the subtle crypto CryptoKey version
  // Hard code permissions since only used for these two functions
  // Here, the key is an ArrayBuffer
  private async _GetCryptoKeyFrom(documentKey: string): Promise<CryptoKey> {
    let encoder = new TextEncoder()
    return await subtle.importKey(
      "raw",  // format
      encoder.encode(documentKey),  // keyData: ArrayBuffer
      CRYPTO_ALGORITHM,
      true, // extractable
      ["encrypt", "decrypt"]
    );
  }

  public async encrypt(data: Uint8Array, signature: Uint8Array, documentKey: string): Promise<Uint8Array> {
    // documentKey: AES or HMAC secret key from an ArrayBuffer containing the raw bytes
    // returns array starting with IV, where the message contains the signature
    let data_and_sig = concatTypedArray(Uint8Array, Uint8Array.of(signature.length), signature, data);
    let encoder = new TextEncoder()
    let initialVector = getRandomValues(new Uint8Array(12));
    let cipherText = await subtle.encrypt(
      { 
        name: CRYPTO_ALGORITHM, 
        iv: initialVector 
      },
      await this._GetCryptoKeyFrom(documentKey),
      data_and_sig
    );
    // TODO (eric) confirm sig.length is always 1 byte (i.e. < 256=2^8)
    return concatTypedArray(Uint8Array, initialVector, cipherText);
  }

  public async decrypt(data: Uint8Array, documentKey: string): Promise<Uint8Array> {
    // data of form: iv, cipherText
    // _initialVector must match the one used to encrypt
    let initialVector = data.slice(0,13);
    let cipherText = data.slice(13,);
    let arrayBuffer = await subtle.decrypt(
      {
        name: CRYPTO_ALGORITHM,
        iv: initialVector
      },
      await this._GetCryptoKeyFrom(documentKey),
      cipherText
    );
    return new Uint8Array(arrayBuffer);
  }
}
