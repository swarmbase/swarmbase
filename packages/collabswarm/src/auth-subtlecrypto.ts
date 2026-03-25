import { AuthProvider } from './auth-provider';

/**
 * Used to wrap CryptoKey so that initialized vector used in encryption
 * can be stored for decryption.
 *
 * @param data: encrypted data
 * @param nonce: unique value used for encryption and needed for decryption
 */
export type SubtleCryptoEncryptionResult = {
  data: Uint8Array;
  nonce: Uint8Array;
};

/**
 * SubtleCrypto implements `AuthProvider` using WebCrypto's Subtle API.
 *
 * The base keytype is `CryptoKey`.
 */
export class SubtleCrypto
  implements AuthProvider<CryptoKey, CryptoKey, CryptoKey>
{
  constructor(
    /**
     * Uses the Web Crypto API for performant implementation.
     * @see https://developer.mozilla.org/en-US/docs/Web/API/SubtleCrypto
     *
     * @remarks
     * This is not Node’s Crypto API; that API is not expected to be as performant.
     *
     * @remarks Despite the name "nonceBits", this value is used as a **byte
     * count** throughout the codebase (passed directly to
     * `new Uint8Array(nonceBits)`). The default of 96 is historically
     * consistent with all existing encrypted data and must not be changed
     * without a migration, even though 12 bytes would be the correct size
     * for a 96-bit AES-GCM IV. The field name is kept for backward
     * compatibility.
     */
    public readonly nonceBits = 96,

    /**
     * The type of algorithm used for signature and verification keys.
     *
     * @remarks https://developer.mozilla.org/en-US/docs/Web/API/SubtleCrypto/sign
     */
    public readonly signingAlgorithm:
      | AlgorithmIdentifier
      | RsaPssParams
      | EcdsaParams
      | AesCbcParams = {
      // TODO: Is this correct?
      name: 'ECDSA',
      hash: { name: 'SHA-384' },
    },

    /**
     * The encryption algorithm to use for encrypt/decrypt.
     *
     * @remarks
     * "RSA-OAEP" is not supported at this time because it is a key pair.
     * AES-CTR and AES-CBC are not yet supported; only AES-GCM is implemented.
     */
    public readonly _encryptionAlgorithmName:
      | 'AES-GCM'
      | 'AES-CTR'
      | 'AES-CBC' = 'AES-GCM',
  ) {}

  /**
   * Extract the nonce/IV/counter from encryption algorithm parameters.
   * Supports AES-GCM (iv), AES-CTR (counter), and AES-CBC (iv).
   * Normalizes BufferSource values to Uint8Array.
   */
  private _extractNonce(params: AesGcmParams | AesCtrParams | AesCbcParams): Uint8Array {
    let raw: BufferSource | undefined;
    if ('iv' in params) {
      raw = params.iv;
    } else if ('counter' in params) {
      raw = params.counter;
    }
    if (!raw) {
      throw new Error(`Cannot extract nonce from algorithm: ${(params as any).name}`);
    }
    // Normalize BufferSource to Uint8Array, respecting byteOffset/byteLength for views.
    if (raw instanceof Uint8Array) return raw;
    if (raw instanceof ArrayBuffer) return new Uint8Array(raw);
    // ArrayBufferView — respect offset and length to avoid reading unrelated bytes.
    return new Uint8Array(raw.buffer, raw.byteOffset, raw.byteLength);
  }

  /**
   * An internal function used to generate a new initialized vector / counter for each encryption.
   *
   * @param nonce - unique value generated during encryption and used during decryption
   *
   * @returns a parameter object to be used directly in the encrypt function.
   *
   * @remarks
   * Reference: https://developer.mozilla.org/en-US/docs/Web/API/SubtleCrypto/encrypt
   */
  _encryptionAlgorithmParams(nonce?: Uint8Array): AesGcmParams | AesCtrParams | AesCbcParams {
    switch (this._encryptionAlgorithmName) {
      case 'AES-GCM': {
        const iv = nonce ?? crypto.getRandomValues(new Uint8Array(this.nonceBits));
        return { name: 'AES-GCM', iv: iv as Uint8Array<ArrayBuffer> };
      }
      case 'AES-CTR':
      case 'AES-CBC':
        // NOTE: Only AES-GCM is currently supported. AES-CTR and AES-CBC throw — see PR description.
        // TODO: AES-CTR and AES-CBC support is planned but not yet implemented.
        // They require different nonce sizes (16 bytes) and key import
        // parameters than AES-GCM. Implementation is deferred until the
        // key derivation paths and wire format header parsing are updated.
        throw new Error(`${this._encryptionAlgorithmName} is not yet supported. Use AES-GCM.`);
      default:
        throw new Error(`Unknown encryption algorithm: ${this._encryptionAlgorithmName}`);
    }
  }

  /**
   * Given encrypted changes and a private key, returns a signature.
   *
   * @param data encrypted data to be signed
   * @param privateKey - part of key pair used to sign and verify
   * @returns signature for use in a CRDTChangeBlock
   */
  public async sign(
    data: Uint8Array,
    privateKey: CryptoKey,
  ): Promise<Uint8Array> {
    return new Uint8Array(
      await crypto.subtle.sign(this.signingAlgorithm, privateKey, data as Uint8Array<ArrayBuffer>),
    );
  }

  /**
   * Given a signature and data (from a CRDTChangeBlock), a Promise that fulfills with true if the signature is valid, false otherwise
   *
   * @param data data that was signed
   * @param publicKey part of key pair used to sign and verify
   * @param signature signature to verify
   * @returns a Promise that fulfills with true if the signature is valid, false otherwise
   */
  public async verify(
    data: Uint8Array,
    publicKey: CryptoKey,
    signature: Uint8Array,
  ): Promise<boolean> {
    return await crypto.subtle.verify(
      this.signingAlgorithm,
      publicKey,
      signature as Uint8Array<ArrayBuffer>,
      data as Uint8Array<ArrayBuffer>,
    );
  }

  /**
   * Given encrypted data, the nonce used for encryption, and a document key
   * return the decrypted data or throw an error
   *
   * @remarks
   * Recommend getting parameters from SubtleCryptoEncryptionResult.
   *
   * @param data - encrypted data, not including nonce
   * @param documentKey - symmetric key associated with document
   * @param nonce - unique value used during encryption
   *
   * @returns a Promise that fulfills with an array if the key and nonce are valid or throws an error
   */
  public async decrypt(
    data: Uint8Array,
    documentKey: CryptoKey,
    nonce?: Uint8Array,
  ): Promise<Uint8Array> {
    try {
      return new Uint8Array(
        await crypto.subtle.decrypt(
          this._encryptionAlgorithmParams(nonce),
          documentKey,
          data as Uint8Array<ArrayBuffer>,
        ),
      );
    } catch (err) {
      console.error('Failed to decrypt data:', err);
      throw err;
    }
  }

  /**
   * Given data to encrypt and a key object,
   * return the decrypted data or throw an error
   *
   * @param data - data to be encrypted
   * @param documentKey - symmetric key associated and stored with document
   * @returns a Promise that fulfills with a SubtleCryptoEncryptionResult or throws an error
   */
  public async encrypt(
    data: Uint8Array,
    documentKey: CryptoKey,
  ): Promise<SubtleCryptoEncryptionResult> {
    const algorithmParams = this._encryptionAlgorithmParams();
    const ciphertext = await crypto.subtle.encrypt(
      algorithmParams,
      documentKey,
      data as Uint8Array<ArrayBuffer>,
    );
    return {
      data: new Uint8Array(ciphertext),
      nonce: this._extractNonce(algorithmParams),
    };
  }
}
