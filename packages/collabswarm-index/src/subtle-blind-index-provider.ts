import { BlindIndexProvider } from './blind-index-provider';

/**
 * WebCrypto-based BlindIndexProvider implementation.
 * - Key derivation: HKDF with SHA-256, field path as "info" parameter
 * - Token computation: HMAC-SHA-256 of normalized value, truncated and base64url-encoded
 * - Token truncation: First 16 bytes of HMAC output (128 bits) — balances collision resistance vs leakage
 */
export class SubtleBlindIndexProvider implements BlindIndexProvider {
  private _tokenLengthBytes: number;

  /**
   * @param tokenLengthBytes Number of bytes to use from HMAC output (default: 16 = 128 bits).
   *   Shorter tokens increase false positives but reduce information leakage.
   */
  constructor(tokenLengthBytes: number = 16) {
    this._tokenLengthBytes = tokenLengthBytes;
  }

  async deriveFieldKey(masterKey: CryptoKey, fieldPath: string): Promise<CryptoKey> {
    const rawMaster = await crypto.subtle.exportKey('raw', masterKey);
    const hkdfKey = await crypto.subtle.importKey('raw', rawMaster, 'HKDF', false, ['deriveKey']);
    const encoder = new TextEncoder();
    return crypto.subtle.deriveKey(
      {
        name: 'HKDF',
        hash: 'SHA-256',
        salt: new Uint8Array(32),
        info: encoder.encode(fieldPath),
      },
      hkdfKey,
      { name: 'HMAC', hash: 'SHA-256', length: 256 },
      false,
      ['sign'],
    );
  }

  async computeToken(fieldKey: CryptoKey, value: string | number): Promise<string> {
    const normalized = this._normalize(value);
    const encoder = new TextEncoder();
    const signature = await crypto.subtle.sign('HMAC', fieldKey, encoder.encode(normalized));
    return this._truncateAndEncode(new Uint8Array(signature));
  }

  async computeCompoundToken(fieldKey: CryptoKey, values: (string | number)[]): Promise<string> {
    const normalized = values.map(v => this._normalize(v)).join('\x00');
    const encoder = new TextEncoder();
    const signature = await crypto.subtle.sign('HMAC', fieldKey, encoder.encode(normalized));
    return this._truncateAndEncode(new Uint8Array(signature));
  }

  private _normalize(value: string | number): string {
    if (typeof value === 'number') {
      return `n:${value}`;
    }
    return `s:${value.toLowerCase().trim()}`;
  }

  private _truncateAndEncode(bytes: Uint8Array): string {
    const truncated = bytes.slice(0, this._tokenLengthBytes);
    let binary = '';
    for (let i = 0; i < truncated.length; i++) {
      binary += String.fromCharCode(truncated[i]);
    }
    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }
}
