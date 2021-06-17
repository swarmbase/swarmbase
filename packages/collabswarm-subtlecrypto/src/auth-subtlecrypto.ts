import { AuthProvider } from "@collabswarm/collabswarm";

export class SubtleCrypto
  implements AuthProvider<CryptoKey, CryptoKey, CryptoKey> {
  /**
   * Uses the Web Crypto API for performant implementation.
   * @see https://developer.mozilla.org/en-US/docs/Web/API/SubtleCrypto
   *
   * @remarks
   * This is not Node’s Crypto API; that API is not expected to be as performant.
   *
   * @param _nonce_bits - 96 bits length is recommended in docs; though example uses only 12
   */
  _nonce_bits = 96; // TODO (e: Robert) or we can just force it, but then it's hidden if change algo

  // Given encrypted changes and a private key,
  // return a signature for use in a CRDTChangeBlock
  // TODO (e:Robert) should we call it CRDTChangeBlock? esp since sig is optional
  public async sign(
    data: Uint8Array,
    privateKey: CryptoKey
  ): Promise<Uint8Array> {
    return new Uint8Array(
      await crypto.subtle.sign(
        {
          name: "ECDSA",
          hash: { name: "SHA-384" },
        },
        privateKey,
        data
      )
    );
  }

  // Given a signature and data (from a CRDTChangeBlock),
  // return a Promise that fulfills with true if the signature is valid, false otherwise
  public async verify(
    data: Uint8Array,
    publicKey: CryptoKey,
    signature: Uint8Array
  ): Promise<boolean> {
    return await crypto.subtle.verify(
      {
        name: "ECDSA",
        hash: { name: "SHA-384" },
      },
      publicKey,
      signature,
      data
    );
  }

  /**
   * Given encrypted data, key and a nonce,
   * return the decrypted data or throw an error
   *
   * @remarks
   * Expects that nonce has been separated out from data
   *
   * @param data - encrypted data as uint_8 array, not including nonce
   * @param documentKey - symmetric key associated and stored with document
   * TODO (e:Robert) - documentKey should become documentKeys since it will change?
   * @param none - the starting value used for the cryptographic function
   *   for the AES-GCM algorithm is is also called an initialized vector
   * @returns a Promise that fulfills with an array if the key and nonce are valid or throws an error
   */
  public async decrypt(
    data: Uint8Array,
    documentKey: CryptoKey,
    nonce: Uint8Array
  ): Promise<Uint8Array> {
    try {
      // @Robert is this more clear separated out into a `let plainTextBuffer = `...?
      return new Uint8Array(
        await crypto.subtle.decrypt(
          {
            name: "AES-GCM",
            iv: nonce,
          },
          documentKey,
          data
        )
      );
    } catch (err) {
      console.error("Failed to decrypt data:", err);
      throw err;
    }
  }

  // returned iv must be used to decrypt
  // expect another function combines ciphertext + iv into CRDTChangeBlock
  public async encrypt(
    data: Uint8Array,
    documentKey: CryptoKey
  ): Promise<Record<string, Uint8Array>> {
    let iv = crypto.getRandomValues(new Uint8Array(this._nonce_bits));
    let ciphertext = await crypto.subtle.encrypt(
      {
        name: "AES-GCM",
        iv: iv,
      },
      documentKey,
      data
    );
    return {
      ciphertext: new Uint8Array(ciphertext),
      iv: iv,
    };
  }
}
