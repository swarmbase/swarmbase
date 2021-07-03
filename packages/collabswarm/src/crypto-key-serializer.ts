import { KeySerializer } from './key-serializer';

export class CryptoKeySerializer implements KeySerializer<CryptoKey> {
  constructor(
    public readonly algorithm:
      | AlgorithmIdentifier
      | RsaHashedImportParams
      | EcKeyImportParams
      | HmacImportParams
      | DhImportKeyParams
      | AesKeyAlgorithm,
    public readonly keyUsages: KeyUsage[],
  ) {}

  async serializeKey(key: CryptoKey): Promise<Uint8Array> {
    const buf = await crypto.subtle.exportKey('raw', key);
    return new Uint8Array(buf);
  }
  async deserializeKey(key: Uint8Array): Promise<CryptoKey> {
    return await crypto.subtle.importKey(
      'raw',
      key,
      this.algorithm,
      true,
      this.keyUsages,
    );
  }
}
