/** Length of an epoch ID in bytes (SHA-256 hash). */
export const EPOCH_ID_LENGTH = 32;

/** Length of AES-256-GCM nonce in bytes. */
export const NONCE_LENGTH = 12;

/** HKDF info string for deriving the epoch secret. */
export const EPOCH_SECRET_INFO = 'swarmdb-epoch-v1';

/** HKDF info string for deriving the AES-GCM encryption key. */
export const ENCRYPTION_KEY_INFO = 'aes-gcm-key';

/**
 * Represents an epoch — a contiguous period during which a specific set of
 * members shares a symmetric encryption key. Epoch boundaries are triggered
 * by member add/remove or explicit key updates.
 */
export interface Epoch {
  /** 32-byte SHA-256 hash identifying this epoch. */
  id: Uint8Array;
  /** The symmetric AES-256-GCM encryption key for this epoch. */
  encryptionKey: CryptoKey;
  /** Set of member public key hashes in this epoch. */
  memberHashes: Set<string>;
  /** Parent epoch ID (undefined for the first epoch). */
  parentEpochId?: Uint8Array;
  /** Timestamp when this epoch was created. */
  createdAt: number;
}

/** Result of an epoch transition. */
export interface EpochTransition {
  /** The new epoch. */
  epoch: Epoch;
  /** Reason for the transition. */
  reason: 'member_added' | 'member_removed' | 'key_update';
  /** Public key hash of the affected member (for add/remove). */
  affectedMember?: string;
}

/**
 * Convert a Uint8Array to a lowercase hex string.
 */
export function toHex(bytes: Uint8Array): string {
  const hexChars: string[] = new Array(bytes.length);
  for (let i = 0; i < bytes.length; i++) {
    hexChars[i] = bytes[i].toString(16).padStart(2, '0');
  }
  return hexChars.join('');
}

/**
 * Generate an epoch ID as a SHA-256 hash of the concatenation of the group
 * secret and the optional parent epoch ID. Using a hash instead of a sequential
 * counter prevents conflicts from concurrent epoch creation.
 *
 * @param groupSecret - The shared group secret from key agreement.
 * @param parentEpochId - The ID of the preceding epoch, if any.
 * @returns A 32-byte Uint8Array epoch ID.
 */
export async function generateEpochId(
  groupSecret: Uint8Array,
  parentEpochId?: Uint8Array,
): Promise<Uint8Array> {
  const input = parentEpochId
    ? new Uint8Array([...groupSecret, ...parentEpochId])
    : groupSecret;
  const hash = await crypto.subtle.digest('SHA-256', input.buffer as ArrayBuffer);
  return new Uint8Array(hash);
}

/**
 * Derive an epoch secret from the group key agreement output using HKDF-SHA256.
 *
 * ```
 * epoch_secret = HKDF-SHA256(ikm: groupKeyAgreementOutput, salt: epochId, info: "swarmdb-epoch-v1")
 * ```
 *
 * @param groupKeyAgreementOutput - The raw shared secret from the group key agreement protocol.
 * @param epochId - The 32-byte epoch ID, used as the HKDF salt.
 * @returns A 32-byte derived epoch secret.
 */
export async function deriveEpochSecret(
  groupKeyAgreementOutput: Uint8Array,
  epochId: Uint8Array,
): Promise<Uint8Array> {
  const baseKey = await crypto.subtle.importKey(
    'raw',
    groupKeyAgreementOutput.buffer as ArrayBuffer,
    'HKDF',
    false,
    ['deriveBits'],
  );
  const derived = await crypto.subtle.deriveBits(
    {
      name: 'HKDF',
      hash: 'SHA-256',
      salt: epochId.buffer as ArrayBuffer,
      info: new TextEncoder().encode(EPOCH_SECRET_INFO),
    },
    baseKey,
    256, // 32 bytes
  );
  return new Uint8Array(derived);
}

/**
 * Derive an AES-256-GCM CryptoKey from an epoch secret using HKDF-SHA256.
 *
 * ```
 * encryption_key = HKDF-SHA256(ikm: epochSecret, info: "aes-gcm-key", length: 32)
 * ```
 *
 * @param epochSecret - The 32-byte epoch secret from {@link deriveEpochSecret}.
 * @returns A CryptoKey suitable for AES-256-GCM encrypt/decrypt.
 */
export async function deriveEncryptionKey(
  epochSecret: Uint8Array,
): Promise<CryptoKey> {
  const baseKey = await crypto.subtle.importKey(
    'raw',
    epochSecret.buffer as ArrayBuffer,
    'HKDF',
    false,
    ['deriveKey'],
  );
  return crypto.subtle.deriveKey(
    {
      name: 'HKDF',
      hash: 'SHA-256',
      salt: new ArrayBuffer(0),
      info: new TextEncoder().encode(ENCRYPTION_KEY_INFO),
    },
    baseKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

/**
 * Create a complete epoch with a derived encryption key.
 *
 * This generates the epoch ID, derives the epoch secret, and then derives
 * the AES-256-GCM encryption key in a single call.
 *
 * @param groupSecret - The shared group secret from key agreement.
 * @param members - Set of member public key hashes for this epoch.
 * @param parentEpochId - The parent epoch ID, if any.
 * @returns A fully constructed {@link Epoch}.
 */
export async function createEpoch(
  groupSecret: Uint8Array,
  members: Set<string>,
  parentEpochId?: Uint8Array,
): Promise<Epoch> {
  const epochId = await generateEpochId(groupSecret, parentEpochId);
  const epochSecret = await deriveEpochSecret(groupSecret, epochId);
  const encryptionKey = await deriveEncryptionKey(epochSecret);

  return {
    id: epochId,
    encryptionKey,
    memberHashes: new Set(members),
    parentEpochId,
    createdAt: Date.now(),
  };
}

/**
 * Manages a chain of epochs, providing lookup by ID and transitions
 * that produce new epochs when membership changes.
 */
export class EpochManager {
  private _epochs: Map<string, Epoch> = new Map();
  private _currentEpochId?: Uint8Array;

  /** The current (most recent) epoch, or undefined if none exist. */
  get currentEpoch(): Epoch | undefined {
    if (!this._currentEpochId) return undefined;
    return this._epochs.get(toHex(this._currentEpochId));
  }

  /** Add an epoch to the manager and set it as the current epoch. */
  addEpoch(epoch: Epoch): void {
    this._epochs.set(toHex(epoch.id), epoch);
    this._currentEpochId = epoch.id;
  }

  /** Retrieve an epoch by its ID. */
  getEpoch(epochId: Uint8Array): Epoch | undefined {
    return this._epochs.get(toHex(epochId));
  }

  /** Return all known epochs in insertion order. */
  get epochs(): Epoch[] {
    return Array.from(this._epochs.values());
  }

  /**
   * Transition to a new epoch. Creates a child epoch whose parent is the
   * current epoch and sets it as the new current epoch.
   *
   * @param groupSecret - The new shared group secret from key agreement.
   * @param members - The updated set of member public key hashes.
   * @param reason - The reason for the epoch transition.
   * @param affectedMember - The public key hash of the added/removed member, if applicable.
   * @returns The {@link EpochTransition} describing the new epoch and its cause.
   */
  async transitionEpoch(
    groupSecret: Uint8Array,
    members: Set<string>,
    reason: EpochTransition['reason'],
    affectedMember?: string,
  ): Promise<EpochTransition> {
    const epoch = await createEpoch(groupSecret, members, this._currentEpochId);
    this.addEpoch(epoch);

    return {
      epoch,
      reason,
      affectedMember,
    };
  }
}
