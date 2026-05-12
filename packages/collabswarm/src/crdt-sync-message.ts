import { CRDTChangeNode } from './crdt-change-node';
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
   * Optional document keys list. Only populated while loading and receiving a document
   * key update (due to the removal of an ACL reader).
   *
   * NOTE: Keychain changes should only ever be sent over encrypted libp2p streams (not
   * GossipSub pubsub).
   *
   * SECURITY (PR #273 review comment #3 -- safe-by-default opt-in):
   * when this field appears in a BeeKEM Welcome (alongside
   * `welcomeEpochId` and `welcomeRecipient`), the payload is broadcast in
   * plaintext at the application layer to *every* currently-connected
   * peer. libp2p's Noise/TLS transport protects on-wire bytes but does
   * **not** restrict which connected peers can read the payload, so any
   * connected peer -- including unauthorized or malicious ones -- can
   * observe and retain `keychainChanges` and use it to decrypt
   * subsequent pubsub traffic. The `welcomeRecipient` binding is an
   * authorization control (an honest non-target peer drops the
   * Welcome), not a confidentiality control.
   *
   * Because of this, the BeeKEM Welcome broadcast path is gated behind
   * the explicit `CollabswarmConfig.experimentalBeeKEMBroadcastWelcome`
   * opt-in flag, which defaults to `false`. When disabled,
   * `_sendBeeKEMWelcome` is a no-op (with a warning) and Welcomes
   * carrying `keychainChanges` are never emitted on the wire by this
   * peer. See `_sendBeeKEMWelcome` for the rationale and follow-up plan.
   *
   * TODO(beekem-payload-encryption): encrypt the Welcome payload to the
   * recipient (HPKE/ECIES under the recipient's identity or BeeKEM
   * public key) so `keychainChanges` is opaque to every other connected
   * peer. Tracked as #BEEKEM-PAYLOAD-ENC.
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
   * Welcomes are broadcast to all peers; without a binding, a
   * well-behaved non-member peer would still process a writer-signed
   * Welcome and install the document key. The receiver MUST drop a
   * Welcome whose `welcomeRecipient` does not match its own local user
   * public key. The field is the serialized public key of the intended
   * recipient (same encoding as the readers ACL) and is included in the
   * signed payload, so a legitimate writer attests to the recipient.
   * JSON-safe (a string) because the serialized public key is already a
   * string.
   *
   * IMPORTANT: this is a routing / authorization binding, **not** a
   * confidentiality control. The Welcome payload is sent in plaintext at
   * the application layer; a malicious connected peer can still read or
   * exfiltrate `keychainChanges` regardless of whether the recipient
   * binding addresses it. Stronger confidentiality (recipient-encrypted
   * key delivery, or sending the Welcome only over a connection
   * authenticated to the recipient) is tracked as follow-up hardening
   * work.
   */
  welcomeRecipient?: string;

  /**
   * Signature of the sync message.
   */
  signature?: string;
};
