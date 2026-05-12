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
 *
 * SECURITY NOTE: writer-auth (`verifyWriterSignature`) is enforced
 * **unconditionally** on Welcomes, independent of the document-key
 * signing toggle (`enableSigning` on `CollabswarmConfig`). Welcomes are
 * broadcast in plaintext to every connected peer and carry the document
 * keychain delta + an `_invitationEpoch` binding; without a writer
 * signature any peer could inject arbitrary `keychainChanges` and force
 * a recipient's join boundary, enabling key poisoning / DoS against
 * `since_invited` history filtering. `enableSigning` is a knob for
 * application-layer signing of *document changes*; Welcome authenticity
 * is a separate concern and must always be verified. Wire that up by
 * having `verifyWriterSignature` actually do the verification regardless
 * of any signing-config short-circuit elsewhere in the stack.
 */
export interface WelcomeValidationDeps<ChangesType, PublicKey> {
  /** The document this Welcome should be for. */
  documentPath: string;
  /** Local user's public key, used for the recipient binding check. */
  localUserPublicKey: PublicKey;
  /** Serialize a public key into the wire form the Welcome carries. */
  serializePublicKey: (pk: PublicKey) => Promise<string>;
  /** Check whether `pk` is currently a reader on the document. */
  isReader: (pk: PublicKey) => Promise<boolean>;
  /**
   * Verify a writer signature over the canonical (signature-stripped)
   * serialization of the message. Returns `true` iff the signature is
   * valid and the signer is currently an authorized writer.
   *
   * MUST always perform real verification (do not short-circuit to
   * `true` when application-layer signing is disabled): Welcomes are
   * always writer-authenticated.
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
  //
  // We also treat a zero-length `Uint8Array` as malformed: a truthy
  // check alone passes empty buffers, but recording an empty epoch ID
  // as `_invitationEpoch` would later make every `historySince` lookup
  // miss (key IDs in the keychain are always non-empty, so the
  // "boundary not found" recovery would kick in on every load and
  // silently return the full history -- defeating `since_invited`
  // filtering).
  if (!message.welcomeEpochId || message.welcomeEpochId.length === 0) {
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
  // Treat unknown shapes (no `length`, no `byteLength`) as malformed by
  // computing `0` for the fallback case. Combined with `<= 0` below this
  // fails closed for any structurally invalid payload rather than
  // accepting it and exploding later during the keychain merge.
  const keychainChangesLength =
    keychainChanges == null
      ? 0
      : typeof keychainChanges.length === 'number'
        ? keychainChanges.length
        : typeof keychainChanges.byteLength === 'number'
          ? keychainChanges.byteLength
          : 0;
  if (keychainChanges == null || keychainChangesLength <= 0) {
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
  //
  // KNOWN RACE: the inviter publishes the ACL update over pubsub and
  // sends the Welcome over a direct stream. Network reordering can
  // cause the Welcome to arrive on the recipient before the ACL
  // update has been applied -- in which case `isReader` legitimately
  // returns `false` here even though the Welcome is genuine.
  //
  // Mitigation (PR #273 review comments #1 + #2): this gate still
  // returns `drop-unauthorized` / `not-in-readers-acl` so the
  // validator stays pure, but the production receive path in
  // `CollabswarmDocument._evaluateAndApplyBeeKEMWelcome` treats this
  // specific drop reason as a signal to *buffer* the Welcome in a
  // bounded `pendingWelcomes: Map<hex(welcomeEpochId), ...>` (max 16
  // entries, ~5 min TTL) rather than dropping it forever. The buffer
  // is drained by `_drainPendingWelcomes` after every readers-ACL
  // `merge`, so a Welcome that arrived before the ACL update gets
  // replayed as soon as the ACL catches up.
  //
  // The inviter does **not** retry Welcomes (`_sendBeeKEMWelcome` is
  // fire-and-forget by design -- no ack protocol exists in this
  // protocol version). Buffering on the recipient is therefore the
  // authoritative race mitigation; documentation in
  // `_sendBeeKEMWelcome` and `wire-protocols.ts` reflects that. A
  // Welcome that exhausts the TTL without an unblocking ACL update
  // is discarded and the recipient must rely on a fresh
  // document-load against an authorized peer to recover.
  if (!(await deps.isReader(deps.localUserPublicKey))) {
    return { kind: 'drop-unauthorized', reason: 'not-in-readers-acl' };
  }

  // Verify the writer signature **unconditionally**. The signing
  // convention matches `_signWelcomeAsWriter` on the inviter side: the
  // signature is computed over the serialized message with the
  // `signature` field stripped. Because the recipient binding is
  // included in the signed payload, only an authorized writer can
  // claim a particular recipient.
  //
  // SECURITY (PR #273 review, comment A): unlike normal sync-message
  // signing -- which is gated by the swarm-wide `enableSigning` config
  // -- Welcome writer-auth is enforced even when document-key signing
  // is disabled. Welcomes are plaintext broadcasts that carry the
  // keychain delta and bind a recipient's `_invitationEpoch`; without
  // an unconditional writer-signature requirement any connected peer
  // could inject arbitrary `keychainChanges` (key poisoning) or set
  // `_invitationEpoch` for an existing reader (history-filter DoS).
  // The dep contract requires `verifyWriterSignature` to always do
  // real verification here.
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

  return { kind: 'accept' };
}
