/**
 * Pure validation logic for incoming BeeKEM Welcome messages.
 *
 * The full receive path in
 * `CollabswarmDocument.handleBeeKEMWelcomeRequestData` mixes validation
 * with stateful mutation (`keychain.merge`, setting `_invitationEpoch`).
 * The validation half is extracted here as a pure async function so its
 * security-critical branches -- document-path mismatch, missing epoch
 * ID, missing recipient binding, wrong recipient, not-in-readers-ACL,
 * missing signature, invalid signature -- can be exercised directly in
 * unit tests against mock providers, without standing up a full
 * libp2p/Helia stack.
 *
 * The production handler in `CollabswarmDocument` calls this helper and
 * then applies the keychain merge + `_invitationEpoch` assignment when
 * the result is `accept`. Keep the two in sync: if you add or reorder a
 * gate in the handler, mirror the change here.
 */

import { CRDTSyncMessage } from './crdt-sync-message';
import { SyncMessageSerializer } from './sync-message-serializer';

/**
 * Outcome of validating an incoming Welcome.
 *
 * `accept`: all gates passed; the caller should merge `keychainChanges`
 *   and record `welcomeEpochId` as the local invitation epoch.
 * `drop-not-for-us`: legitimate Welcome addressed to another reader;
 *   the caller should silently ignore it (this is not an attack).
 * `drop-malformed`: the Welcome is missing required fields (path,
 *   epoch ID, recipient binding, or keychain key material). The
 *   `reason` is a stable string suitable for log messages and tests.
 * `drop-unauthorized`: the Welcome failed an authorization gate
 *   (not in readers ACL, unsigned when signing is enabled, invalid
 *   signature). The `reason` distinguishes the specific failure.
 */
export type WelcomeValidationResult =
  | { kind: 'accept' }
  | { kind: 'drop-not-for-us' }
  | { kind: 'drop-malformed'; reason: WelcomeMalformedReason }
  | { kind: 'drop-unauthorized'; reason: WelcomeUnauthorizedReason };

export type WelcomeMalformedReason =
  | 'wrong-document'
  | 'missing-welcome-epoch-id'
  | 'missing-welcome-recipient'
  | 'missing-keychain-changes';

export type WelcomeUnauthorizedReason =
  | 'not-in-readers-acl'
  | 'missing-signature'
  | 'invalid-signature';

/**
 * Minimal dependency surface a Welcome validator needs. Modeled as a
 * record of callables rather than full provider instances so tests can
 * pass small mocks.
 */
export interface WelcomeValidationDeps<ChangesType, PublicKey> {
  /** The document this Welcome should be for. */
  documentPath: string;
  /** Local user's public key, used for the recipient binding check. */
  localUserPublicKey: PublicKey;
  /** Whether writer signing is currently enabled on this document. */
  isSigningEnabled: () => boolean;
  /** Serialize a public key into the wire form the Welcome carries. */
  serializePublicKey: (pk: PublicKey) => Promise<string>;
  /** Check whether `pk` is currently a reader on the document. */
  isReader: (pk: PublicKey) => Promise<boolean>;
  /**
   * Verify a writer signature over the canonical (signature-stripped)
   * serialization of the message. Returns `true` iff the signature is
   * valid and the signer is currently an authorized writer.
   */
  verifyWriterSignature: (
    raw: Uint8Array,
    signature: string,
  ) => Promise<boolean>;
  /**
   * Serializer used to compute the canonical bytes signed by the
   * inviter (i.e. the sync message with the `signature` field stripped).
   */
  syncMessageSerializer: SyncMessageSerializer<ChangesType, PublicKey>;
}

/**
 * Run every validation gate enforced by
 * `CollabswarmDocument.handleBeeKEMWelcomeRequestData`, in the same
 * order, and return a discriminated result so the caller can decide
 * what to do next (merge / drop / ignore).
 *
 * This function performs **no** mutations. The caller is responsible
 * for merging `message.keychainChanges` into the local keychain and
 * recording `message.welcomeEpochId` as the local invitation epoch
 * when the result is `accept`.
 */
export async function evaluateBeeKEMWelcome<ChangesType, PublicKey>(
  message: CRDTSyncMessage<ChangesType, PublicKey>,
  deps: WelcomeValidationDeps<ChangesType, PublicKey>,
): Promise<WelcomeValidationResult> {
  // Defense in depth: the shared protocol handler routes by document
  // path header, but a misrouted or hand-crafted message could still
  // carry a mismatched `documentId`. Drop these without further work.
  if (message.documentId && message.documentId !== deps.documentPath) {
    return { kind: 'drop-malformed', reason: 'wrong-document' };
  }

  // The Welcome MUST carry an invitation epoch ID -- without it we
  // cannot record the recipient's join boundary, which is the entire
  // reason the Welcome exists.
  if (!message.welcomeEpochId) {
    return { kind: 'drop-malformed', reason: 'missing-welcome-epoch-id' };
  }

  // Recipient binding: Welcomes are broadcast to every connected peer
  // (the inviter cannot identify the new reader's libp2p connection
  // directly), so without an explicit recipient binding any
  // well-behaved peer receiving a writer-signed Welcome would install
  // the document key. The binding is covered by the writer signature
  // (verified below), so only an authorized writer can claim a
  // recipient.
  if (!message.welcomeRecipient) {
    return { kind: 'drop-malformed', reason: 'missing-welcome-recipient' };
  }

  // A Welcome without `keychainChanges` is useless: the recipient
  // would record `welcomeEpochId` as their invitation epoch (gating
  // future `since_invited` history filtering) without installing the
  // corresponding document key, leaving them unable to decrypt any
  // pubsub traffic. Worse, recording an epoch the recipient cannot
  // back up with a key in their keychain can make later visibility
  // filtering misbehave (the local view believes "I joined at epoch
  // E" but has no E key). Treat a missing/empty payload as malformed
  // and refuse to record the epoch.
  const keychainChanges = message.keychainChanges as
    | { length?: number; byteLength?: number }
    | undefined;
  const keychainChangesLength =
    keychainChanges == null
      ? 0
      : typeof keychainChanges.length === 'number'
        ? keychainChanges.length
        : typeof keychainChanges.byteLength === 'number'
          ? keychainChanges.byteLength
          : -1;
  if (keychainChanges == null || keychainChangesLength === 0) {
    return { kind: 'drop-malformed', reason: 'missing-keychain-changes' };
  }

  const localSerializedKey = await deps.serializePublicKey(
    deps.localUserPublicKey,
  );
  if (message.welcomeRecipient !== localSerializedKey) {
    // Not addressed to us. Not necessarily an attack -- a legitimate
    // Welcome to another peer flows past our connection too. Silently
    // ignore.
    return { kind: 'drop-not-for-us' };
  }

  // Defense in depth: the local user must already be in the readers
  // ACL by the time the Welcome arrives (the inviter sends the ACL
  // add ahead of the Welcome). Catches misordered or replayed
  // Welcomes where we have not been added (or have been removed
  // since).
  if (!(await deps.isReader(deps.localUserPublicKey))) {
    return { kind: 'drop-unauthorized', reason: 'not-in-readers-acl' };
  }

  // Verify the writer signature when signing is on. The signing
  // convention matches `_signAsWriter`: the signature is computed
  // over the serialized message with the `signature` field stripped.
  // Because the recipient binding is included in the signed payload,
  // only an authorized writer can claim a particular recipient.
  if (deps.isSigningEnabled()) {
    if (!message.signature) {
      return { kind: 'drop-unauthorized', reason: 'missing-signature' };
    }
    const { signature, ...messageWithoutSignature } = message;
    const raw = deps.syncMessageSerializer.serializeSyncMessage(
      messageWithoutSignature,
    );
    if (!(await deps.verifyWriterSignature(raw, signature))) {
      return { kind: 'drop-unauthorized', reason: 'invalid-signature' };
    }
  }

  return { kind: 'accept' };
}
