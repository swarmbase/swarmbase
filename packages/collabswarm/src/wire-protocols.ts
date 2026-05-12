export const bloomFilterUpdateV1 = '/collabswarm/bloom-index/1.0.0';

// V2 doc-load, key-update, and snapshot-load handlers use a shared handler
// model where a single handler serves all documents. The key-update wire
// format prepends a length-prefixed document-path header so the shared
// handler can route requests to the correct document.
export const documentLoadV2 = '/collabswarm/doc-load/2.0.0';
export const documentKeyUpdateV2 = '/collabswarm/key-update/2.0.0';
export const snapshotLoadV2 = '/collabswarm/snapshot-load/2.0.0';

// BeeKEM Welcome v1: onboards a new reader into a document. The inviting
// writer sends a Welcome containing (a) the invitation epoch ID the
// recipient should record so subsequent `since_invited` history filtering
// works, and (b) the keychain changes filtered per the document's
// `HistoryVisibility` setting -- so the new reader can decrypt (at least)
// the current document state. The payload uses the same shared
// length-prefixed-document-path header as the V2 key-update protocol so
// the shared handler can route incoming Welcomes to the correct document.
//
// =============================================================================
// CONFIDENTIALITY: payload sealed to the recipient (ECIES, P-256 ECDH +
// HKDF-SHA-256 + AES-256-GCM)
// =============================================================================
// The Welcome's keychain delta is **not** broadcast in the clear. The
// `CRDTSyncMessage` carrying a Welcome has a dedicated `eciesSealed` field
// (see `crdt-sync-message.ts` / `ecies.ts`) which is the ECIES sealed-box
// over the serialized keychain changes, encrypted under the recipient's
// ECDH public key (`welcomeRecipientKemPublicKey`). Only the recipient
// holding the matching ECDH private key can recover the plaintext keychain
// delta -- a non-recipient peer that is connected at broadcast time sees
// only the opaque ciphertext + ephemeral public key + nonce + tag.
//
// The writer signature covers the sealed bytes (not the plaintext), so a
// connected peer cannot alter the sealed payload without invalidating the
// signature. The recipient binding (`welcomeRecipient`, also covered by
// the signature) prevents an authorized writer from re-pointing a sealed
// payload at a different identity than the one the encryption keypair
// belongs to.
//
// Defense-in-depth retained from earlier versions of this protocol:
//   - `welcomeRecipient` continues to gate processing: a well-behaved
//     non-target peer drops the Welcome rather than attempting to install
//     the keychain delta. Confidentiality is enforced by ECIES; the
//     recipient binding is the authorization gate.
//   - libp2p's Noise/TLS transport still protects on-wire bytes from
//     off-path observers, on top of the application-layer encryption.
//
// =============================================================================
// Race mitigation on the receive side
// =============================================================================
// The inviter sends the readers-ACL update over pubsub and the Welcome over
// a direct stream; without coordination these can arrive out of order on the
// recipient. The Welcome itself is fire-and-forget: there is NO ack protocol
// in this version, and the inviter does NOT retry. Instead, the recipient's
// `CollabswarmDocument._evaluateAndApplyBeeKEMWelcome` buffers Welcomes
// dropped solely because the local user is not yet in the readers ACL into a
// small bounded `pendingWelcomes` Map (max 16 entries, ~5 min TTL) keyed by
// `hex(welcomeEpochId)`. The buffer is drained on every readers-ACL merge,
// so a Welcome that arrived before its corresponding ACL update gets
// replayed automatically. A Welcome that exhausts the TTL without an
// unblocking ACL update is discarded; the recipient must then rely on a
// fresh document-load against an authorized peer to recover keychain state.
//
// Note: only the reader-onboarding path is wired in this PR
// (`CollabswarmDocument.addReader`). A writer-onboarding flow that
// piggy-backs on the same wire format is a future extension; until that
// is wired up the protocol is documented as a reader-only flow.
export const beekemWelcomeV1 = '/collabswarm/beekem-welcome/1.0.0';
