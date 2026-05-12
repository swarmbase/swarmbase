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
// SAFETY-CRITICAL: opt-in broadcast (PR #273 review comment #3)
// =============================================================================
// The Welcome payload (including `keychainChanges` -- current document key
// material) is broadcast in **plaintext** at the application layer over this
// protocol to **every** currently-connected libp2p peer. libp2p's Noise/TLS
// transport protects on-wire bytes from off-path observers but does NOT limit
// which connected peers can see the payload. The `welcomeRecipient` binding
// is an authorization control (honest non-target peers drop the message), not
// a confidentiality control: a connected unauthorized or malicious peer can
// retain `keychainChanges` and use it to decrypt subsequent pubsub traffic.
//
// Because of this, `CollabswarmDocument._sendBeeKEMWelcome` is gated behind
// `CollabswarmConfig.experimentalBeeKEMBroadcastWelcome`, which defaults to
// `false`. Only enable the flag in deployments with a trusted connection set
// (authenticated private swarms, closed test/lab environments, etc.). For
// untrusted / public mesh deployments, leave the flag `false` and rely on
// fresh-document-load onboarding until recipient-encrypted key delivery
// (HPKE/ECIES; tracked as `#BEEKEM-PAYLOAD-ENC`) lands.
//
// =============================================================================
// Race mitigation on the receive side (PR #273 review comments #1 + #2)
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
