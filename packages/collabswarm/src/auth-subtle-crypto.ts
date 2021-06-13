// https://developer.mozilla.org/en-US/docs/Web/API/SubtleCrypto

// const encoder = new TextEncoder();
// return encoder.encode(JSON.stringify(message));
const concatTypedArray = require('concat-typed-array');
let subtle = window.crypto.subtle;
let getRandomValues = window.crypto.getRandomValues;

import { AuthProvider } from "./auth-provider";

export class SubtleCrypto<PrivateKey, PublicKey> implements AuthProvider<PrivateKey, PublicKey> {

  public importKey(rawKey: Uint8Array) {
    /*
    Import an AES secret key from an ArrayBuffer containing the raw bytes.
    Takes an ArrayBuffer string containing the bytes, and returns a Promise
    that will resolve to a CryptoKey representing the secret key.
    */
    return subtle.importKey(
      "raw",
      rawKey,
      "AES-GCM",
      true,
      ["encrypt", "decrypt"]
    );
  }

  
  // Given serialized data,
  // return as serialized data with signature included
  async sign(data: Uint8Array, privateKey: PrivateKey): Promise<Uint8Array> {
    // data expects serialized 
    // privateKey expects AES or HMAC secret keys as ArrayBuffer
    let cryptoKey: CryptoKey = await subtle.importKey(
      "raw",
      privateKey,
      'AES-GCM',
      true,
      ["sign"]
    );
    let signature = await window.crypto.subtle.sign(
      {
        name: "ECDSA",
        hash: {name: "SHA-256"},
      },
      cryptoKey,
      data
    );
    return new Uint8Array(signature);
  }

  verify(data: Uint8Array, publicKey: PublicKey, signature: string): Promise<boolean> {
    throw new Error("Method not implemented.");
  }

  async encrypt(data: Uint8Array, signature: Uint8Array, documentKey: string): Promise<Uint8Array> {
    // documentKey: AES or HMAC secret key from an ArrayBuffer containing the raw bytes
    // returns array starting with IV, where the message contains the signature
    let algorithm = 'AES-GCM';
    let data_and_sig = concatTypedArray(Uint8Array, signature.length, signature, data); // here
    let rawKey = new Uint8Array(new Buffer(documentKey));
    let cryptoKey = await subtle.importKey(
      "raw",
      rawKey,
      algorithm,
      true,
      ["encrypt"]
    );
    let iv = getRandomValues(new Uint8Array(12));
    let cipherText = await subtle.encrypt(
      { name: algorithm, iv: iv },
      cryptoKey,
      data_and_sig
    );
    // TODO (eric) confirm sig.length is always 1 byte (i.e. < 256=2^8)
    return concatTypedArray(Uint8Array, iv, cipherText);
  }

  decrypt(data: Uint8Array, documentKey: string): Promise<Uint8Array> {
    // data of form: iv, cipherText
    // cipherText of form: sig_length, sig, data array
    let iv = data.slice(0,13);
    data = data.slice(13)
    // TODO decrypt with IV
    // verify here?
    throw new Error("Method not implemented.");
  }
}
