import { CRDTChangeNode } from './crdt-change-node';
import { SerializedPathUpdate } from './path-update-wire';
import { CRDTSnapshotNode } from './snapshot-node';

/**
 * CRDTSyncMessage is the message sent over both GossipSub pubsub topics and in response to
 * load document requests.
 *
 * @typeParam ChangesType A block of CRDT change(s).
 */
export type CRDTSyncMessage<ChangesType, PublicKey = unknown> = {
  /**
   * ID of a collabswarm document.
   */
  documentId: string;

  /**
   * CID of the root change node.
   */
  changeId?: string;

  /**
   * Root of the Merkle-DAG change tree. Each `CRDTChangeNode` contains a change
   * payload and optional `children` linking to prior nodes. A node whose `change`
   * is `undefined` (deferred) should be fetched from the Helia blockstore by CID.
   *
   * Changes are decrypted via `ChangesSerializer` and sync messages via
   * `SyncMessageSerializer`.
   */
  changes?: CRDTChangeNode<ChangesType>;

  /**
   * Optional snapshot for fast sync.
   * When present, peers can load from the snapshot state instead of replaying
   * the full change history. Post-snapshot changes are still included in `changes`.
   */
  snapshot?: CRDTSnapshotNode<ChangesType, PublicKey>;

  /**
   * Optional document keys list. Populated by **load responses** (doc-load and
   * snapshot-load) where the entire sync message is encrypted under the current
   * document key on a stream to an already-authorized peer. BeeKEM Welcome
   * messages do **not** populate this field directly -- their keychain delta
   * is delivered via the recipient-encrypted `eciesSealed` field below so it
   * is opaque to non-recipient peers.
   *
   * The keychain delta is decrypted via the CRDT-specific `ChangesSerializer`
   * (yjs/automerge) and the sync message itself via `SyncMessageSerializer`.
   */
  keychainChanges?: ChangesType;

  /**
   * Optional invitation epoch ID for BeeKEM Welcome messages. When the
   * recipient processes a Welcome, this is the key ID the recipient should
   * record as their `_invitationEpoch`, gating subsequent `since_invited`
   * history filtering. The field is base64-encoded for JSON-safe transport
   * by the sync-message serializers.
   */
  welcomeEpochId?: Uint8Array;

  /**
   * Optional recipient binding for BeeKEM Welcome messages. The inviter
   * cannot identify the new reader's libp2p connection directly, so
   * Welcomes are broadcast to every connected peer; without a binding, a
   * well-behaved non-member peer would still process a writer-signed
   * Welcome and install the document key. The receiver MUST drop a
   * Welcome whose `welcomeRecipient` does not match its own local user
   * public key. The field is the serialized public key of the intended
   * recipient (same encoding as the readers ACL) and is included in the
   * signed payload, so a legitimate writer attests to the recipient.
   * JSON-safe (a string) because the serialized public key is already a
   * string.
   *
   * NOTE: this is the **authorization** binding (which identity the
   * Welcome was meant for). Confidentiality is provided separately by
   * the `eciesSealed` payload, which only the recipient holding the
   * matching `welcomeRecipientKemPublicKey` private key can decrypt.
   */
  welcomeRecipient?: string;

  /**
   * Optional recipient ECDH public key for BeeKEM Welcome messages. Raw
   * SEC1-uncompressed P-256 public key bytes (65 bytes) of the
   * recipient's encryption key, encoded as base64 on the wire by the
   * sync-message serializers. The inviter seals `eciesSealed` against
   * this public key; the recipient opens it with the matching private
   * key.
   *
   * Bound to the recipient identity by the writer signature (covers
   * both `welcomeRecipient` and `welcomeRecipientKemPublicKey`), so an
   * authorized writer must commit to a specific KEM public key for a
   * specific recipient identity. A recipient that holds the matching
   * KEM private key but observes a different `welcomeRecipient` MUST
   * drop the Welcome (the writer asserted the Welcome is for a
   * different identity).
   */
  welcomeRecipientKemPublicKey?: Uint8Array;

  /**
   * Sealed payload for BeeKEM Welcome messages. Output of `eciesSeal`
   * over the inviter-side serialized keychain delta, encrypted under
   * the recipient's ECDH public key
   * (`welcomeRecipientKemPublicKey`). The plaintext is the
   * provider-specific serialized keychain changes (the same bytes the
   * CRDT-specific `ChangesSerializer` would emit for those changes);
   * the recipient opens the sealed payload with their KEM private key
   * and routes the result through the provider deserializer before
   * merging into the local keychain.
   *
   * The sealed bytes are base64-encoded on the wire for JSON
   * transport.
   *
   * SECURITY: the writer signature covers the sealed bytes, not the
   * plaintext, so a replayed/altered sealed payload fails signature
   * verification. AES-GCM authenticates the ciphertext under the
   * derived per-message key, so a non-recipient cannot read or alter
   * the plaintext without detection.
   */
  eciesSealed?: Uint8Array;

  /**
   * Optional BeeKEM ratchet-tree `PathUpdate` carried by the
   * `beekemPathUpdateV1` wire protocol. Populated when a writer revokes
   * a reader via `CollabswarmDocument.removeReader`: the writer calls
   * `BeeKEM.removeMember(leafIdx)` + `BeeKEM.update()`, serializes the
   * resulting `PathUpdate` via `serializePathUpdateForWire`, and
   * broadcasts it here so surviving readers can re-derive the new
   * document encryption key. Receivers feed the deserialized
   * `PathUpdate` into `BeeKEM.processPathUpdate` to advance their
   * local ratchet state.
   *
   * Only populated on the BeeKEM PathUpdate v1 wire path; absent on
   * sync messages flowing over GossipSub / document-load / Welcome.
   */
  pathUpdate?: SerializedPathUpdate;

  /**
   * Optional 32-byte epoch identifier paired with `pathUpdate`. The
   * sender derives this from the new BeeKEM root secret via
   * `deriveEpochIdFromRootSecret`; the receiver re-derives it after
   * `BeeKEM.processPathUpdate` and validates that the two match
   * before installing the new key. Mismatch means the receiver
   * derived a different root than the sender (e.g. stale local tree
   * state) and the PathUpdate is rejected rather than installing a
   * key under the wrong epoch ID.
   *
   * Base64-encoded by the sync-message serializers (yjs / automerge)
   * for JSON-safe transport, mirroring `welcomeEpochId`.
   */
  pathUpdateEpochId?: Uint8Array;

  /**
   * Signature of the sync message.
   */
  signature?: string;
};
