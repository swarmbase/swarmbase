import { AuthProvider } from "./auth-provider";

export type SubtleCryptoDocumentKey = {
  key: CryptoKey;
  iv: Uint8Array;
};

export type SubtleCryptoEncryptionResult = {
  data: Uint8Array;
  iv: Uint8Array;
};

export class SubtleCrypto
  implements AuthProvider<CryptoKey, CryptoKey, SubtleCryptoDocumentKey>
{
  constructor(
    /**
     * Uses the Web Crypto API for performant implementation.
     * @see https://developer.mozilla.org/en-US/docs/Web/API/SubtleCrypto
     *
     * @remarks
     * This is not Node’s Crypto API; that API is not expected to be as performant.
     *
     * @param nonceBits - 96 bits length is recommended in docs; though example uses only 12
     */
    public readonly _nonceBits = 96,

    /**
     *
     */
    public readonly signingAlgorithm:
      | AlgorithmIdentifier
      | RsaPssParams
      | EcdsaParams
      | AesCmacParams = {
      name: "ECDSA",
      hash: { name: "SHA-384" },
    },

    /**
     *
     */
    public readonly encryptionAlgorithm: (
      iv: Uint8Array
    ) =>
      | AlgorithmIdentifier
      | AesCmacParams
      | RsaOaepParams
      | AesCtrParams
      | AesCbcParams
      | AesGcmParams
      | AesCfbParams = (iv: Uint8Array) => ({
      name: "AES-GCM",
      iv,
    })
  ) {}

  // Given encrypted changes and a private key,
  // return a signature for use in a CRDTChangeBlock
  public async sign(
    data: Uint8Array,
    privateKey: CryptoKey
  ): Promise<Uint8Array> {
    return new Uint8Array(
      await crypto.subtle.sign(this.signingAlgorithm, privateKey, data)
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
      this.signingAlgorithm,
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
   * @param none - the starting value used for the cryptographic function
   *   for the AES-GCM algorithm is is also called an initialized vector
   * @returns a Promise that fulfills with an array if the key and nonce are valid or throws an error
   */
  public async decrypt(
    data: Uint8Array,
    { key: documentKey, iv }: SubtleCryptoDocumentKey,
    nonce: Uint8Array
  ): Promise<Uint8Array> {
    try {
      return new Uint8Array(
        await crypto.subtle.decrypt(
          this.encryptionAlgorithm(iv),
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
    { key: documentKey, iv = crypto.getRandomValues(new Uint8Array(this._nonceBits))}: SubtleCryptoDocumentKey
  ): Promise<SubtleCryptoEncryptionResult> {
    const ciphertext = await crypto.subtle.encrypt(
      this.encryptionAlgorithm(iv),
      documentKey,
      data
    );
    return {
      data: new Uint8Array(ciphertext),
      iv: iv,
    };
  }
}
