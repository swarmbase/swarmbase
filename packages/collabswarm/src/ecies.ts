/**
 * ECIES (Elliptic Curve Integrated Encryption Scheme) helpers.
 *
 * Implements a sealed-box style primitive:
 *
 *   eciesSeal(plaintext, recipientPublicKey) -> sealed bytes
 *   eciesOpen(sealed, recipientPrivateKey) -> plaintext
 *
 * The sealed bytes have a self-describing layout:
 *
 *   [32 bytes HKDF salt][65 bytes ephemeral raw P-256 public key][12 bytes AES-GCM nonce][ciphertext + 16-byte AES-GCM tag]
 *
 * Construction:
 *   - The sender generates an ephemeral P-256 ECDH key pair.
 *   - ECDH(ephemeral_priv, recipient_pub) produces a shared 256-bit secret.
 *   - HKDF-SHA-256 with a random 32-byte salt and the fixed info string
 *     `"beekem-ecies"` derives a 256-bit AES-GCM key.
 *   - AES-256-GCM encrypts the plaintext under that key with a random
 *     96-bit nonce. The 16-byte GCM tag is appended to the ciphertext.
 *
 * The same algorithm (and the same `"beekem-ecies"` HKDF info string)
 * was originally implemented inline in `beekem.ts` for wrapping
 * BeeKEM node private keys; this module is the single source of truth
 * for that primitive so both BeeKEM and the Welcome payload encryption
 * path share the same wire format and parameters.
 *
 * SECURITY NOTES:
 *   - This is a sealed-box construction. There is **no** authentication
 *     of the sender; an attacker can produce a valid sealed payload to
 *     any known recipient public key. Sender authentication must be
 *     layered on top (e.g. the Welcome's writer signature, which covers
 *     the sealed bytes).
 *   - AES-GCM provides confidentiality + integrity over the ciphertext
 *     under the derived key, so the tag check fails on any single-bit
 *     flip of the sealed payload after construction.
 *   - The random HKDF salt is encoded in the output, so identical
 *     plaintexts to the same recipient produce different sealed bytes
 *     (non-deterministic encryption).
 */

/** ECDH curve used for sealing. Must match the recipient's key curve. */
const ECDH_CURVE = 'P-256';
const ECDH_ALGO = { name: 'ECDH', namedCurve: ECDH_CURVE };

/** AES-GCM nonce length in bytes. */
const AES_NONCE_LENGTH = 12;

/** HKDF salt length in bytes. */
const HKDF_SALT_LENGTH = 32;

/**
 * Raw exported P-256 public key length in bytes (uncompressed
 * SEC1 encoding: 0x04 || X || Y).
 */
export const ECIES_P256_PUBLIC_KEY_LENGTH = 65;

/**
 * HKDF info string. Constant across all callers so the derived key
 * binds to this protocol domain. Lazily initialized on first use so
 * the module is safe to import in environments where `TextEncoder`
 * is not a top-level global (e.g. jsdom-flavored test runners).
 */
let _hkdfInfo: Uint8Array | undefined;
function hkdfInfo(): Uint8Array {
  if (_hkdfInfo === undefined) {
    _hkdfInfo = new TextEncoder().encode('beekem-ecies');
  }
  return _hkdfInfo;
}

/**
 * Zero-copy cast for WebCrypto `BufferSource` parameters.
 *
 * The runtime accepts any `Uint8Array` directly, but the TypeScript
 * DOM types (TS 5.7+) narrow `BufferSource` to
 * `ArrayBufferView<ArrayBuffer>` and a `Uint8Array<ArrayBufferLike>`
 * (the default after the TS 5.7 typed-array generic) is not assignable.
 * Cast at the call boundary instead of copying via `slice` -- the latter
 * would double memory for large payloads and break for views backed by
 * `SharedArrayBuffer`.
 */
function bs(data: Uint8Array): BufferSource {
  return data as unknown as BufferSource;
}

/**
 * Encrypt `plaintext` to `recipientPublicKey` using ECIES (P-256 ECDH
 * + HKDF-SHA-256 + AES-256-GCM). Returns the self-describing sealed
 * bytes documented at the top of this module.
 *
 * @param plaintext The bytes to seal.
 * @param recipientPublicKey The recipient's P-256 ECDH public key
 *   (`CryptoKey`, algorithm `{ name: 'ECDH', namedCurve: 'P-256' }`).
 */
export async function eciesSeal(
  plaintext: Uint8Array,
  recipientPublicKey: CryptoKey,
): Promise<Uint8Array> {
  // Generate ephemeral ECDH key pair for ECIES.
  const ephemeral = await crypto.subtle.generateKey(ECDH_ALGO, true, [
    'deriveBits',
  ]);

  // ECDH to derive shared secret.
  const sharedBits = await crypto.subtle.deriveBits(
    { name: 'ECDH', public: recipientPublicKey },
    ephemeral.privateKey,
    256,
  );

  // Random salt for HKDF domain separation.
  const salt = crypto.getRandomValues(new Uint8Array(HKDF_SALT_LENGTH));

  // Derive AES key from shared secret via HKDF.
  //
  // WebCrypto accepts `BufferSource` (i.e. `ArrayBufferView` such as
  // `Uint8Array`, or `ArrayBuffer`) for the byte-shaped parameters
  // below, so we pass the views directly rather than cloning into a
  // fresh `ArrayBuffer`. Avoiding the copies keeps memory usage flat
  // for large payloads and lets `Uint8Array`s backed by
  // `SharedArrayBuffer` (which lacks `.slice()`) flow through unchanged.
  const hkdfKey = await crypto.subtle.importKey(
    'raw',
    sharedBits,
    'HKDF',
    false,
    ['deriveKey'],
  );
  const aesKey = await crypto.subtle.deriveKey(
    {
      name: 'HKDF',
      hash: 'SHA-256',
      salt: bs(salt),
      info: bs(hkdfInfo()),
    },
    hkdfKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt'],
  );

  // Encrypt with AES-GCM.
  const nonce = crypto.getRandomValues(new Uint8Array(AES_NONCE_LENGTH));
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: bs(nonce) },
    aesKey,
    bs(plaintext),
  );

  // Export ephemeral public key (uncompressed point, 65 bytes for P-256).
  const ephemeralPub = new Uint8Array(
    await crypto.subtle.exportKey('raw', ephemeral.publicKey),
  );

  // Concatenate: salt || ephemeralPub || nonce || ciphertext.
  const result = new Uint8Array(
    salt.byteLength +
      ephemeralPub.byteLength +
      nonce.byteLength +
      ciphertext.byteLength,
  );
  let offset = 0;
  result.set(salt, offset);
  offset += salt.byteLength;
  result.set(ephemeralPub, offset);
  offset += ephemeralPub.byteLength;
  result.set(nonce, offset);
  offset += nonce.byteLength;
  result.set(new Uint8Array(ciphertext), offset);

  return result;
}

/**
 * Decrypt a sealed payload produced by `eciesSeal` using the
 * recipient's P-256 ECDH private key. Throws if the sealed bytes are
 * truncated, the ephemeral public key cannot be imported, or the
 * AES-GCM tag fails to verify (typically: wrong recipient private
 * key, or tampered payload).
 *
 * @param sealed The self-describing sealed bytes.
 * @param recipientPrivateKey The recipient's P-256 ECDH private key
 *   (`CryptoKey`, algorithm `{ name: 'ECDH', namedCurve: 'P-256' }`,
 *   usages must include `'deriveBits'`).
 */
export async function eciesOpen(
  sealed: Uint8Array,
  recipientPrivateKey: CryptoKey,
): Promise<Uint8Array> {
  // Minimum sane length: salt + ephemeralPub + nonce + at least the
  // 16-byte GCM tag. Anything shorter cannot possibly be valid.
  const minLength =
    HKDF_SALT_LENGTH + ECIES_P256_PUBLIC_KEY_LENGTH + AES_NONCE_LENGTH + 16;
  if (sealed.byteLength < minLength) {
    throw new Error(
      `eciesOpen: sealed payload truncated (got ${sealed.byteLength} bytes, need at least ${minLength})`,
    );
  }

  let pos = 0;
  const salt = sealed.slice(pos, pos + HKDF_SALT_LENGTH);
  pos += HKDF_SALT_LENGTH;

  const ephemeralPubBytes = sealed.slice(
    pos,
    pos + ECIES_P256_PUBLIC_KEY_LENGTH,
  );
  pos += ECIES_P256_PUBLIC_KEY_LENGTH;

  const nonce = sealed.slice(pos, pos + AES_NONCE_LENGTH);
  pos += AES_NONCE_LENGTH;

  const ciphertext = sealed.slice(pos);

  // Import ephemeral public key. WebCrypto accepts a `BufferSource`
  // here, so we pass the `Uint8Array` view directly instead of
  // cloning into a fresh `ArrayBuffer` (see seal-side comment above).
  const ephemeralPublicKey = await crypto.subtle.importKey(
    'raw',
    bs(ephemeralPubBytes),
    ECDH_ALGO,
    true,
    [],
  );

  // ECDH to derive shared secret.
  const sharedBits = await crypto.subtle.deriveBits(
    { name: 'ECDH', public: ephemeralPublicKey },
    recipientPrivateKey,
    256,
  );

  // Derive AES key (same params as encrypt, with the extracted salt).
  const hkdfKey = await crypto.subtle.importKey(
    'raw',
    sharedBits,
    'HKDF',
    false,
    ['deriveKey'],
  );
  const aesKey = await crypto.subtle.deriveKey(
    {
      name: 'HKDF',
      hash: 'SHA-256',
      salt: bs(salt),
      info: bs(hkdfInfo()),
    },
    hkdfKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['decrypt'],
  );

  // Decrypt: AES-GCM tag failure throws.
  const plaintext = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: bs(nonce) },
    aesKey,
    bs(ciphertext),
  );

  return new Uint8Array(plaintext);
}

/**
 * Convenience helper: import a raw P-256 ECDH public key from
 * SEC1 uncompressed bytes into a `CryptoKey` usable with `eciesSeal`.
 *
 * Throws if the bytes are not a valid P-256 public point.
 */
export async function importEciesPublicKey(
  raw: Uint8Array,
): Promise<CryptoKey> {
  if (raw.byteLength !== ECIES_P256_PUBLIC_KEY_LENGTH) {
    throw new Error(
      `importEciesPublicKey: raw key must be ${ECIES_P256_PUBLIC_KEY_LENGTH} bytes (got ${raw.byteLength})`,
    );
  }
  return crypto.subtle.importKey('raw', bs(raw), ECDH_ALGO, true, []);
}

/**
 * Convenience helper: export an ECDH P-256 public key to raw SEC1
 * uncompressed bytes (the same encoding `importEciesPublicKey` expects).
 */
export async function exportEciesPublicKey(
  key: CryptoKey,
): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.exportKey('raw', key));
}

/**
 * Generate a fresh P-256 ECDH key pair suitable for ECIES sealing.
 * The private key has `deriveBits` usage so it can be passed directly
 * to `eciesOpen`.
 */
export async function generateEciesKeyPair(): Promise<CryptoKeyPair> {
  return crypto.subtle.generateKey(ECDH_ALGO, true, ['deriveBits']);
}
