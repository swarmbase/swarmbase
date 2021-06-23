import { AuthProvider } from "./auth-provider";

/**
 * Used to wrap CryptoKey so that initialized vector used in encryption
 * can be stored for decryption.
 *
 * @param data: encrypted data
 * @param nonce: unique value used for encryption and needed for decryption
 */
export type SubtleCryptoEncryptionResult = {
  data: Uint8Array;
  nonce: Int8Array | Int16Array | Int32Array | Uint8Array | Uint16Array | Uint32Array | Uint8ClampedArray | Float32Array | Float64Array | DataView | ArrayBuffer;
};

export class SubtleCrypto
  implements AuthProvider<CryptoKey, CryptoKey, CryptoKey> {
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
     * Can be any symmetric algorithm: "AES-GCM" | "AES-CTR" | "AES-CBC"
     * 
     * @remarks
     * "RSA-OAEP" is not supported at this time because it is a key pair.
     */
    public readonly _encryptionAlgorithmName: string = "AES-GCM",
 ) {}  // TODO (eric) 1. constructor syntax?

     /**
     * An internal function used to generate a new initialized vector / counter for each encryption.
     * 
     * @returns a parameter object to be used directly in the encrypt function.
     * 
     * @remarks
     * Currently, only supports AesGcmParams.
     * Reference: https://developer.mozilla.org/en-US/docs/Web/API/SubtleCrypto/encrypt
     */
 async _encryptionAlgorithmParams(): 
  Promise<AesGcmParams>
 {
  switch (this._encryptionAlgorithmName)
  {
     case "AES-GCM":
       return {
        name: this._encryptionAlgorithmName,
        iv: crypto.getRandomValues(new Uint8Array(this._nonceBits))
       }
     default: 
      throw "Encrpytion is only supported with AesGcmParams currently"!;
  }
 }

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
  // public async decrypt(
  //   data: Uint8Array,
  //   { key: documentKey, iv }: CryptoKey,
  //   nonce: Uint8Array
  // ): Promise<Uint8Array> {
  //   try {
  //     return new Uint8Array(
  //       await crypto.subtle.decrypt(
  //         this.encryptionAlgorithm(iv),
  //         documentKey,
  //         data
  //       )
  //     );
  //   } catch (err) {
  //     console.error("Failed to decrypt data:", err);
  //     throw err;
  //   }
  // }

  // returned iv must be used to decrypt
  // expect another function combines ciphertext + iv into CRDTChangeBlock
  /**
   * Given data to encrypt and a key object,
   * return the decrypted data or throw an error
   *
   * @remarks
   * 
   *
   * @param data - data to be encrypted
   * @param key - symmetric key associated and stored with document
   * 
   * @returns a Promise that fulfills with a SubtleCryptoEncryptionResult or throws an error
   */
  public async encrypt(
    data: Uint8Array,
    documentKey:  CryptoKey,
  ): Promise<SubtleCryptoEncryptionResult> {
    const algorithmParams = await this._encryptionAlgorithmParams();
    const ciphertext = await crypto.subtle.encrypt(
      algorithmParams,
      documentKey,
      data
    );
    return {
      data: new Uint8Array(ciphertext),
      nonce: algorithmParams.iv,
    };
  }
}
