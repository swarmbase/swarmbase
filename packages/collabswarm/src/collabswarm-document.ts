/**
 * Document  is just for opening documents right now
 * @remarks
 *   A document is part of a Swarm.
 *   Document keys are attached to a single document.
 */

import { pipe } from 'it-pipe';
import { Libp2p } from 'libp2p';
import { Collabswarm, MAX_DOCUMENT_PATH_LENGTH } from './collabswarm';
import {
  concatUint8Arrays,
  firstTrue,
  readUint8Iterable,
  shuffleArray,
} from './utils';
import { wrapStream } from './stream-adapter';
import { CRDTProvider } from './crdt-provider';
import { AuthProvider, requireSerializePublicKey } from './auth-provider';
import {
  CRDTChangeNode,
  crdtChangeNodeDeferred,
  CRDTChangeNodeKind,
  crdtDocumentChangeNode,
  crdtReaderChangeNode,
  crdtWriterChangeNode,
} from './crdt-change-node';
import {
  MAX_CROSS_LINKS,
  MAX_RECENT_TIPS,
  mergeRemoteSyncTree,
  RecentTip,
  selectCrossLinks,
  trackTipInList,
} from './merkle-cross-links';
import { CRDTSyncMessage } from './crdt-sync-message';
import { ChangesSerializer } from './changes-serializer';
import { SyncMessageSerializer } from './sync-message-serializer';
import { evaluateBeeKEMWelcome } from './beekem-welcome-handler';
import { validateAndExportKemKeyPair } from './kem-key-pair';
import {
  eciesSeal,
  eciesOpen,
  importEciesPublicKey,
  ECIES_P256_PUBLIC_KEY_LENGTH,
} from './ecies';
import {
  beekemWelcomeV1,
  documentKeyUpdateV2,
  documentLoadV2,
  snapshotLoadV2,
} from './wire-protocols';
import { CRDTSnapshotNode } from './snapshot-node';
import { CompactionConfig, defaultCompactionConfig } from './compaction-config';
import {
  filterDeletableCIDs,
  loadChangeBlock as lazyLoadChangeBlock,
} from './blockstore-gc';
import { documentTopic } from './document-topic';
import { ACLProvider } from './acl-provider';
import { KeychainProvider } from './keychain-provider';
import { keychainHistorySinceOrFull } from './keychain';
import { LoadMessageSerializer } from './load-request-serializer';
import { CRDTLoadRequest } from './crdt-load-request';
import { Base64 } from 'js-base64';
import * as uuid from 'uuid';
import BufferList from 'bl';
import { Uint8ArrayList } from 'uint8arraylist';
import { CID } from 'multiformats';
import { UnixFS, unixfs } from '@helia/unixfs';
// libp2p v3 moved the `PubSubBaseProtocol` shim out of `@libp2p/pubsub` (the
// package has been removed). Use the concrete `GossipSub` service interface
// from `@libp2p/gossipsub` instead -- it is what `helia` actually wires up via
// `services.pubsub` and exposes the same publish/subscribe/event surface we
// rely on. `Message` (the pubsub message shape) likewise moved here.
import type { GossipSub, Message } from '@libp2p/gossipsub';
import { EventHandler, PeerId } from '@libp2p/interface';

/**
 * Controls what historical data new members receive when joining a document.
 *
 * - `current_only` (default): New member receives only a CRDT state snapshot.
 *   No historical epoch keys are included. Most private option.
 * - `full_history`: All epoch keys included in Welcome message.
 *   Suitable for audit trails and regulatory compliance.
 * - `since_invited`: Epoch keys from the invitation epoch onward.
 *   Partial history access.
 */
export type HistoryVisibility = 'current_only' | 'full_history' | 'since_invited';

/**
 * Handler type for local-change (changes made on the current computer) and remote-change (changes made by a remote peer) events.
 *
 * Subscribe functions that match this type signature to track local-change/remote-change events.
 */
export type CollabswarmDocumentChangeHandler<DocType, PublicKey> = (
  current: DocType,
  readers: PublicKey[],
  writers: PublicKey[],
  hashes: string[],
) => void;

/**
 * A collabswarm "document" represents a single CRDT document.
 *
 * A new collabswarm document undergoes the following process when it is first opened:
 * - Connect to the document pubsub topic
 * - Send a load-document request to any peer (and keep trying with different peers if one fails) (`.load()`)
 * - Use load-document response from peer (if any) to update existing document with any new hashes (`.sync()`)
 *
 * A new local change (made on the current computer) causes the following:
 * - The delta between the current document and the new document is calculated
 * - A sync message is constructed and sent to all peers on the document pubsub topic (`.change(...)`)
 *
 * A new remote change (made on a peer's computer) causes the following:
 * - New change hashes are used to update exising document with any new changes (`.sync()`)
 *
 * Any edits made to the document should go through its corresponding CollabswarmDocument's
 * `.change(...)` method:
 *
 * @example Automerge usage
 * ```ts
 * // Open a document (Automerge-based collabswarm instance).
 * const doc1 = collabswarm.doc("/my-doc1-path");
 * if (!doc1) throw new Error("Failed to create document reference");
 * await doc1.open();
 *
 * await doc1.change(doc => {
 *   doc.field1 = "new-value";
 * });
 * ```
 *
 * @example Yjs usage
 * ```ts
 * // Open a document (Yjs-based collabswarm instance).
 * const doc2 = collabswarmYjs.doc("/my-doc2-path");
 * if (!doc2) throw new Error("Failed to create document reference");
 * await doc2.open();
 *
 * await doc2.change(doc => {
 *   doc.getMap('data').set('field1', 'new-value');
 * });
 * ```
 * @typeParam DocType The CRDT document type
 * @typeParam ChangesType A block of CRDT change(s)
 * @typeParam ChangeFnType A function for applying changes to a document
 * @typeParam PrivateKey The type of secret key used to identify a user (for writing)
 * @typeParam PublicKey The type of key used to identify a user publicly
 * @typeParam DocumentKey The type of key used to encrypt/decrypt document changes
 */
export class CollabswarmDocument<
  DocType,
  ChangesType,
  ChangeFnType,
  PrivateKey,
  PublicKey,
  DocumentKey,
> {
  /**
   * CORE STATE ===============================================================
   */

  // Only store/cache the full automerge document.
  private _document: DocType;
  get document(): DocType {
    return this._document;
  }

  // Document readers ACL.
  private _readers;

  // Document writers ACL.
  private _writers;

  // Cached snapshot of `_writers.users()` for hot-path signature verification.
  // Document-scoped (not per-DAG-node): every signature check needs the current
  // trusted writer set, so a single lazy cache is sufficient. Invalidated by
  // bumping `_writerKeysVersion` whenever `_writers` is mutated via
  // `_mergeWriters` / `_addWriter` / `_removeWriter`. All ACL mutations must
  // go through those helpers. The version counter is what makes invalidation
  // race-safe: `_getWriterKeys` captures the version before awaiting and only
  // commits the result if the version is still current, so an in-flight fetch
  // that races with an invalidation cannot overwrite the new null state with
  // a stale list (which could otherwise admit signatures from a revoked writer).
  // Typed `ReadonlyArray` so an accidental mutation by an internal caller is
  // a type error rather than a silent cache corruption that would affect
  // later signature verification.
  private _cachedWriterKeys: ReadonlyArray<PublicKey> | null = null;
  private _writerKeysVersion = 0;
  // Counter of in-flight `_writers` mutations (add/remove/merge). Some ACL
  // implementations (e.g. UCANACL.remove, YjsACL.remove) mutate their
  // backing state *before* their returned Promise resolves, so during the
  // mutation window `_writers.users()` may already reflect the new state
  // even though the helper has not yet reached its post-await invalidation
  // line. While this counter is nonzero, `_getWriterKeys` bypasses the
  // cache entirely and always re-fetches, so a signature check that races
  // a mutation cannot observe the stale pre-mutation list.
  private _writerMutationsInFlight = 0;

  // List of document encryption keys. Lower index numbers mean more recent.
  // Since the document is created from change history, all keys are needed.
  private _keychain;

  // Controls what historical data new members receive when joining.
  private _historyVisibility: HistoryVisibility = 'current_only';

  // Tracks the epoch at which this node was invited to the document.
  // Used by `since_invited` history visibility (`_keychainChangesForVisibility`)
  // to filter keychain history. Set by `handleBeeKEMWelcomeRequestData` when
  // this node receives a Welcome message from an inviting writer; remains
  // `undefined` for the founding member of a document (who has no
  // invitation epoch).
  private _invitationEpoch: Uint8Array | undefined;

  // Pending BeeKEM Welcomes parked while the recipient is not yet a reader.
  //
  // KNOWN RACE: the inviter publishes
  // the readers-ACL update over pubsub and sends the Welcome over a
  // direct libp2p stream. The Welcome can arrive before the ACL update
  // has been applied on the recipient; without buffering, the
  // `not-in-readers-acl` gate in `evaluateBeeKEMWelcome` would drop the
  // Welcome permanently because `_sendBeeKEMWelcome` is fire-and-forget
  // (no retry / no ack). Buffering closes the race: when a Welcome is
  // dropped solely because the local user is not yet a reader, we park
  // it here keyed by hex(welcomeEpochId), and re-evaluate buffered
  // Welcomes after every readers-ACL `merge` (`_drainPendingWelcomes`).
  //
  // Bounding:
  //  - `_PENDING_WELCOMES_MAX_ENTRIES` (16): caps memory usage so a
  //    flood of misaddressed or hostile Welcomes cannot grow the buffer
  //    without bound. Older entries are evicted in insertion order
  //    (Map iteration order) when the bound is reached.
  //  - `_PENDING_WELCOMES_TTL_MS` (5 min): caps how long any Welcome
  //    sits unresolved. Entries past their TTL are discarded on the
  //    next drain attempt. Five minutes is well above the worst-case
  //    GossipSub mesh propagation we observe in `e2e/integration/`
  //    (~10s through a relay) while remaining short enough that stale
  //    Welcomes don't linger indefinitely after a legitimate
  //    re-invite.
  //
  // The key is the lower-case hex encoding of `welcomeEpochId` (a
  // `Uint8Array`), chosen so the buffer's identity matches the
  // canonical epoch identifier used elsewhere in the receive path and
  // so duplicate Welcomes (same epoch) coalesce automatically.
  private _pendingWelcomes = new Map<
    string,
    { message: CRDTSyncMessage<ChangesType, PublicKey>; bufferedAtMs: number }
  >();
  private static readonly _PENDING_WELCOMES_MAX_ENTRIES = 16;
  private static readonly _PENDING_WELCOMES_TTL_MS = 5 * 60 * 1000;

  // Recipient-side ECIES (P-256 ECDH) key pair for opening BeeKEM Welcome
  // sealed payloads. The inviter sends `eciesSealed` -- the keychain delta
  // encrypted to this public key (see `_sendBeeKEMWelcome`); the recipient
  // opens it with the matching private key (see
  // `_evaluateAndApplyBeeKEMWelcome`). When `undefined`, sealed Welcomes
  // addressed to us cannot be opened and are dropped (the recipient must
  // fall back to a fresh document load against an authorized peer). The
  // application is responsible for plumbing in a stable KEM key pair via
  // `setKemKeyPair` and sharing the matching raw public key with inviters
  // out-of-band so they can pass it to `addReader`.
  private _kemKeyPair: CryptoKeyPair | undefined;

  // Cached raw SEC1-uncompressed bytes for `_kemKeyPair.publicKey`,
  // populated eagerly inside `setKemKeyPair` so the receive path
  // (`_evaluateAndApplyBeeKEMWelcome`) never has to await an `exportKey`
  // call -- and so a non-exportable public key surfaces as a clear
  // error at installation time rather than as a generic WebCrypto
  // exception inside the Welcome handler.
  private _kemPublicKeyRaw: Uint8Array | undefined;

  /**
   * Install the recipient-side ECDH (P-256) key pair used to open
   * incoming BeeKEM Welcome sealed payloads. The application is
   * responsible for persisting and re-supplying this key pair across
   * sessions; the matching raw public key (see
   * `getKemPublicKeyRaw`) must be communicated out-of-band to any
   * writer who will invite this user, so they can pass it to
   * `addReader(reader, readerKemPublicKey)`.
   *
   * Idempotent: calling with the same key pair more than once is
   * fine. Pass `undefined` to clear (subsequent Welcomes will be
   * dropped).
   *
   * Validation: the key pair MUST be an ECDH P-256 pair, and the
   * private key MUST have `'deriveBits'` in its key usages so
   * `eciesOpen` can perform the ECDH step. The public key MUST be
   * raw-exportable (the inviter-side flow ships those bytes as the
   * `welcomeRecipientKemPublicKey` field). Mismatches are rejected
   * here with a descriptive error rather than silently accepted and
   * surfaced as a generic WebCrypto failure later in the Welcome
   * receive path.
   *
   * Async because the public key is eagerly exported to raw bytes and
   * cached for the receive path; callers that previously invoked this
   * synchronously must now `await` it.
   */
  public async setKemKeyPair(
    keyPair: CryptoKeyPair | undefined,
  ): Promise<void> {
    if (keyPair === undefined) {
      this._kemKeyPair = undefined;
      this._kemPublicKeyRaw = undefined;
      return;
    }

    // Algorithm/curve/usages validation + eager raw-export, kept in
    // a standalone helper so the validation surface can be unit-tested
    // without standing up the full document dependency graph.
    // Throws a clear, install-time error on misconfiguration.
    const rawPublic = await validateAndExportKemKeyPair(keyPair);

    this._kemKeyPair = keyPair;
    // Defensive copy: ensure the cached bytes are isolated from the
    // buffer returned by the helper so callers (and the helper's own
    // internal state) cannot mutate `_kemPublicKeyRaw` after the fact.
    this._kemPublicKeyRaw = new Uint8Array(rawPublic);
  }

  /**
   * Returns the raw SEC1-uncompressed bytes (65 bytes) of the
   * installed ECDH public key, or `undefined` if no key pair has been
   * set via `setKemKeyPair`. The bytes are what inviters pass to
   * `addReader(reader, readerKemPublicKey)`.
   *
   * Cheap: the raw bytes are cached on `setKemKeyPair`; this just
   * returns a defensive copy of the cached `Uint8Array` so callers
   * cannot accidentally mutate the document's internal state (e.g.
   * `raw[0] = ...`), which would otherwise cause hard-to-debug
   * Welcome drops/mismatches on the receive path. The method is still
   * async to preserve the previous contract.
   */
  public async getKemPublicKeyRaw(): Promise<Uint8Array | undefined> {
    return this._kemPublicKeyRaw && new Uint8Array(this._kemPublicKeyRaw);
  }

  /**
   * Set the history visibility for this document.
   * Controls what data new members receive when they join.
   */
  public set historyVisibility(value: HistoryVisibility) {
    this._historyVisibility = value;
  }

  public get historyVisibility(): HistoryVisibility {
    return this._historyVisibility;
  }

  /**
   * /CORE STATE ==============================================================
   */

  // Last sync message (for populating load requests).
  private _lastSyncMessage?: CRDTSyncMessage<ChangesType, PublicKey>;

  // Set of already-merged change blocks.
  private _hashes = new Set<string>();

  // Bounded list of recently-known change CIDs paired with their node kind.
  // Used by `_makeChange()` to attach Merkle-CRDT cross-links (paper §VI.B.e)
  // in addition to the primary parent link. Cross-links improve consistency
  // and availability when peers have partial views of the DAG: a peer that
  // missed an earlier message can still discover and fetch the corresponding
  // block via a later change that references it.
  //
  // Populated by both local changes (in `_makeChange`) and remote-applied
  // changes (in `_syncDocumentChanges`), since cross-linking to a freshly-
  // received remote tip helps third peers that haven't yet received it.
  //
  // Kept small (`MAX_RECENT_TIPS`) to bound per-message overhead. Insertion-
  // ordered so the oldest entry is at index 0 and the newest at the end;
  // eviction uses `Array.prototype.shift()` (O(n) on n=`MAX_RECENT_TIPS`,
  // which is a small constant -- effectively O(1) in practice).
  private _recentTips: RecentTip[] = [];

  // Compaction state.
  private _compactionConfig: CompactionConfig;
  private _latestSnapshot?: CRDTSnapshotNode<ChangesType, PublicKey>;
  private _changesSinceSnapshot = 0;
  private _compactionInProgress = false;
  private _snapshotUnsupported = false;
  // Counts only document-kind changes (excludes ACL reader/writer changes).
  // Used by _maybeCompact() for the minChangesBeforeSnapshot threshold.
  // Incremented for both local changes (in _makeChange) and remote changes
  // (in _syncDocumentChanges). Compaction triggers from both paths, so relay-only
  // nodes that never make local changes will still compact via remote change processing.
  private _documentChangeCount = 0;

  // Handler for listening for sync messages on the document topic. Is `undefined` until
  // the document is `.open()`-ed.
  private _pubsubHandler: EventHandler<CustomEvent<Message>> | undefined;

  // Whether this instance has successfully subscribed to the pubsub topic.
  // Used in close() to avoid unsubscribing when open() failed before subscribing,
  // which would break other instances listening on the same topic.
  private _subscribed = false;

  // Cached pubsub topic string. Initialized in constructor via _computeTopic()
  // so that callers that invoke _makeChange() before open() (e.g. via load())
  // publish to a valid topic. open() recomputes this with the configured prefix.
  private _topic: string;

  // Transaction state for batching multiple changes atomically.
  private _pendingChangeFns: ChangeFnType[] = [];
  private _inTransaction = false;
  private _committing = false;

  // Handlers registered by users of `CollabswarmDocument` that fire on remote changes.
  private _remoteHandlers: {
    [id: string]: CollabswarmDocumentChangeHandler<DocType, PublicKey>;
  } = {};

  // Handlers registered by users of `CollabswarmDocument` that fire on local changes.
  private _localHandlers: {
    [id: string]: CollabswarmDocumentChangeHandler<DocType, PublicKey>;
  } = {};

  public get libp2p(): Libp2p {
    return this.swarm.heliaNode.libp2p;
  }

  private heliaFs: UnixFS;

  constructor(
    /**
     * Collabswarm swarm that this document belongs to.
     */
    public readonly swarm: Collabswarm<
      DocType,
      ChangesType,
      ChangeFnType,
      PrivateKey,
      PublicKey,
      DocumentKey
    >,

    /**
     * Path of the document.
     */
    public readonly documentPath: string,

    /**
     * Private key identifying the current user.
     */
    private readonly _userKey: PrivateKey,

    /**
     * Private key identifying the current user.
     */
    private readonly _userPublicKey: PublicKey,

    /**
     * CRDTProvider handles reading/writing CRDT document data and metadata.
     */
    private readonly _crdtProvider: CRDTProvider<
      DocType,
      ChangesType,
      ChangeFnType
    >,

    /**
     * AuthProvider handles signing/verification and encryption/decryption.
     */
    private readonly _authProvider: AuthProvider<
      PrivateKey,
      PublicKey,
      DocumentKey
    >,

    /**
     * ACLProvider handles read/write ACL operations.
     */
    private readonly _aclProvider: ACLProvider<ChangesType, PublicKey>,

    /**
     * KeychainProvider handles read/write ACL operations.
     */
    private readonly _keychainProvider: KeychainProvider<
      ChangesType,
      DocumentKey
    >,

    /**
     * ChangesSerializer is responsible for serializing/deserializing CRDTChangeBlocks.
     */
    private readonly _changesSerializer: ChangesSerializer<ChangesType>,

    /**
     * SyncMessageSerializer is responsible for serializing/deserializing CRDTSyncMessages.
     */
    private readonly _syncMessageSerializer: SyncMessageSerializer<ChangesType, PublicKey>,

    /**
     * LoadMessageSerializer is responsible for serializing/deserializing CRDTLoadMessages.
     */
    private readonly _loadMessageSerializer: LoadMessageSerializer,
  ) {
    this.heliaFs = unixfs(this.swarm.heliaNode);

    this._document = this._crdtProvider.newDocument();
    this._readers = this._aclProvider.initialize();
    this._writers = this._aclProvider.initialize();
    this._keychain = this._keychainProvider.initialize();
    this._compactionConfig = {
      ...defaultCompactionConfig,
      ...(this.swarm.config?.compaction ?? {}),
    };

    // Provide a valid default topic so that _makeChange() works even before
    // open() is called (e.g. when load() triggers a change). open() will
    // recompute this with the configured prefix.
    this._topic = this._computeTopic();
  }

  // Helpers ------------------------------------------------------------------

  /**
   * Computes the pubsub topic for this document by applying the configured
   * prefix to the document path. Called once in open() to populate the
   * cached _topic field.
   */
  private _computeTopic(): string {
    const prefix = this.swarm.config?.pubsubDocumentPrefix;
    return prefix !== undefined
      ? documentTopic(this.documentPath, prefix)
      : documentTopic(this.documentPath);
  }

  private async _shuffledPeers() {
    const peers = this.swarm.heliaNode.libp2p
      .getConnections()
      ?.map((x) => x.remoteAddr);
    if (peers.length === 0) {
      return peers;
    }

    // Shuffle peer array.
    const shuffledPeers = [...peers];
    shuffleArray(shuffledPeers);
    return shuffledPeers;
  }

  private async _decryptBlock(
    blockKeyID: Uint8Array,
    nonce: Uint8Array,
    data: Uint8Array,
  ) {
    try {
      const key = this._keychain.getKey(blockKeyID);
      if (key) {
        return this._authProvider.decrypt(data, key, nonce);
      } else {
        console.warn(
          `Failed to find document key!`,
          uuid.stringify(blockKeyID),
          this._keychain,
        );
      }
    } catch (e) {
      console.warn(`Failed to decrypt block!`, e);
    }
  }

  private async _getBlock(hash: CID): Promise<ChangesType> {
    // Helia v6 / interface-blockstore v6 changed `Blockstore#get(cid)` to
    // return an `AwaitGenerator<Uint8Array>` (a generator of byte chunks)
    // rather than a single `Uint8Array`. Consume the generator into a
    // contiguous buffer here before slicing the encryption header off.
    const block = await readUint8Iterable(this.swarm.heliaNode.blockstore.get(hash));
    const blockKeyID = block.slice(0, this._keychainProvider.keyIDLength);
    const blockNonce = block.slice(
      this._keychainProvider.keyIDLength,
      this._keychainProvider.keyIDLength + this._authProvider.nonceBits,
    );
    const blockData = block.slice(
      this._keychainProvider.keyIDLength + this._authProvider.nonceBits,
    );
    const content = await this._decryptBlock(blockKeyID, blockNonce, blockData);
    if (!content) {
      throw new Error(`Failed to decrypt block (CID: ${hash})`);
    }
    return this._changesSerializer.deserializeChanges(content);
  }

  private async _putBlock(block: ChangesType): Promise<string> {
    const [documentKeyID, documentKey] = await this._keychain.current();
    if (!documentKey) {
      throw new Error(`Document ${this.documentPath} has an empty keychain!`);
    }
    const content = this._changesSerializer.serializeChanges(block);
    const { nonce, data } = await this._authProvider.encrypt(
      content,
      documentKey,
    );
    if (!nonce) {
      throw new Error(`Failed to encrypt change block! Nonce cannot be empty`);
    }
    const blockData = concatUint8Arrays(documentKeyID, nonce, data);
    const newFileResult = await this.heliaFs.addBytes(blockData);
    return newFileResult.toString();
  }

  /**
   * Walk the remote sync tree and return entries that are new relative to
   * `localHashes` / `localRootId`. Delegates to the pure `mergeRemoteSyncTree`
   * helper, which also performs per-message dedup so a cross-link CID that
   * coincides with an inline ancestor in the same sync tree is not applied
   * (or fetched + applied) twice -- see paper §VI.B.e.
   */
  private async _mergeSyncTree(
    remoteRootId: string | undefined,
    remoteRoot: CRDTChangeNode<ChangesType>,

    localRootId: string | undefined,
    localHashes: Set<string>,
  ): Promise<[string, CRDTChangeNodeKind, ChangesType | undefined][]> {
    return mergeRemoteSyncTree<ChangesType>(
      remoteRootId,
      remoteRoot,
      localRootId,
      localHashes,
    );
  }

  private async _fireRemoteUpdateHandlers(hashes: string[]) {
    for (const handler of Object.values(this._remoteHandlers)) {
      handler(
        this.document,
        await this.getReaders(),
        await this.getWriters(),
        hashes,
      );
    }
  }
  private async _fireLocalUpdateHandlers(hashes: string[]) {
    for (const handler of Object.values(this._localHandlers)) {
      handler(
        this.document,
        await this.getReaders(),
        await this.getWriters(),
        hashes,
      );
    }
  }

  private _createSyncMessage(): CRDTSyncMessage<ChangesType, PublicKey> {
    const message: CRDTSyncMessage<ChangesType, PublicKey> = {
      ...(this._lastSyncMessage || {
        documentId: this.documentPath,
      }),
    };
    return message;
  }

  /**
   * Record a CID as a recently-known tip for Merkle-CRDT cross-linking
   * (paper §VI.B.e). Called for both locally-generated and remote-applied
   * change nodes -- a peer A that just received B's change can cross-link
   * to it on A's next outgoing change, helping a third peer C that missed
   * B's broadcast discover the missing block. Cross-links to deferred CIDs
   * are emitted as leaf nodes with only `kind` set; the receiver fetches
   * the block from Helia when needed (see `_syncDocumentChanges`).
   *
   * Bounded to `MAX_RECENT_TIPS` entries (oldest evicted). If the CID is
   * already tracked, move it to the back so it remains a high-priority
   * cross-link candidate.
   */
  private _trackTip(cid: string, kind: CRDTChangeNodeKind): void {
    trackTipInList(this._recentTips, { cid, kind }, MAX_RECENT_TIPS);
  }

  private async _syncDocumentChanges(
    changeId: string | undefined,
    changes: CRDTChangeNode<ChangesType>,
  ) {
    // Only process hashes that we haven't seen yet.
    const newChangeEntries = await this._mergeSyncTree(
      changeId,
      changes,
      this._lastSyncMessage && this._lastSyncMessage.changeId,
      this._hashes,
    );

    // First apply changes that were sent directly.
    let newDocument = this.document;
    const newDocumentHashes: string[] = [];
    const newDocumentTips: Array<[string, CRDTChangeNodeKind]> = [];
    const missingDocumentHashes: [string, CRDTChangeNodeKind][] = [];
    for (const [sentHash, sentChangeKind, sentChanges] of newChangeEntries) {
      if (sentChanges) {
        switch (sentChangeKind) {
          case crdtDocumentChangeNode: {
            // Apply the changes that were sent directly.
            newDocument = this._crdtProvider.remoteChange(
              newDocument,
              sentChanges,
            );
            newDocumentHashes.push(sentHash);
            newDocumentTips.push([sentHash, sentChangeKind]);
            this._documentChangeCount++;
            this._changesSinceSnapshot++;
            break;
          }
          case crdtReaderChangeNode: {
            // Apply the changes that were sent directly. Use the
            // `_mergeReaders` wrapper so pending BeeKEM Welcomes are
            // drained immediately after the ACL update lands.
            this._mergeReaders(sentChanges);
            newDocumentHashes.push(sentHash);
            newDocumentTips.push([sentHash, sentChangeKind]);
            break;
          }
          case crdtWriterChangeNode: {
            // Apply the changes that were sent directly.
            this._mergeWriters(sentChanges);
            newDocumentHashes.push(sentHash);
            newDocumentTips.push([sentHash, sentChangeKind]);
            break;
          }
        }
      } else {
        missingDocumentHashes.push([sentHash, sentChangeKind]);
      }
    }
    if (newDocumentHashes.length) {
      this._document = newDocument;
      for (const newHash of newDocumentHashes) {
        this._hashes.add(newHash);
      }
      // Track applied tips for Merkle-CRDT cross-linking (paper §VI.B.e)
      // *before* firing remote update handlers. Recording remote-applied
      // CIDs lets this peer cross-link to them on its next outgoing change,
      // helping other peers that may have missed the original broadcast.
      // The ordering matters: if a handler synchronously triggers a local
      // `change()`, `_makeChange()` must see the just-received remote tips
      // in `_recentTips` to cross-link to them. This matches the ordering
      // used in the missing-block fetch path below.
      //
      // `newDocumentTips` is populated in `mergeRemoteSyncTree`'s traversal
      // order, which is root-first (the remote head is the first entry, its
      // ancestors follow). `_trackTip` appends to the back of `_recentTips`
      // with LRU semantics, so pushing in root-first order would make the
      // head the *oldest* entry -- and when more than MAX_RECENT_TIPS new
      // entries arrive in one sync, the head would be evicted first. Walk
      // in reverse so the remote head ends up at the back (most-recent),
      // matching the intent of LRU tracking.
      for (let i = newDocumentTips.length - 1; i >= 0; i--) {
        const [cid, kind] = newDocumentTips[i]!;
        this._trackTip(cid, kind);
      }
      await this._fireRemoteUpdateHandlers(newDocumentHashes);
    }

    // Then apply missing hashes by fetching them from the blockstore.
    // Track all fetch promises so we can compact only after all complete,
    // avoiding premature snapshots of incomplete state.
    const fetchPromises: Promise<void>[] = [];
    for (const [missingHash, missingHashKind] of missingDocumentHashes) {
      const cid = CID.parse(missingHash);
      fetchPromises.push(
        this._getBlock(cid)
          .then(async (missingChanges) => {
            if (missingChanges) {
              switch (missingHashKind) {
                case crdtDocumentChangeNode: {
                  this._document = this._crdtProvider.remoteChange(
                    this._document,
                    missingChanges,
                  );
                  this._hashes.add(missingHash);
                  this._documentChangeCount++;
                  this._changesSinceSnapshot++;
                  this._trackTip(missingHash, missingHashKind);
                  await this._fireRemoteUpdateHandlers([missingHash]);
                  return;
                }
                case crdtReaderChangeNode: {
                  // Go through `_mergeReaders` to drain any pending
                  // BeeKEM Welcomes parked while waiting for this ACL
                  // update.
                  this._mergeReaders(missingChanges);
                  this._hashes.add(missingHash);
                  this._trackTip(missingHash, missingHashKind);
                  await this._fireRemoteUpdateHandlers([missingHash]);
                  return;
                }
                case crdtWriterChangeNode: {
                  this._mergeWriters(missingChanges);
                  this._hashes.add(missingHash);
                  this._trackTip(missingHash, missingHashKind);
                  await this._fireRemoteUpdateHandlers([missingHash]);
                  return;
                }
              }
            } else {
              console.error(
                `Block '${missingHash}' returned nothing`,
                missingChanges,
              );
            }
          })
          .catch((err) => {
            console.error(
              'Failed to fetch missing change from blockstore:',
              missingHash,
              err,
            );
          }),
      );
    }

    // Wait for all missing block fetches to complete before checking compaction.
    // This ensures the snapshot reflects the full document state rather than
    // a partial view from incomplete fetches.
    if (fetchPromises.length > 0) {
      await Promise.all(fetchPromises);
    }
    await this._maybeCompact();
  }

  /**
   * Walk the change tree and apply only ACL (reader/writer) nodes.
   * This is a lightweight pre-pass used before snapshot verification to
   * ensure writer keys are populated without applying document changes.
   * ACL merges are idempotent, so re-applying them in the subsequent
   * full _syncDocumentChanges() call is safe.
   */
  private _applyACLFromTree(node: CRDTChangeNode<ChangesType>) {
    if (node.change) {
      if (node.kind === crdtWriterChangeNode) {
        this._mergeWriters(node.change);
      } else if (node.kind === crdtReaderChangeNode) {
        this._mergeReaders(node.change);
      }
    }
    if (node.children !== undefined && node.children !== crdtChangeNodeDeferred) {
      for (const child of Object.values(node.children)) {
        this._applyACLFromTree(child);
      }
    }
  }

  /**
   * Sanctioned wrapper around `_readers.merge` that also drains any
   * pending BeeKEM Welcomes parked by `handleBeeKEMWelcomeRequestData`
   * because the local user was not yet a reader. Centralizing the
   * post-merge drain here closes the readers-ACL / Welcome reordering
   * race regardless of which code path applied the ACL change.
   *
   * All ACL-merge call sites for the readers ACL must go through this
   * helper -- a bare `_readers.merge(...)` would silently skip the
   * drain, leaving a Welcome parked until the next merge (or TTL
   * eviction) and re-introducing the readers-ACL / Welcome reordering
   * wedge that this buffering / drain pair is designed to close.
   *
   * Drain is fire-and-forget because it must not block the synchronous
   * ACL-merge call sites (`_syncDocumentChanges`, `_applyACLFromTree`)
   * on async keychain/signature work. Errors during drain are caught
   * and logged so a bug in one buffered Welcome cannot starve the
   * receive path.
   *
   * @internal
   */
  private _mergeReaders(changes: ChangesType): void {
    this._readers.merge(changes);
    if (this._pendingWelcomes.size > 0) {
      void this._drainPendingWelcomes().catch((err) => {
        console.error(
          `Failed to drain pending BeeKEM Welcomes for ${this.documentPath}:`,
          err,
        );
      });
    }
  }

  /**
   * Whether application-level signing is enabled for this document's swarm.
   * Centralizes the `enableSigning` config check to avoid drift across many call sites.
   */
  private _isSigningEnabled(): boolean {
    return this.swarm.config?.enableSigning !== false;
  }

  /**
   * Returns the current list of authorized writer public keys, populating
   * the document-scoped cache on miss. Callers must not mutate the result.
   * The cache is invalidated by `_mergeWriters`, `_addWriter`, and
   * `_removeWriter` -- the only sanctioned mutation paths for `_writers`.
   *
   * Race-safety has two layers:
   *  - Mutation-in-flight bypass: while `_writerMutationsInFlight > 0`,
   *    skip the cache entirely. Some ACLs mutate their backing state
   *    before their `add`/`remove` Promise resolves, so the cached list
   *    can be stale even though the post-await invalidation has not yet
   *    run. Bypassing forces a fresh `users()` read each call until all
   *    mutations have finished and the cache is re-populated by a clean
   *    miss.
   *  - Version check on cache fill: capture `_writerKeysVersion` before
   *    awaiting. If the version advances mid-fetch, the fetched list
   *    reflects the *pre*-invalidation ACL and is unsafe to return --
   *    discard it and loop. The loop converges once a fetch completes
   *    with no intervening invalidation; under continuous invalidation
   *    it would spin, but invalidations are bounded (one per ACL
   *    mutation) and not adversarial.
   */
  private async _getWriterKeys(): Promise<ReadonlyArray<PublicKey>> {
    while (true) {
      if (
        this._writerMutationsInFlight === 0 &&
        this._cachedWriterKeys !== null
      ) {
        return this._cachedWriterKeys;
      }
      const versionAtStart = this._writerKeysVersion;
      const fetched = await this._writers.users();
      // Only commit to the cache if (a) the version is still current AND
      // (b) no mutations are in flight. Either condition means the fetch
      // could be racing a still-incomplete mutation; in that case return
      // the freshly fetched list to the caller but leave the cache null
      // so the next caller re-fetches.
      if (
        this._writerKeysVersion === versionAtStart &&
        this._writerMutationsInFlight === 0
      ) {
        this._cachedWriterKeys = fetched;
        return fetched;
      }
      if (this._writerKeysVersion !== versionAtStart) {
        // Version advanced during fetch -- the fetched list reflects the
        // pre-invalidation ACL. Discard it and retry with the post-
        // invalidation state to avoid handing a stale list to signature
        // verification.
        continue;
      }
      // Mutation still in flight but version unchanged: the fetched list
      // reflects whatever the ACL exposed at this moment, which is the
      // best the caller can get. Don't cache (so subsequent reads see
      // the post-mutation state once it lands), but return the value.
      return fetched;
    }
  }

  /** Bump the writer-keys version so any in-flight `_getWriterKeys` aborts
   *  its assignment, and clear the cache for the next caller. */
  private _invalidateWriterKeyCache(): void {
    this._cachedWriterKeys = null;
    this._writerKeysVersion++;
  }

  /**
   * Run a writer-ACL mutation under a guard that closes the gap between
   * "underlying ACL state has changed" and "_getWriterKeys reflects the
   * change." We invalidate the cache *before* the mutation (so any
   * concurrent `_getWriterKeys` re-fetches against whatever state the
   * ACL exposes at that moment) AND set a mutation-in-flight flag that
   * forces `_getWriterKeys` to bypass the cache entirely while the
   * mutation runs. Both bookkeeping operations live in the prelude/
   * finally so they cannot drift out of sync with the underlying call.
   */
  private async _runWriterMutation<T>(op: () => Promise<T> | T): Promise<T> {
    this._writerMutationsInFlight++;
    this._invalidateWriterKeyCache();
    try {
      return await op();
    } finally {
      this._writerMutationsInFlight--;
      // Invalidate again post-mutation: the underlying ACL is now
      // authoritative and any value that landed in the cache during the
      // window must be discarded. Idempotent and cheap.
      this._invalidateWriterKeyCache();
    }
  }

  /** Apply a writer ACL change and invalidate the cached key list. */
  private _mergeWriters(changes: ChangesType): void {
    // Synchronous mutation: increment-mutate-decrement around the
    // `merge()` call so any concurrent `_getWriterKeys` running on
    // another microtask sees the in-flight flag. Both invalidations
    // (pre and post) match the async helper's behavior.
    this._writerMutationsInFlight++;
    this._invalidateWriterKeyCache();
    try {
      this._writers.merge(changes);
    } finally {
      this._writerMutationsInFlight--;
      this._invalidateWriterKeyCache();
    }
  }

  /** Add a writer and invalidate the cached key list. */
  private async _addWriter(publicKey: PublicKey): Promise<ChangesType> {
    return this._runWriterMutation(() => this._writers.add(publicKey));
  }

  /** Remove a writer and invalidate the cached key list. */
  private async _removeWriter(publicKey: PublicKey): Promise<ChangesType> {
    return this._runWriterMutation(() => this._writers.remove(publicKey));
  }

  private async _verifyWriterSignature(raw: Uint8Array, signature: string) {
    if (!this._isSigningEnabled()) {
      return true;
    }

    const writerKeys = await this._getWriterKeys();
    // Short-circuit: with no writers, no signature can verify. Avoids the
    // base64 decode for an unverifiable input.
    if (writerKeys.length === 0) {
      return false;
    }
    // Malformed base64 throws inside js-base64. A bad signature must surface
    // as a verification failure, not an exception -- the topic validator path
    // turns thrown errors into Ignore (effectively dropping the message
    // silently), which is a DoS surface for malformed input. Treat decode
    // failure as `false`.
    let signatureBytes: Uint8Array;
    try {
      signatureBytes = this._deserializeSignature(signature);
    } catch {
      return false;
    }
    const verificationTasks: Promise<boolean>[] = [];
    for (const writerKey of writerKeys) {
      verificationTasks.push(
        this._authProvider.verify(raw, writerKey, signatureBytes),
      );
    }
    return firstTrue(verificationTasks);
  }

  /**
   * Verify a snapshot signature by trying all authorized writers.
   * Unlike sync message signatures (which are string-encoded), snapshot
   * signatures are raw Uint8Array. This avoids depending on the snapshot's
   * embedded publicKey field which may not survive serialization for all
   * key types (e.g. CryptoKey).
   */
  private async _verifySnapshotSignature(payload: Uint8Array, signature: Uint8Array) {
    if (!this._isSigningEnabled()) {
      return true;
    }

    const writerKeys = await this._getWriterKeys();
    const verificationTasks: Promise<boolean>[] = [];
    for (const writerKey of writerKeys) {
      verificationTasks.push(
        this._authProvider.verify(payload, writerKey, signature),
      );
    }
    return firstTrue(verificationTasks);
  }

  private async _signAsWriter(
    message: CRDTSyncMessage<ChangesType, PublicKey>,
  ): Promise<string> {
    if (!this._isSigningEnabled()) {
      return '';
    }

    return this._signAsWriterUnconditional(message);
  }

  /**
   * Sign a sync message as a writer **regardless of the swarm-wide
   * `enableSigning` config**. Used exclusively by paths that always
   * require writer-auth (currently BeeKEM Welcomes); see
   * `_signWelcomeAsWriter` below.
   *
   * SECURITY: callers that go through `_signAsWriter` should keep doing
   * so -- it preserves the existing `enableSigning` toggle for normal
   * sync-message signing. Only paths that have a documented "writer-auth
   * is mandatory" requirement should use the unconditional variant.
   */
  private async _signAsWriterUnconditional(
    message: CRDTSyncMessage<ChangesType, PublicKey>,
  ): Promise<string> {
    const { signature: oldSignature, ...messageWithoutSignature } = message;

    const raw = this._syncMessageSerializer.serializeSyncMessage(
      messageWithoutSignature,
    );
    const rawSignature = await this._authProvider.sign(raw, this._userKey);
    return this._serializeSignature(rawSignature);
  }

  /**
   * Sign a BeeKEM Welcome as a writer. Unlike `_signAsWriter`, this is
   * NOT gated on the swarm-wide `enableSigning` config: Welcomes are
   * always writer-authenticated, regardless of whether document-change
   * signing is enabled (see `beekem-welcome-handler.ts` for the receive
   * side and the SECURITY NOTE there for the threat model).
   */
  private async _signWelcomeAsWriter(
    message: CRDTSyncMessage<ChangesType, PublicKey>,
  ): Promise<string> {
    return this._signAsWriterUnconditional(message);
  }

  /**
   * Verify a writer signature on a BeeKEM Welcome. Unlike
   * `_verifyWriterSignature`, this is NOT gated on the swarm-wide
   * `enableSigning` config -- Welcomes are always writer-authenticated.
   */
  private async _verifyWelcomeWriterSignature(
    raw: Uint8Array,
    signature: string,
  ): Promise<boolean> {
    const writerKeys = await this._getWriterKeys();
    if (writerKeys.length === 0) {
      return false;
    }
    let signatureBytes: Uint8Array;
    try {
      signatureBytes = this._deserializeSignature(signature);
    } catch {
      return false;
    }
    const verificationTasks: Promise<boolean>[] = [];
    for (const writerKey of writerKeys) {
      verificationTasks.push(
        this._authProvider.verify(raw, writerKey, signatureBytes),
      );
    }
    return firstTrue(verificationTasks);
  }

  private _encoder = new TextEncoder();

  private _deserializeSignature(signature: string): Uint8Array {
    return Base64.toUint8Array(signature);
  }

  private _serializeSignature(signature: Uint8Array): string {
    return Base64.fromUint8Array(signature);
  }

  private async _makeChange(
    changes: ChangesType,
    kind: CRDTChangeNodeKind = crdtDocumentChangeNode,
  ) {
    // Store changes in blockstore.
    const hash = await this._putBlock(changes);
    this._hashes.add(hash);

    // Send new message.
    let updateMessage = this._createSyncMessage();
    const changeNode: CRDTChangeNode<ChangesType> = { kind, change: changes };
    const primaryParentId = updateMessage.changeId;
    if (primaryParentId && updateMessage.changes) {
      // Primary back-pointer: include the previous head's subtree inline so
      // peers can apply our change without an extra round-trip for the parent.
      changeNode.children = {};
      changeNode.children[primaryParentId] = updateMessage.changes;

      // Cross-links (Merkle CRDT paper §VI.B.e): additionally reference other
      // recent tips so a peer who missed an intermediate message can still
      // discover the missing CID via a later message. Cross-link entries
      // are emitted as *deferred* nodes (no `change` payload, no `children`)
      // -- they carry only the CID + kind. Receivers that don't already have
      // the block trigger a blockstore fetch in `_syncDocumentChanges`.
      // Receivers that already have the block treat the entry as a no-op
      // (deduplicated via `_hashes`).
      const crossLinkTips = selectCrossLinks(
        this._recentTips,
        primaryParentId,
        hash,
        MAX_CROSS_LINKS,
      );
      for (const tip of crossLinkTips) {
        // Skip if the tip is already a direct child of the new change node.
        if (changeNode.children[tip.cid]) continue;
        // Deferred leaf: no `change` payload, no `children`. Receivers fetch
        // the block from Helia if they don't already have it.
        changeNode.children[tip.cid] = { kind: tip.kind };
      }
    }
    updateMessage.changeId = hash;
    updateMessage.changes = changeNode;

    // Track this new tip for future cross-linking. The primary parent is
    // also retained -- it's the immediate predecessor of *this* tip and may
    // still be useful as a cross-link target for the *next* change if a
    // later remote sync arrives in between.
    this._trackTip(hash, kind);

    // Sign new message.
    updateMessage.signature = await this._signAsWriter(updateMessage);

    this._lastSyncMessage = updateMessage;
    const serializedUpdate =
      this._syncMessageSerializer.serializeSyncMessage(updateMessage);

    // Encrypt sync message.
    const [documentKeyID, documentKey] = await this._keychain.current();
    if (!documentKey) {
      throw new Error(`Document ${this.documentPath} has an empty keychain!`);
    }
    const { nonce, data } = await this._authProvider.encrypt(
      serializedUpdate,
      documentKey,
    );
    if (!nonce) {
      throw new Error(`Failed to encrypt sync message! Nonce cannot be empty`);
    }
    await this.swarm.heliaNode.libp2p.services.pubsub.publish(
      this._topic,
      concatUint8Arrays(documentKeyID, nonce, data),
    );

    // Fire change handlers.
    await this._fireLocalUpdateHandlers([hash]);

    // Track document changes for compaction.
    if (kind === crdtDocumentChangeNode) {
      this._documentChangeCount++;
      this._changesSinceSnapshot++;
      await this._maybeCompact();
    }
  }

  /**
   * Returns the keychain changes to include in a load response based on
   * the document's history visibility setting.
   *
   * `since_invited` requires `_invitationEpoch` to be set (typically by the
   * BeeKEM Welcome flow when the local node joined). When it is unset --
   * e.g. for the original group creator that never received a Welcome --
   * the call falls back to `current_only` semantics rather than full
   * history. The intent of `since_invited` is to bound what *new joiners*
   * receive; emitting the full keychain whenever the local boundary is
   * unknown undermines that goal (and leaks every prior epoch to any
   * peer the local node responds to). Operators that genuinely want
   * founders to share full history should configure the document with
   * `historyVisibility: 'full_history'` explicitly.
   */
  private async _keychainChangesForVisibility(): Promise<ChangesType> {
    switch (this._historyVisibility) {
      case 'full_history':
        // Send ALL epoch keys -- for audit trails and regulatory compliance.
        return this._keychain.history();
      case 'since_invited':
        if (this._invitationEpoch === undefined) {
          // No recorded invitation epoch (founding member, or a node
          // that joined before Welcome wiring landed). Default to the
          // most-private interpretation -- the current key only -- so a
          // missing boundary cannot silently widen the disclosure
          // window. Future rotations propagate via key-update.
          return await this._keychain.currentKeyChange();
        }
        // `historySince` is optional on the Keychain interface for
        // backwards compatibility; fall back to full history when the
        // active provider has not implemented it (matches the
        // documented "boundary unknown" recovery path).
        return await keychainHistorySinceOrFull(this._keychain)(
          this._invitationEpoch,
        );
      case 'current_only':
      default:
        // Only send the current key -- most private option.
        return await this._keychain.currentKeyChange();
    }
  }

  /**
   * Returns the keychain changes to include in a BeeKEM Welcome to a
   * newly-added reader.
   *
   * The visibility computation here is from the **recipient's**
   * perspective, not the inviter's:
   *
   * - `current_only`: send only the current key. Identical to the load
   *   response path.
   * - `since_invited`: send only the current key. From the recipient's
   *   perspective, "since I was invited" is the current epoch
   *   (`welcomeEpochId`) onward, so the Welcome itself should carry
   *   exactly the current key (subsequent rotations arrive via the
   *   key-update protocol). Using `_keychainChangesForVisibility()` here
   *   would instead leak the *inviter's* post-invite slice (or, for
   *   founders, the full history), violating the recipient's intended
   *   join boundary.
   * - `full_history`: send the full keychain so the recipient can audit
   *   or replay all prior blocks (matches the inviter-side visibility
   *   semantics).
   */
  private async _keychainChangesForWelcome(): Promise<ChangesType> {
    switch (this._historyVisibility) {
      case 'full_history':
        return this._keychain.history();
      case 'since_invited':
      case 'current_only':
      default:
        return await this._keychain.currentKeyChange();
    }
  }

  /**
   * Check if automatic compaction should be triggered based on the config.
   */
  private async _maybeCompact() {
    if (!this._compactionConfig.enabled || this._snapshotUnsupported) {
      return;
    }

    // Prevent overlapping snapshot() calls from concurrent async paths.
    if (this._compactionInProgress) {
      return;
    }

    // Check cheap thresholds before the async writer ACL check to avoid
    // repeated crypto/ACL work on every change.
    if (this._documentChangeCount < this._compactionConfig.minChangesBeforeSnapshot) {
      return;
    }
    if (this._changesSinceSnapshot < this._compactionConfig.snapshotInterval) {
      return;
    }

    // Only writers can create snapshots; read-only peers must not attempt compaction.
    if (!(await this._writers.check(this._userPublicKey))) {
      return;
    }
    this._compactionInProgress = true;
    try {
      await this.snapshot();
    } finally {
      this._compactionInProgress = false;
    }
  }

  /**
   * Prune the change tree in the last sync message. After a BFS traversal
   * retains `keepCount` document nodes, remaining children are removed.
   * Note: in branching histories, nodes already enqueued in the BFS before
   * the limit is reached are also retained, so the actual count may exceed
   * `keepCount`.
   *
   * @param keepCount Maximum number of change nodes to retain in the sync tree.
   * @returns Set of CID strings for document nodes that were pruned from the tree.
   *   ACL node CIDs are never included (they are always preserved).
   */
  private _pruneChanges(keepCount: number): Set<string> {
    const prunedCIDs = new Set<string>();

    if (keepCount <= 0) {
      // Pruning everything (including root) is destructive and nonsensical; skip.
      return prunedCIDs;
    }
    if (!this._lastSyncMessage?.changes || !this._lastSyncMessage.changeId) {
      return prunedCIDs;
    }

    // Recursively collect all ACL nodes from a subtree that is about to be pruned.
    // Re-attached ACL nodes are stored as leaf nodes (children stripped) so they
    // don't keep nested children subtrees alive after pruning.
    // Non-ACL (document) node CIDs are added to the prunedCIDs set.
    const collectACLNodes = (
      children: Record<string, CRDTChangeNode<ChangesType>>,
      out: Record<string, CRDTChangeNode<ChangesType>>,
    ) => {
      for (const [childHash, childNode] of Object.entries(children)) {
        if (
          childNode.kind === crdtReaderChangeNode ||
          childNode.kind === crdtWriterChangeNode
        ) {
          // Shallow copy without children to avoid retaining the full subtree.
          const { children: _dropped, ...leafNode } = childNode;
          out[childHash] = leafNode as CRDTChangeNode<ChangesType>;
        } else {
          // Document node being pruned -- record its CID.
          prunedCIDs.add(childHash);
        }
        if (
          childNode.children !== undefined &&
          childNode.children !== crdtChangeNodeDeferred
        ) {
          collectACLNodes(childNode.children, out);
        }
      }
    };

    // BFS traversal to collect nodes up to the limit.
    // ACL nodes (reader/writer) are always preserved regardless of keepCount.
    //
    // When a document node at the boundary is pruned, ACL nodes from the
    // entire pruned subtree are collected and re-attached. This prevents
    // losing ACL state during pruning.
    //
    // For branching histories (DAG with multiple branches), keepCount is applied
    // globally across all branches. Once the limit is reached, all further
    // document nodes in any branch are pruned.
    const queue: Array<CRDTChangeNode<ChangesType>> = [
      this._lastSyncMessage.changes,
    ];
    let documentNodesVisited = 0;
    let qi = 0;

    while (qi < queue.length) {
      const current = queue[qi++]!;

      // ACL nodes are always kept -- never count them toward the limit.
      const isACLNode =
        current.kind === crdtReaderChangeNode ||
        current.kind === crdtWriterChangeNode;

      if (!isACLNode) {
        documentNodesVisited++;
      }

      if (
        current.children !== undefined &&
        current.children !== crdtChangeNodeDeferred
      ) {
        if (!isACLNode && documentNodesVisited >= keepCount) {
          // This document node is at the boundary -- prune its children,
          // but preserve any ACL nodes within the entire subtree.
          const preservedACL: Record<string, CRDTChangeNode<ChangesType>> = {};
          collectACLNodes(current.children, preservedACL);
          if (Object.keys(preservedACL).length > 0) {
            current.children = preservedACL;
          } else {
            delete current.children;
          }
        } else {
          for (const [, childNode] of Object.entries(current.children)) {
            queue.push(childNode);
          }
        }
      }
    }

    console.log(
      `Pruned change tree for ${this.documentPath}: kept ${documentNodesVisited} document nodes, pruned ${prunedCIDs.size} blocks`,
    );

    return prunedCIDs;
  }

  /**
   * Delete pruned blocks from the Helia blockstore. Unpins each block first
   * (if pinned), then deletes the raw block data. CIDs are intentionally
   * kept in `_hashes` so that `_mergeSyncTree()` still deduplicates if a
   * peer re-sends the same change block.
   *
   * Errors on individual blocks are logged but do not abort the overall GC pass.
   */
  private async _gcPrunedBlocks(prunedCIDs: Set<string>): Promise<void> {
    if (prunedCIDs.size === 0) {
      return;
    }

    const blockstore = this.swarm.heliaNode.blockstore;
    const pins = this.swarm.heliaNode.pins;
    let deleted = 0;

    for (const cidStr of prunedCIDs) {
      try {
        const cid = CID.parse(cidStr);

        // Unpin first -- pins.rm is an AsyncGenerator, drain it.
        try {
          for await (const _ of pins.rm(cid)) { /* drain */ }
        } catch (unpinErr) {
          const msg = String(unpinErr);
          if (!msg.includes('not pinned') && !msg.includes('is not pinned')) {
            throw unpinErr;
          }
          console.debug(`Unpin skipped for ${cidStr} (not pinned)`);
        }

        // Delete the raw block from the blockstore.
        // Note: we intentionally keep the CID in _hashes so that
        // _mergeSyncTree() still deduplicates if a peer re-sends
        // the same change block (e.g., a peer that hasn't compacted).
        await blockstore.delete(cid);
        deleted++;
      } catch (err) {
        console.error(`Failed to GC block ${cidStr}:`, err);
      }
    }

    console.log(
      `Blockstore GC for ${this.documentPath}: deleted ${deleted}/${prunedCIDs.size} blocks`,
    );
  }

  /**
   * Handles a doc-load request with pre-read stream data. Called by the
   * shared protocol handler in Collabswarm after reading and routing.
   *
   * @internal
   * @param message The deserialized load request (already parsed by the shared handler).
   * @param stream The stream object for sending the response.
   */
  public async handleLoadRequestData(
    message: CRDTLoadRequest,
    stream: { sink: (data: Iterable<Uint8Array>) => Promise<void> },
  ): Promise<void> {
    try {
      console.log(
        `received doc-load request for ${this.documentPath}:`,
        message,
      );

      if (message.documentId !== this.documentPath) {
        console.warn(
          `Received a load request for the wrong document (${message.documentId} !== ${this.documentPath})`,
        );
        await stream.sink([] as Iterable<Uint8Array>);
        return;
      }

      // Authorize the requestor. When signing is disabled, skip ACL/signature
      // checks entirely -- any peer is treated as authorized.
      let authorized = false;
      if (!this._isSigningEnabled()) {
        // Bypass: signing disabled, no signature verification needed.
        authorized = true;
      } else {
        if (!message.signature) {
          // Reject requests with missing/empty signatures (e.g. from peers
          // that have signing disabled -- they cannot interoperate).
          console.warn(
            `Rejected load request for ${message.documentId}: missing signature`,
          );
          await stream.sink([] as Iterable<Uint8Array>);
          return;
        }
        const readers = (
          await Promise.all([this._readers.users(), this._writers.users()])
        ).flat();
        for (const reader of readers) {
          if (
            await this._authProvider.verify(
              this._encoder.encode(message.documentId),
              reader,
              this._deserializeSignature(message.signature),
            )
          ) {
            authorized = true;
            break;
          }
        }
      }

      if (!authorized) {
        console.warn(
          `Detected an unauthorized load request for ${message.documentId}`,
        );
        await stream.sink([] as Iterable<Uint8Array>);
        return;
      }

      // Construct load response based on history visibility setting.
      const loadMessage = this._createSyncMessage();

      loadMessage.keychainChanges = await this._keychainChangesForVisibility();

      // Include the latest snapshot if available, to accelerate initial sync.
      if (this._latestSnapshot) {
        loadMessage.snapshot = this._latestSnapshot;
      }

      // Sign new message.
      loadMessage.signature = await this._signAsWriter(loadMessage);

      const serializedLoad =
        this._syncMessageSerializer.serializeSyncMessage(loadMessage);

      // Encrypt the load response so keychain is not sent in plaintext.
      // NOTE: This uses the current key, which works for existing peers requesting
      // a reload (they already have the key). For NEW members being onboarded for
      // the first time, the key must be delivered out-of-band via BeeKEM Welcome
      // message -- they cannot decrypt this load response without the key.
      const [documentKeyID, documentKey] = await this._keychain.current();
      if (!documentKey) {
        throw new Error(`Document ${this.documentPath} has an empty keychain!`);
      }
      const { nonce, data } = await this._authProvider.encrypt(
        serializedLoad,
        documentKey,
      );
      if (!nonce) {
        throw new Error(`Failed to encrypt sync message! Nonce cannot be empty`);
      }
      const assembled = concatUint8Arrays(documentKeyID, nonce, data);
      console.log(
        `sending doc-load response (encrypted) for ${this.documentPath}`,
      );

      await stream.sink([assembled] as Iterable<Uint8Array>);
    } catch (err: unknown) {
      console.error(`Error handling doc-load request for ${this.documentPath}:`, err);
      // Ensure the stream is closed so the requester doesn't hang.
      try { await stream.sink([] as Iterable<Uint8Array>); } catch { /* already closed */ }
    }
  }

  /**
   * Handles a snapshot-load request with pre-read stream data. Called by
   * the shared protocol handler in Collabswarm after reading and routing.
   *
   * @internal
   * @param message The deserialized load request (already parsed by the shared handler).
   * @param stream The stream object for sending the response.
   */
  public async handleSnapshotLoadRequestData(
    message: CRDTLoadRequest,
    stream: { sink: (data: Iterable<Uint8Array>) => Promise<void> },
  ): Promise<void> {
    try {
      console.log(
        `received snapshot-load request for ${this.documentPath}:`,
        message,
      );

      if (message.documentId !== this.documentPath) {
        console.warn(
          `Received a snapshot load request for the wrong document (${message.documentId} !== ${this.documentPath})`,
        );
        await stream.sink([] as Iterable<Uint8Array>);
        return;
      }

      // Authorize the requestor. When signing is disabled, skip ACL/signature
      // checks entirely -- any peer is treated as authorized.
      let authorized = false;
      if (!this._isSigningEnabled()) {
        // Bypass: signing disabled, no signature verification needed.
        authorized = true;
      } else {
        if (!message.signature) {
          // Reject requests with missing/empty signatures (e.g. from peers
          // that have signing disabled -- they cannot interoperate).
          console.warn(
            `Rejected snapshot load request for ${message.documentId}: missing signature`,
          );
          await stream.sink([] as Iterable<Uint8Array>);
          return;
        }
        const readers = (
          await Promise.all([this._readers.users(), this._writers.users()])
        ).flat();
        for (const reader of readers) {
          if (
            await this._authProvider.verify(
              this._encoder.encode(message.documentId),
              reader,
              this._deserializeSignature(message.signature),
            )
          ) {
            authorized = true;
            break;
          }
        }
      }

      if (!authorized) {
        console.warn(
          `Detected an unauthorized snapshot load request for ${message.documentId}`,
        );
        await stream.sink([] as Iterable<Uint8Array>);
        return;
      }

      if (!this._latestSnapshot) {
        // No snapshot available -- respond with empty payload so the peer
        // can fall back to the normal doc-load protocol.
        console.log(
          `No snapshot available for ${this.documentPath}, sending empty response`,
        );
        await stream.sink([] as Iterable<Uint8Array>);
        return;
      }

      // Build a complete sync message with the snapshot, post-snapshot
      // changes, and keychain so the peer can fully catch up.
      const snapshotMessage = this._createSyncMessage();
      snapshotMessage.snapshot = this._latestSnapshot;
      snapshotMessage.keychainChanges = await this._keychainChangesForVisibility();
      snapshotMessage.signature = await this._signAsWriter(snapshotMessage);

      const serialized =
        this._syncMessageSerializer.serializeSyncMessage(snapshotMessage);

      // Encrypt the response.
      const [documentKeyID, documentKey] = await this._keychain.current();
      if (!documentKey) {
        throw new Error(`Document ${this.documentPath} has an empty keychain!`);
      }
      const { nonce, data } = await this._authProvider.encrypt(
        serialized,
        documentKey,
      );
      if (!nonce) {
        throw new Error(`Failed to encrypt snapshot response! Nonce cannot be empty`);
      }
      const assembled = concatUint8Arrays(documentKeyID, nonce, data);
      console.log(
        `sending snapshot-load response (encrypted) for ${this.documentPath}`,
      );

      await stream.sink([assembled] as Iterable<Uint8Array>);
    } catch (err: unknown) {
      console.error(
        `Error handling snapshot-load request for ${this.documentPath}:`,
        err,
      );
      // Ensure the stream is closed so the requester doesn't hang.
      try { await stream.sink([] as Iterable<Uint8Array>); } catch { /* already closed */ }
    }
  }

  /**
   * Build the deterministic binary payload used for snapshot signing/verification.
   *
   * Binary layout (big-endian integers):
   *   [0]       uint8   version (1)
   *   [1..8]    uint64  timestamp
   *   [9..12]   uint32  compactedCount
   *   [13..16]  uint32  cidLen
   *   [17..]    bytes   UTF-8(lastChangeNodeCID)
   *   [..]      uint32  stateLen
   *   [..]      bytes   stateBytes
   */
  private _buildSnapshotSignPayload(
    stateBytes: Uint8Array,
    lastChangeNodeCID: string,
    timestamp: number,
    compactedCount: number,
  ): Uint8Array {
    // Validate inputs to prevent runtime errors (e.g. BigInt(NaN) throws TypeError)
    // and silent uint32 overflow/truncation via DataView.setUint32.
    if (!Number.isSafeInteger(timestamp) || timestamp < 0) {
      throw new Error(`Invalid snapshot timestamp: ${timestamp}`);
    }
    if (!Number.isInteger(compactedCount) || compactedCount < 0 || compactedCount > 0xFFFFFFFF) {
      throw new Error(`Invalid snapshot compactedCount: ${compactedCount}`);
    }
    const cidBytes = this._encoder.encode(lastChangeNodeCID);
    if (cidBytes.length > 0xFFFFFFFF) {
      throw new Error(`lastChangeNodeCID too large: ${cidBytes.length} bytes`);
    }
    if (stateBytes.length > 0xFFFFFFFF) {
      throw new Error(`Snapshot state too large: ${stateBytes.length} bytes`);
    }
    // 1 (version) + 8 (timestamp) + 4 (compactedCount) + 4 (cidLen) + cidBytes + 4 (stateLen) + stateBytes
    const totalLen = 1 + 8 + 4 + 4 + cidBytes.length + 4 + stateBytes.length;
    const buf = new ArrayBuffer(totalLen);
    const view = new DataView(buf);
    const out = new Uint8Array(buf);
    let offset = 0;

    // version
    view.setUint8(offset, 1);
    offset += 1;

    // timestamp as uint64
    view.setBigUint64(offset, BigInt(timestamp), false);
    offset += 8;

    // compactedCount as uint32
    view.setUint32(offset, compactedCount, false);
    offset += 4;

    // lastChangeNodeCID (length-prefixed)
    view.setUint32(offset, cidBytes.length, false);
    offset += 4;
    out.set(cidBytes, offset);
    offset += cidBytes.length;

    // stateBytes (length-prefixed)
    view.setUint32(offset, stateBytes.length, false);
    offset += 4;
    out.set(stateBytes, offset);

    return out;
  }

  private async _ensureCurrentUserCanWrite() {
    // Check that we are a writer (allowed to write to this document).
    if (!(await this._writers.check(this._userPublicKey))) {
      throw new Error(
        `Current user does not have write permissions for: ${this.documentPath}`,
      );
    }
  }

  /**
   * Send a load request over the given stream and apply the response.
   *
   * @returns `true` if a non-empty response was received and successfully synced.
   *   Returns `false` when:
   *   - The peer responded with an empty payload (e.g., peer has no snapshot).
   *   - The response payload is too short to contain a valid encrypted header.
   *   - The encryption keyID is not recognized (key not in our keychain).
   *   - The response documentId did not match the expected document.
   *   - Writer signature verification failed (when signing is enabled).
   *   - `sync()` rejected the response (e.g., invalid inner signatures or auth failure).
   *
   * @throws When `decrypt()` itself fails (i.e., the keyID was recognized but
   *   decryption produced no output), or on other unexpected protocol errors.
   *   Callers (e.g., `load()`) should wrap calls in a try/catch and handle both a
   *   `false` return value (by trying the next available peer) and thrown errors.
   */
  private async _sendLoadRequestAndSync(
    stream: { sink: (data: Iterable<Uint8Array>) => Promise<void>; source: AsyncIterable<Uint8ArrayList | Uint8Array> },
    serializedRequest: Uint8Array,
  ): Promise<boolean> {
    await pipe([serializedRequest], stream.sink);
    return await pipe(
      stream.source,
      async (source: AsyncIterable<Uint8ArrayList | Uint8Array>) => {
        const assembled = await readUint8Iterable(source);

        // Empty response means the peer couldn't serve this request.
        if (assembled.length === 0) {
          return false;
        }

        // Decrypt the response. Extract the keyID from the header and
        // look it up in the keychain. Responses shorter than the encryption
        // header are treated as malformed and rejected.
        const headerLength = this._keychainProvider.keyIDLength + this._authProvider.nonceBits;
        let rawContent: Uint8Array;
        if (assembled.length <= headerLength) {
          // Too short to contain a valid encrypted payload -- reject.
          console.warn(
            `Load response for ${this.documentPath}: payload too short (${assembled.length} <= ${headerLength}), skipping peer`,
          );
          return false;
        }

        const blockKeyID = assembled.slice(0, this._keychainProvider.keyIDLength);
        const key = this._keychain.getKey(blockKeyID);
        if (key) {
          const blockNonce = assembled.slice(this._keychainProvider.keyIDLength, headerLength);
          const blockData = assembled.slice(headerLength);
          const decrypted = await this._authProvider.decrypt(blockData, key, blockNonce);
          if (!decrypted) {
            throw new Error(
              `Failed to decrypt load response for ${this.documentPath}`,
            );
          }
          rawContent = decrypted;
        } else {
          // KeyID not recognized -- peer sent encrypted data with a key we
          // don't have. Fail and let the caller try the next peer.
          console.warn(
            `Load response for ${this.documentPath}: unrecognized keyID, skipping peer`,
          );
          return false;
        }

        const message = this._syncMessageSerializer.deserializeSyncMessage(rawContent);
        if (message.documentId !== this.documentPath) {
          console.warn(
            `Load response documentId mismatch: expected ${this.documentPath}, got ${message.documentId}`,
          );
          return false;
        }
        // Verify the outer message signature before applying changes.
        // On subsequent loads (writers already known), verify against the
        // existing trusted writer set BEFORE sync() mutates state. This
        // prevents a malicious peer from injecting ACL changes that add
        // its own key.
        // On first load (_writers is empty / bootstrapping), we cannot
        // verify -- trust relies on the encrypted channel (only peers
        // with the document key can decrypt the response).
        if (this._isSigningEnabled()) {
          const preLoadWriters = await this._getWriterKeys();
          if (preLoadWriters.length > 0) {
            if (!message.signature) {
              console.warn(
                `Load response for ${this.documentPath}: missing signature, skipping peer`,
              );
              return false;
            }
            const { signature, ...messageWithoutSignature } = message;
            const raw = this._syncMessageSerializer.serializeSyncMessage(
              messageWithoutSignature,
            );
            // Mirror `_verifyWriterSignature`: a malformed/non-string signature
            // can cause `js-base64` to throw. Treat decode failure as a
            // verification failure for this peer (skip and let the caller try
            // the next one) rather than letting the exception escape -- the
            // outer snapshot-load attempt swallows errors via a blanket
            // catch{}, which would hide the malformed input entirely.
            let signatureBytes: Uint8Array;
            try {
              signatureBytes = this._deserializeSignature(signature);
            } catch {
              console.warn(
                `Load response for ${this.documentPath}: malformed signature, skipping peer`,
              );
              return false;
            }
            const verifyTasks = preLoadWriters.map((writerKey) =>
              this._authProvider.verify(raw, writerKey, signatureBytes),
            );
            if (!(await firstTrue(verifyTasks))) {
              console.warn(
                `Load response for ${this.documentPath} failed writer signature verification, skipping peer`,
              );
              return false;
            }
          }
        }

        const syncResult = await this.sync(message, false);
        if (!syncResult) {
          console.warn(
            `sync rejected message during load for ${this.documentPath}`,
          );
          // Return false so the caller tries the next peer.
          return false;
        }
        return true;
      },
    );
  }

  // API Methods --------------------------------------------------------------

  // https://gist.github.com/alanshaw/591dc7dd54e4f99338a347ef568d6ee9#duplex-it
  /**
   * Load sends a new load request to any connected peer (each peer is tried one at a time). The expected
   * response from a load request is a sync message containing all document change hashes.
   *
   * Load is used to fetch any new changes that a connecting node is missing.
   *
   * @param preferredPeer Optional peer to try first (typically a PeerId from a
   *   pubsub message sender). Matched against peers by extracting the `/p2p/<id>`
   *   substring from each peer's `Multiaddr.toString()` (the canonical string
   *   form), since `@multiformats/multiaddr` v13 dropped the `getPeerId()`
   *   helper and `getComponents()` may surface the `/p2p` value as bytes.
   * @returns `true` if the document was successfully loaded from a peer.
   *   `false` if no peer could provide the document -- this is ambiguous: it
   *   may mean the document is brand new (no peers have it) OR that all peers
   *   failed to respond, failed to decrypt, or failed signature verification.
   *   Note: `open()` treats `false` as "new document" and initializes a fresh
   *   document with the current user as writer and a new encryption key.
   */
  // Key exchange happens during:
  // - Load messages.
  // - ACL updates via /collabswarm/key-update/1.0.0 protocol
  public async load(preferredPeer?: PeerId | string): Promise<boolean> {
    // Pick a peer. All peers come from getConnections() so they already have
    // open connections. libp2p v2's dialProtocol reuses existing connections
    // internally, so no additional connection management is needed here.
    const shuffledPeers = await this._shuffledPeers();
    if (shuffledPeers.length === 0) {
      return false;
    }

    const orderedPeers = [...shuffledPeers];

    // If a preferred peer is specified, move it to the front.
    // The peer list contains Multiaddrs while preferredPeer is typically a PeerId,
    // so we compare by extracting the PeerId component from each Multiaddr.
    if (preferredPeer) {
      const preferredId = preferredPeer.toString();
      const preferredIdx = orderedPeers.findIndex(p => {
        // Only compare against the PeerId component of the Multiaddr.
        // Falling back to a full-string equality check would compare against
        // the full multiaddr string (e.g. "/ip4/.../p2p/<id>") which will
        // never match a plain PeerId string.
        //
        // `@multiformats/multiaddr` v13 (bundled by libp2p v3) dropped the
        // `getPeerId()` helper. `getComponents()` exists, but its component
        // `value` field can be either a string or bytes depending on how the
        // multiaddr was parsed, so a direct `=== preferredId` comparison is
        // unreliable. `Multiaddr.toString()` always returns the canonical
        // string form, so extract the `/p2p/<id>` substring from there.
        //
        // For relay-circuit multiaddrs (e.g.
        // `.../p2p/<relay>/p2p-circuit/p2p/<remote>`), there are multiple
        // `/p2p/<id>` segments; the remote peer id is always the LAST one,
        // so iterate all matches and use the final occurrence.
        const matches = [...p.toString().matchAll(/\/p2p\/([^/]+)/g)];
        const peerId = matches.length > 0 ? matches[matches.length - 1][1] : null;
        return peerId != null && peerId === preferredId;
      });
      if (preferredIdx > 0) {
        const [preferred] = orderedPeers.splice(preferredIdx, 1);
        orderedPeers.unshift(preferred);
      }
    }

    let signature = '';
    if (this._isSigningEnabled()) {
      const signatureBytes = await this._authProvider.sign(
        this._encoder.encode(this.documentPath),
        this._userKey,
      );
      signature = this._serializeSignature(signatureBytes);
    }
    const loadRequest: CRDTLoadRequest = {
      documentId: this.documentPath,
      signature,
    };
    const serializedRequest = this._loadMessageSerializer.serializeLoadRequest(loadRequest);

    // Try snapshot-load first for faster initial sync.
    // If the peer returns an empty response (no snapshot available),
    // fall back to the regular doc-load protocol.
    for (const peer of orderedPeers) {
      try {
        console.log('Trying snapshot-load from peer:', peer.toString());
        // dialProtocol returns a libp2p v3 `Stream` (event-driven, with a
        // `send()`/iterator pair). Wrap it into the v2 `{ source, sink }`
        // duplex shape that `_sendLoadRequestAndSync` (and the legacy
        // `it-pipe` calls inside it) still expects.
        const snapshotStream = wrapStream(await this.libp2p.dialProtocol(peer, [
          snapshotLoadV2,
        ]));
        const loaded = await this._sendLoadRequestAndSync(snapshotStream, serializedRequest);
        if (loaded) return true;
        // Empty response -- peer has no snapshot, try doc-load below.
      } catch {
        // Peer doesn't support snapshot-load protocol.
      }

      try {
        console.log('Trying doc-load from peer:', peer.toString());
        // See snapshot-load above for why we wrap the v3 Stream here.
        const docStream = wrapStream(await this.libp2p.dialProtocol(peer, [
          documentLoadV2,
        ]));
        const loaded = await this._sendLoadRequestAndSync(docStream, serializedRequest);
        if (loaded) return true;
      } catch (err) {
        console.warn(
          `Failed to load document via ${documentLoadV2}:`,
          peer.toString(),
          err,
        );
      }
    }

    // No peer could provide the document -- assume new document.
    console.log('Failed to open document on any nodes.', this);
    return false;
  }

  /**
   * Opens this collabswarm document. The sequence of operations is:
   *
   * 1. Call `.load()` to fetch the document from an existing peer via direct dial.
   * 2. If the document is new (load returned false), run `validateDocumentPath`
   *    (if configured) to ensure the path is allowed before proceeding.
   * 3. Assign the pubsub message handler, subscribe to the document's GossipSub
   *    pubsub topic, and register protocol handlers for load, key-update, and
   *    snapshot-load requests.
   * 4. If `enableTopicValidators` is set, register a GossipSub topic validator
   *    that rejects messages that fail signature verification.
   * 5. For new documents, add the current user as a writer and generate an
   *    initial document encryption key.
   *
   * Once opened, a document can be closed with `.close()`.
   *
   * **Design note:** `load()` runs before protocol handlers are registered, so
   * this node cannot serve incoming load/key-update requests for *this* document
   * during the load window. This is intentional -- validation must complete before
   * subscribing to pubsub to prevent briefly joining an unauthorized topic, and
   * the document is not yet fully open so it has nothing to serve.
   *
   * **Race window:** Messages published by peers between the `load()` response
   * and the `pubsub.subscribe()` call will be missed. This is a deliberate
   * trade-off: validation must complete before subscribing to prevent briefly
   * joining an unauthorized topic. The window is mitigated by the fact that
   * subsequent messages will arrive once subscribed, and the underlying CRDT
   * guarantees eventual consistency. Callers who need to ensure no messages
   * were missed should call `load()` again after `open()` resolves to re-sync
   * the latest state from a peer.
   *
   * @returns `false` if `load()` returned `false` -- which `open()` treats as
   *   "new document" by adding the current user as a writer and generating an
   *   initial encryption key. Note that `load()` returning `false` is ambiguous:
   *   it may also mean all peers failed (see `load()` docs for details).
   * @throws {Error} If `validateDocumentPath` is configured and rejects the path
   *   for a new document. Validation runs before subscribing to pubsub or
   *   registering protocol handlers, so no cleanup is needed on rejection.
   */
  public async open(): Promise<boolean> {
    // Cache the topic once so that subscribe and unsubscribe always target
    // the same string, even if config.pubsubDocumentPrefix changes later.
    this._topic = this._computeTopic();

    // Load initial document from peers via direct dial (no subscription needed).
    const isExisting = await this.load();

    // Validate document path BEFORE subscribing to pubsub or registering
    // protocol handlers. This prevents temporarily joining an unauthorized topic.
    // _pubsubHandler is not yet assigned, so if validation throws, close() will
    // not attempt to unsubscribe from a subscription that was never created.
    if (!isExisting) {
      const validateFn = this.swarm.config?.validateDocumentPath;
      if (validateFn) {
        let allowed: boolean;
        try {
          allowed = await validateFn(this.documentPath, this._userPublicKey);
        } catch (err) {
          throw err instanceof Error ? err : new Error(String(err));
        }
        if (!allowed) {
          throw new Error(
            `Document path "${this.documentPath}" is not allowed for the current user`,
          );
        }
      }
    }

    // Assign pubsub handler AFTER validation succeeds. This ensures close()
    // won't try to unsubscribe if open() failed during validation.
    this._pubsubHandler = (rawMessage) => {
      // Decrypt sync message.
      const blockKeyID = rawMessage.detail.data.slice(
        0,
        this._keychainProvider.keyIDLength,
      );
      const blockNonce = rawMessage.detail.data.slice(
        this._keychainProvider.keyIDLength,
        this._keychainProvider.keyIDLength + this._authProvider.nonceBits,
      );
      const blockData = rawMessage.detail.data.slice(
        this._keychainProvider.keyIDLength + this._authProvider.nonceBits,
      );
      this._decryptBlock(blockKeyID, blockNonce, blockData).then(
        (rawContent) => {
          if (!rawContent) {
            // If we're unable to decrypt the document, try a fresh document load.
            console.warn(
              'Trying to re-load document... Unable to decrypt incoming message',
            );
            // Prefer loading from the sending peer -- they created this change
            // and should have the document key(s) needed to read it.
            const senderPeer = rawMessage.detail.type === 'signed' ? rawMessage.detail.from : undefined;
            return this.load(senderPeer);
          }

          const message =
            this._syncMessageSerializer.deserializeSyncMessage(rawContent);

          return this.sync(message);
        },
      );
    };

    // All registration and subscription steps are inside try/catch so that
    // close() cleans up any partially-registered state on failure.
    const pubsub = this.swarm.heliaNode.libp2p.services
      .pubsub as GossipSub;

    try {
      // Register this document with the swarm BEFORE subscribing to pubsub.
      // registerDocument() throws on duplicate document paths; doing this first
      // avoids subscribing to a topic that would then be unsubscribed by close()
      // on failure, which could disrupt an already-open instance for the same path.
      this.swarm.registerDocument(this.documentPath, this);

      // Subscribe to pubsub topic.
      // Cast required: EventHandler<CustomEvent<Message>> is incompatible with PubSubBaseProtocol's
      // addEventListener due to duplicate @libp2p/interface versions in the dependency tree
      pubsub.addEventListener('message', this._pubsubHandler as EventListener);
      pubsub.subscribe(this._topic);
      this._subscribed = true;

      // Register GossipSub topic validator for authorization enforcement.
      // When enabled, messages from unauthorized peers are rejected at the
      // transport layer with a P4 penalty in peer scoring.
      // Skip entirely when signing is disabled to avoid unnecessary per-message decryption.
      if (this.swarm.config?.enableTopicValidators && this._isSigningEnabled()) {
        const gossipsubService = pubsub as any;
        if (typeof gossipsubService.topicValidators?.set === 'function') {
          gossipsubService.topicValidators.set(
            this._topic,
            async (
              _peerIdStr: string,
              message: { data: Uint8Array },
            ): Promise<'Accept' | 'Reject' | 'Ignore'> => {
              try {
                // Decrypt the message to access the signature.
                const blockKeyID = message.data.slice(
                  0,
                  this._keychainProvider.keyIDLength,
                );
                const blockNonce = message.data.slice(
                  this._keychainProvider.keyIDLength,
                  this._keychainProvider.keyIDLength + this._authProvider.nonceBits,
                );
                const blockData = message.data.slice(
                  this._keychainProvider.keyIDLength + this._authProvider.nonceBits,
                );
                const rawContent = await this._decryptBlock(
                  blockKeyID,
                  blockNonce,
                  blockData,
                );
                if (!rawContent) {
                  // Decryption failed -- key may not be in keychain yet
                  console.warn(`[${this.documentPath}] Topic validator: decryption failed, ignoring message`);
                  return 'Ignore';
                }

                const syncMessage =
                  this._syncMessageSerializer.deserializeSyncMessage(rawContent);

                if (!syncMessage.signature) {
                  return 'Reject';
                }

                const { signature, ...messageWithoutSignature } = syncMessage;
                const raw =
                  this._syncMessageSerializer.serializeSyncMessage(
                    messageWithoutSignature,
                  );

                // Verify the message was signed by an authorized writer for this document
                if (await this._verifyWriterSignature(raw, signature)) {
                  return 'Accept';
                }
                return 'Reject';
              } catch {
                console.warn(`[${this.documentPath}] Topic validator: unexpected error, ignoring message`);
                return 'Ignore';
              }
            },
          );
        }
      }

      if (!isExisting) {
        // Add current user as a writer.
        await this._addWriter(this._userPublicKey);

        // Add initial document key.
        console.log(`Adding a key to ${this.documentPath}`);
        await this._keychain.add();
      }
    } catch (err) {
      // Clean up any partially-registered state to avoid leaked handlers,
      // subscriptions, or registry entries.
      await this.close().catch(() => {});
      throw err;
    }

    return isExisting;
  }

  /**
   * Disconnects from this collabswarm document. Running this method disconnects from the
   * document pubsub topic.
   *
   * **Limitation:** Multiple `CollabswarmDocument` instances sharing the same
   * `documentPath` are not supported. Calling `close()` on one instance will
   * remove the GossipSub topic validator and unsubscribe from the pubsub topic,
   * breaking any other instance using the same path.
   */
  public async close() {
    // Use the cached topic for cleanup; it is initialized in the constructor.
    const topic = this._topic;

    if (this._pubsubHandler) {
      const pubsub = this.swarm.heliaNode.libp2p.services
        .pubsub as GossipSub;

      // Only unsubscribe if this instance actually subscribed. If open()
      // failed before pubsub.subscribe() completed, unsubscribing here
      // would remove a subscription belonging to another instance.
      if (this._subscribed) {
        pubsub.unsubscribe(topic);
        this._subscribed = false;
      }

      // Cast required: see addEventListener comment above
      pubsub.removeEventListener('message', this._pubsubHandler as EventListener);

      // Always attempt to remove the GossipSub topic validator. This is safe
      // even if none was registered (Map.delete is a no-op for missing keys),
      // and ensures cleanup regardless of config changes between open() and close().
      const gossipsubService = pubsub as any;
      if (typeof gossipsubService.topicValidators?.delete === 'function') {
        gossipsubService.topicValidators.delete(topic);
      }
    }
    // Remove topicValidators entry if one was registered during open().
    const gossipsub = this.swarm.libp2p?.services?.pubsub as any;
    if (gossipsub?.topicValidators) {
      gossipsub.topicValidators.delete(topic);
    }

    // Unregister this document from the shared V2 protocol handler registry.
    // Pass `this` so only this instance is removed (instance-safe).
    this.swarm.unregisterDocument(this.documentPath, this);
  }

  /**
   * Given a sync message containing a list of hashes:
   * - Fetch new changes that are only hashes (missing change itself) from the blockstore (using the hash).
   * - Apply new changes to the existing CRDT document.
   *
   * @param message A sync message to apply.
   * @param verifySignature Whether to verify the message signature (default: true).
   * @returns `true` if the message was applied successfully, `false` if rejected due to auth failure.
   *
   * **BREAKING CHANGE:** Return type changed from `Promise<void>` to
   * `Promise<boolean>`. TypeScript callers with explicit `Promise<void>` type
   * annotations will need to update. Callers should now check the returned
   * boolean to determine whether the message was applied successfully.
   */
  public async sync(
    message: CRDTSyncMessage<ChangesType, PublicKey>,
    verifySignature = true,
  ): Promise<boolean> {
    const { signature, ...messageWithoutSignature } = message;
    const signingEnabled = this._isSigningEnabled();
    if (signingEnabled && !signature) {
      return false;
    }

    // Only serialize for signature verification -- skip when signing is disabled
    // to avoid expensive serialization of large messages.
    if (signingEnabled && verifySignature) {
      const raw = this._syncMessageSerializer.serializeSyncMessage(
        messageWithoutSignature,
      );
      if (!(await this._verifyWriterSignature(raw, signature!))) {
        console.warn(
          `Received a sync message with an invalid signature for ${message.documentId}`,
          signature,
          messageWithoutSignature,
        );
        return false;
      }
    }

    // Update/replace list of document keys (if provided).
    if (message.keychainChanges) {
      try {
        this._keychain.merge(message.keychainChanges);
        console.log(
          `Updated keychain in ${this.documentPath}: `,
          this._keychain,
        );
      } catch (e) {
        console.error(
          'Failed to merge in keychain changes',
          this._keychain,
          message,
          e,
        );
        throw e;
      }
    }

    // Pre-pass: apply only ACL nodes from the change tree to populate
    // _writers/_readers. This is needed before snapshot verification since
    // _verifySnapshotSignature() requires writer keys. ACL merges are
    // idempotent, so re-applying them in _syncDocumentChanges() is safe.
    if (message.changes) {
      this._applyACLFromTree(message.changes);
    }

    // Apply snapshot if present and more recent than ours.
    // Happens before full change sync so document changes that are already
    // covered by the snapshot don't need to be applied first (CRDTs handle
    // duplicate application correctly, but this avoids unnecessary work).
    if (message.snapshot) {
      const incoming = message.snapshot;
      if (
        !this._latestSnapshot ||
        incoming.compactedCount > this._latestSnapshot.compactedCount ||
        (incoming.compactedCount === this._latestSnapshot.compactedCount &&
          String(incoming.lastChangeNodeCID ?? '') >
            String(this._latestSnapshot.lastChangeNodeCID ?? ''))
      ) {
        // Verify the snapshot signature against the deterministic payload
        // by trying all authorized writers (publicKey may not survive
        // serialization for all key types, e.g. CryptoKey).
        // When signing is disabled, skip serialization and signature
        // verification -- accept the snapshot unconditionally.
        // WARNING: This means any peer can inject arbitrary snapshot state when
        // signing is disabled. Only disable signing in trusted or development
        // environments where all peers are known and authenticated by other means.
        let snapshotSignatureValid = !signingEnabled;
        if (signingEnabled) {
          try {
            const stateBytes = this._changesSerializer.serializeChanges(incoming.state);
            const signPayload = this._buildSnapshotSignPayload(
              stateBytes, incoming.lastChangeNodeCID, incoming.timestamp, incoming.compactedCount,
            );
            snapshotSignatureValid = await this._verifySnapshotSignature(
              signPayload, incoming.signature,
            );
          } catch (e) {
            console.warn(
              `Rejected snapshot for ${this.documentPath}: malformed snapshot fields`,
              e,
            );
          }
        }
        if (!snapshotSignatureValid) {
          console.warn(
            `Rejected snapshot for ${this.documentPath}: no authorized writer produced a valid signature`,
          );
        } else {
          // Apply the snapshot state. Use applySnapshot when available (e.g.
          // Automerge save format differs from incremental changes), otherwise
          // fall back to remoteChange (works for Yjs where snapshots are valid updates).
          this._document = this._crdtProvider.applySnapshot
            ? this._crdtProvider.applySnapshot(this._document, incoming.state)
            : this._crdtProvider.remoteChange(this._document, incoming.state);
          this._latestSnapshot = incoming;
          // Ensure our local document change count is at least as high as
          // the snapshot's compactedCount. This prevents re-triggering
          // compaction below the threshold after applying a remote snapshot.
          this._documentChangeCount = Math.max(
            this._documentChangeCount,
            incoming.compactedCount,
          );
          this._changesSinceSnapshot = 0;
          // Mark the snapshot boundary CID as seen so _mergeSyncTree skips
          // it and all ancestor nodes. This prevents re-applying pre-snapshot
          // changes (which the snapshot already covers) and avoids inflating
          // _documentChangeCount / _changesSinceSnapshot.
          if (incoming.lastChangeNodeCID) {
            this._hashes.add(incoming.lastChangeNodeCID);
          }
          console.log(
            `Applied remote snapshot for ${this.documentPath}: ${incoming.compactedCount} nodes compacted`,
          );
        }
      }
    }

    // Full change sync: process all nodes (document + ACL) from the DAG.
    // ACL nodes applied in the pre-pass above will be re-merged idempotently.
    if (message.changes) {
      await this._syncDocumentChanges(message.changeId, message.changes);
    }

    return true;
  }

  /**
   * Subscribes a change handler to the document. Use this method to receive real-time
   * updates to the document.
   *
   * @param id A unique id for this handler. Used to unsubscribe this handler.
   * @param handler A function that is called when a change is received.
   * @param originFilter Determines what kinds of change events trigger the handler.
   *     'remote' indicates that the change was received from a remote peer.
   *     'local' indicates that the change was received from the local document.
   *     'all' indicates that all changes should be handled.
   */
  public subscribe(
    id: string,
    handler: CollabswarmDocumentChangeHandler<DocType, PublicKey>,
    originFilter: 'all' | 'remote' | 'local' = 'all',
  ) {
    switch (originFilter) {
      case 'all': {
        this._remoteHandlers[id] = handler;
        this._localHandlers[id] = handler;
        break;
      }
      case 'remote': {
        this._remoteHandlers[id] = handler;
        break;
      }
      case 'local': {
        this._localHandlers[id] = handler;
        break;
      }
    }
  }

  /**
   * Unsubscribes a change handler from the document.
   *
   * @param id The id of the handler to unsubscribe.
   */
  public unsubscribe(id: string) {
    if (this._remoteHandlers[id]) {
      delete this._remoteHandlers[id];
    }
    if (this._localHandlers[id]) {
      delete this._localHandlers[id];
    }
  }

  // TODO: Unit tests for CollabswarmDocument require mocking libp2p, Helia,
  // and all providers -- deferred to integration testing (see e2e/).

  /**
   * Start a change transaction. Changes made via `addChange()` will be batched
   * and applied atomically when `endChange()` is called.
   */
  public startChange() {
    if (this._inTransaction) {
      throw new Error('Transaction already in progress');
    }
    this._inTransaction = true;
    this._pendingChangeFns = [];
  }

  /**
   * Queue a change function within an active transaction.
   * Must be called between `startChange()` and `endChange()`.
   */
  public addChange(changeFn: ChangeFnType) {
    if (!this._inTransaction) {
      throw new Error('No transaction in progress. Call startChange() first.');
    }
    if (this._committing) {
      throw new Error('Cannot add changes while endChange() is committing.');
    }
    this._pendingChangeFns.push(changeFn);
  }

  /**
   * End the transaction and apply all queued changes atomically.
   * This sends a single sync message for all batched changes.
   *
   * On failure (from any step: write check, CRDT apply, or network publish),
   * the transaction is aborted and the document reference is rolled back.
   * For immutable CRDT providers (e.g. Automerge), rollback is reliable
   * because `localChange()` returns a new document object.
   *
   * **Known limitation -- in-place mutating providers:** For CRDT providers
   * that mutate in place (e.g. Yjs), rollback does NOT undo mutations.
   * Yjs's `localChange()` mutates the document object directly and returns
   * the same reference, so restoring the saved reference after failure has
   * no effect -- the mutations have already been applied to the shared
   * Y.Doc. Callers using Yjs should treat a failed transaction as leaving
   * the local document in a potentially inconsistent state and consider
   * re-syncing from peers.
   *
   * **Known limitation -- concurrent remote changes during rollback:** The
   * rollback sets `_document` back to the snapshot captured when
   * `endChange()` is called (before applying the pending change functions).
   * Because `_makeChange()` is async and the node remains
   * subscribed to pubsub throughout, remote sync messages may arrive and be
   * applied to `_document` between the start of the transaction and the
   * point of failure. Rolling back to the original snapshot **reverts those
   * remote changes as well**, not just the local batch. This is acceptable
   * because the CRDT layer guarantees eventual consistency -- the reverted
   * remote changes will be re-applied on the next sync cycle or document
   * load. If transaction failure is critical, callers should re-sync the
   * document after a failed transaction (e.g. call `load()` or wait for
   * the next pubsub round) to ensure remote state is promptly restored.
   *
   * **Known limitation -- partial internal state on failure:** If
   * `_makeChange()` fails partway through (e.g. encryption succeeds but
   * pubsub publish throws), `_hashes` may retain CIDs for the rolled-back
   * change (see below). Other counters and bookkeeping fields
   * (`_lastSyncMessage`, `_documentChangeCount`, `_changesSinceSnapshot`,
   * `_recentTips`) ARE restored from snapshots captured before
   * `_makeChange()` -- see the "Internal metadata rollback" section below
   * for details.
   *
   * **Specifically, `_hashes` may retain CIDs for the rolled-back change.**
   * Because `_hashes` is used to skip already-seen changes during sync,
   * any CID added before the failure will cause that change to be silently
   * skipped if it arrives again via pubsub or `load()`. This means the
   * rolled-back change is effectively "lost" from this peer's perspective
   * until `_hashes` is rebuilt. **Callers should call `load()` after a
   * failed transaction** to re-sync the full document state from a peer
   * and restore consistency. A new transaction must be started after a
   * failure.
   *
   * **Internal metadata rollback:** On failure, `_lastSyncMessage`,
   * `_documentChangeCount`, `_changesSinceSnapshot`, and `_recentTips`
   * are restored from snapshots captured before `_makeChange()`.
   * (`_recentTips` is bounded to `MAX_RECENT_TIPS` entries so the snapshot
   * is a cheap shallow array copy.) For `_hashes`, all entries added to
   * the Set after `hashSizeBefore` are removed. Because the node remains
   * subscribed to pubsub during the async transaction, this may include
   * CIDs appended by concurrent remote syncs, not just local ones.
   * This is acceptable because CRDT convergence guarantees those remote
   * CIDs will be re-added on the next sync cycle or document load.
   * The approach is O(n) iteration but O(delta) memory -- no full
   * array clone -- and avoids disrupting any concurrent sync iteration
   * that `clear()` would break. A new transaction must be started after
   * a failure.
   *
   * @throws {Error} If any step in the commit pipeline fails.
   */
  public async endChange(message?: string) {
    if (!this._inTransaction) {
      throw new Error('No transaction in progress. Call startChange() first.');
    }
    if (this._committing) {
      throw new Error('endChange() is already in progress. Await the previous call.');
    }

    // Snapshot pending fns so late addChange() calls during await don't
    // unpredictably modify the batch being committed.
    const pendingFns = [...this._pendingChangeFns];
    if (pendingFns.length === 0) {
      this._inTransaction = false;
      this._pendingChangeFns = [];
      return;
    }

    const originalDocument = this.document;
    // Snapshot internal metadata so we can restore on failure.
    // Only track the Set size (O(1)) instead of cloning the entire Set (O(n)):
    // _makeChange adds at most one CID, and JS Sets iterate in insertion order,
    // so on rollback we remove only entries appended after this point.
    const hashSizeBefore = this._hashes.size;
    const lastSyncSnapshot = this._lastSyncMessage;
    const changeCountSnapshot = this._documentChangeCount;
    const compactionCountSnapshot = this._changesSinceSnapshot;
    // Bounded copy (max MAX_RECENT_TIPS entries) -- cheap to snapshot.
    const recentTipsSnapshot = [...this._recentTips];

    this._committing = true;
    try {
      await this._ensureCurrentUserCanWrite();

      // Compose all queued change functions into a single localChange call
      // to produce one atomic delta. This ensures providers like Automerge
      // (which return incremental deltas) don't drop earlier changes.
      const composedFn = ((doc: any) => {
        for (const fn of pendingFns) {
          (fn as any)(doc);
        }
      }) as ChangeFnType;

      // Note: YjsProvider.localChange mutates the document in-place and returns
      // the same reference, so rollback on failure is best-effort for Yjs.
      // Automerge returns a new immutable document, so rollback is reliable.
      const [newDocument, changes] = this._crdtProvider.localChange(
        this.document,
        message || '',
        composedFn,
      );
      this._document = newDocument;

      await this._makeChange(changes);

      // Success -- clear transaction state.
      this._inTransaction = false;
      this._pendingChangeFns = [];
    } catch (err) {
      // Abort transaction on ANY error (ensureWrite, localChange, or makeChange).
      // Roll back document and internal metadata (best-effort for in-place
      // mutating providers like Yjs).
      this._document = originalDocument;
      // Remove only the CIDs appended by _makeChange instead of clearing and
      // re-populating the entire Set. This avoids mutating the Set during
      // concurrent sync (clear() would disrupt any in-progress iteration)
      // and is O(delta) instead of O(n).
      // Iterate the Set (O(n)) but only collect entries past the snapshot
      // threshold into a small buffer (O(delta) memory) -- avoids cloning
      // the entire Set into an array via spread.
      if (this._hashes.size > hashSizeBefore) {
        const toRemove: string[] = [];
        let i = 0;
        for (const hash of this._hashes) {
          if (i >= hashSizeBefore) {
            toRemove.push(hash);
          }
          i++;
        }
        for (const hash of toRemove) {
          this._hashes.delete(hash);
        }
      }
      this._lastSyncMessage = lastSyncSnapshot;
      this._documentChangeCount = changeCountSnapshot;
      this._changesSinceSnapshot = compactionCountSnapshot;
      this._recentTips = recentTipsSnapshot;
      this._inTransaction = false;
      this._pendingChangeFns = [];
      throw err;
    } finally {
      this._committing = false;
    }
  }

  /**
   * Applies a new local change (defined by `changeFn`) to the collabswarm document and updates
   * all peers.
   *
   * @param changeFn A function that makes changes to the current CRDT document.
   * @param message An optional change message/description to include.
   */
  public async change(changeFn: ChangeFnType, message?: string) {
    if (this._inTransaction) {
      throw new Error('Cannot call change() during an active transaction. Use addChange() instead.');
    }
    await this._ensureCurrentUserCanWrite();

    const [newDocument, changes] = this._crdtProvider.localChange(
      this.document,
      message || '',
      changeFn,
    );
    // Apply local change w/ automerge.
    this._document = newDocument;

    await this._makeChange(changes);
  }

  /**
   * Returns the total number of change nodes (including ACL nodes) tracked
   * in the current document history. This is a count of all known CIDs,
   * not the depth of the longest path in the DAG.
   */
  public historySize(): number {
    return this._hashes.size;
  }

  /**
   * Returns the current snapshot, if one exists.
   */
  public get latestSnapshot(): CRDTSnapshotNode<ChangesType, PublicKey> | undefined {
    return this._latestSnapshot;
  }

  /**
   * Lazy-load a historical change block by CID.
   *
   * Used to fetch change data on demand for history-visibility consumers (e.g.
   * audit UI, diff viewers) when the change has been pruned from the in-memory
   * sync tree but the block is still present in the Helia blockstore. The
   * returned `ChangesType` is the deserialized, decrypted payload.
   *
   * Returns `undefined` when:
   * - The CID is not in `_hashes` (we have never seen this change).
   * - The block is missing from the blockstore (e.g. it was GC'd locally and
   *   no peer has re-served it yet). Callers that need stronger guarantees can
   *   fall back to dialing peers via the existing sync protocols.
   *
   * Throws when:
   * - The CID is malformed.
   * - The block is present locally but decryption fails (wrong/missing
   *   keychain entry) or the payload fails to deserialize (corrupted data).
   *   These are treated as hard errors so callers can distinguish a recoverable
   *   "missing block" condition from a stronger data-integrity issue.
   *
   * @param cid CID string of the change block to load.
   * @returns The deserialized change payload, or `undefined` if unavailable.
   */
  public async loadChangeBlock(cid: string): Promise<ChangesType | undefined> {
    return lazyLoadChangeBlock<CID, ChangesType>(
      cid,
      this._hashes,
      (c) => CID.parse(c),
      (parsedCID) => this._getBlock(parsedCID),
      // Intentionally no-op onMissing: missing-after-GC is an expected outcome
      // for the lazy-load path (audit UIs, diff viewers) and should not spam
      // logs. Callers that want visibility can detect `undefined` themselves.
    );
  }

  /**
   * Check whether a CID is known to this document (i.e. present in the
   * in-memory `_hashes` set). Useful for callers that want to confirm a
   * change exists before attempting a lazy load.
   *
   * Note: returning `true` only proves the CID has been observed (it is
   * tracked in `_hashes` for sync-message dedup). It does NOT guarantee the
   * underlying block is locally available -- after `gcAfterPrune` runs, the
   * CID remains in `_hashes` even though the block has been removed from the
   * blockstore. Callers should therefore still handle `loadChangeBlock(cid)`
   * resolving to `undefined` (and may need to fall back to dialing peers).
   */
  public hasChange(cid: string): boolean {
    return this._hashes.has(cid);
  }

  /**
   * Creates a snapshot of the current document state.
   *
   * The snapshot compacts all current change nodes into a single state representation.
   * Requires `CRDTProvider.getSnapshot()` to be implemented.
   *
   * @returns The created snapshot node, or undefined if the provider does not support snapshots.
   * @throws {Error} If the current user does not have write access to this document.
   *   Only writers are authorized to create snapshots.
   */
  public async snapshot(): Promise<CRDTSnapshotNode<ChangesType, PublicKey> | undefined> {
    await this._ensureCurrentUserCanWrite();

    if (!this._crdtProvider.getSnapshot) {
      console.warn('CRDTProvider does not implement getSnapshot(); compaction disabled.');
      this._snapshotUnsupported = true;
      return undefined;
    }

    const state = this._crdtProvider.getSnapshot(this._document);
    const lastChangeNodeCID = this._lastSyncMessage?.changeId ?? '';
    const timestamp = Date.now();

    // Create a deterministic, unambiguous binary payload to sign.
    // Use _documentChangeCount (document-kind changes only) rather than
    // _hashes.size (which includes ACL nodes) to keep the semantic consistent.
    // Binary layout with length prefixes avoids ambiguity and is efficient
    // for large state blobs (no JSON/Array.from overhead).
    const compactedCount = this._documentChangeCount;
    const stateBytes = this._changesSerializer.serializeChanges(state);
    let signature: Uint8Array;
    if (this._isSigningEnabled()) {
      const signPayload = this._buildSnapshotSignPayload(
        stateBytes, lastChangeNodeCID, timestamp, compactedCount,
      );
      signature = await this._authProvider.sign(signPayload, this._userKey);
    } else {
      signature = new Uint8Array(0);
    }

    const snapshotNode: CRDTSnapshotNode<ChangesType, PublicKey> = {
      state,
      lastChangeNodeCID,
      compactedCount,
      signature,
      publicKey: this._userPublicKey,
      timestamp,
    };

    this._latestSnapshot = snapshotNode;
    this._changesSinceSnapshot = 0;

    // Prune old change nodes from the in-memory sync tree if configured.
    // The snapshot is NOT stored on _lastSyncMessage -- it is only included
    // in load/snapshot-load responses via _latestSnapshot, to avoid bloating
    // every incremental pubsub sync message with the full snapshot state.
    if (this._lastSyncMessage && this._compactionConfig.pruneAfterSnapshot) {
      const prunedCIDs = this._pruneChanges(this._compactionConfig.keepRecentNodes);

      // Delete pruned blocks from the Helia blockstore asynchronously, but only
      // when explicitly opted-in via `gcAfterPrune`. Filter out any CIDs that
      // remain reachable from the post-prune sync tree (e.g. ACL nodes that
      // were re-attached as leaves) and the snapshot boundary CID itself.
      // Fire-and-forget: GC errors are logged but don't block snapshot creation.
      if (
        this._compactionConfig.gcAfterPrune &&
        prunedCIDs.size > 0 &&
        this._lastSyncMessage?.changes &&
        this._lastSyncMessage.changeId
      ) {
        const protectedCIDs = lastChangeNodeCID
          ? [lastChangeNodeCID]
          : [];
        const deletable = filterDeletableCIDs(
          prunedCIDs,
          this._lastSyncMessage.changeId,
          this._lastSyncMessage.changes,
          protectedCIDs,
        );
        if (deletable.size > 0) {
          this._gcPrunedBlocks(deletable).catch((err) => {
            console.error(`Blockstore GC failed for ${this.documentPath}:`, err);
          });
        }
      }
    }

    console.log(
      `Created snapshot for ${this.documentPath}: ${snapshotNode.compactedCount} nodes compacted`,
    );

    return snapshotNode;
  }

  /**
   * Get list of writers.
   *
   * @return List of public keys with write access.
   */
  public async getWriters(): Promise<PublicKey[]> {
    return await this._writers.users();
  }

  /**
   * Add a new user as a valid writer. Users are identified by their public keys
   *
   * @param writer User's public key
   */
  public async addWriter(writer: PublicKey) {
    await this._ensureCurrentUserCanWrite();

    // Check that the writer is not already a writer.
    if (await this._writers.check(writer)) {
      return;
    }

    // Construct a new writer ACL change.
    const changes = await this._addWriter(writer);

    await this._makeChange(changes, crdtWriterChangeNode);
  }

  /**
   * Remove a user as a valid writer. Users are identified by their public keys
   *
   * @param writer User's public key
   */
  public async removeWriter(writer: PublicKey) {
    await this._ensureCurrentUserCanWrite();

    // Check that the writer is already a writer.
    if (!(await this._writers.check(writer))) {
      return;
    }

    // Construct a new writer ACL change.
    const changes = await this._removeWriter(writer);

    await this._makeChange(changes, crdtWriterChangeNode);

    // Save the current (soon-to-be-previous) key before rotation.
    // This key is what peers currently have and can use to decrypt the update.
    const previousKey = await this._keychain.current();

    // Rotate the document key (required after removing any member with access).
    const [keyID, key, keychainChanges] = await this._keychain.add();

    // Distribute the new key to all remaining members, encrypted with the previous key.
    await this._distributeKeyUpdate(keychainChanges, previousKey);
  }

  /**
   * Returns a list of all public keys with read access.
   *
   * Deduplicates users that appear in both reader and writer ACLs,
   * which can occur due to concurrent edits or manual addition to both lists.
   *
   * @return List of public keys with read access.
   */
  public async getReaders(): Promise<PublicKey[]> {
    const [readers, writers] = await Promise.all([
      this._readers.users(),
      this._writers.users(),
    ]);
    // Filter out any writers that also appear in the readers list to avoid duplicates.
    // Run checks in parallel to avoid sequential async overhead with many writers.
    const checkResults = await Promise.all(
      writers.map(writer => this._readers.check(writer))
    );
    const filteredWriters = writers.filter((_, i) => !checkResults[i]);
    return [...readers, ...filteredWriters];
  }

  /**
   * Add a new user as a valid reader. Users are identified by their public keys.
   *
   * After updating the readers ACL, this attempts to send a BeeKEM Welcome
   * to the new reader so they receive (a) the keychain changes appropriate
   * for the document's `historyVisibility` setting (so they can decrypt at
   * least the current state), and (b) the invitation epoch ID they should
   * record for subsequent `since_invited` history filtering. The Welcome
   * is delivered via the `beekemWelcomeV1` protocol to every
   * currently-connected peer; the receiving document ignores Welcomes
   * addressed to a different reader.
   *
   * CONFIDENTIALITY: the Welcome's keychain delta is sealed with ECIES
   * (P-256 ECDH + AES-256-GCM) under `readerKemPublicKey`, so only the
   * intended recipient can decrypt it. The recipient binding
   * (`welcomeRecipient`) is the **authorization** gate; the sealed
   * payload is the **confidentiality** gate. See `_sendBeeKEMWelcome`
   * for the full construction.
   *
   * @param reader User's identity (signing) public key.
   * @param readerKemPublicKey Optional raw SEC1-uncompressed P-256
   *   ECDH public key (65 bytes) of the reader's KEM key pair. The
   *   reader must hold the matching private key (see
   *   `setKemKeyPair`). When this is `undefined`, the readers-ACL
   *   update is still broadcast but **no Welcome is sent**: the new
   *   reader can join the document but must recover keychain state
   *   via a fresh document load against an authorized peer. (The
   *   library refuses to broadcast an un-sealed Welcome to all peers
   *   because that would leak document key material in plaintext.)
   */
  public async addReader(
    reader: PublicKey,
    readerKemPublicKey?: Uint8Array,
  ) {
    await this._ensureCurrentUserCanWrite();

    // Check that the reader is not already a reader.
    if (await this._readers.check(reader)) {
      return;
    }

    // Send change over network.
    const changes = await this._readers.add(reader);
    await this._makeChange(changes, crdtReaderChangeNode);

    // Without the recipient's KEM public key we cannot seal the
    // Welcome payload, and we will NEVER send an un-sealed Welcome --
    // that would broadcast `keychainChanges` to every connected peer.
    if (!readerKemPublicKey) {
      console.warn(
        `[${this.documentPath}] addReader: BeeKEM Welcome skipped because ` +
          `the caller did not provide \`readerKemPublicKey\`. The reader ` +
          `has been added to the readers ACL, but to deliver the document ` +
          `key the caller must either (a) re-invoke \`addReader(reader, ` +
          `readerKemPublicKey)\` once the recipient's raw SEC1 P-256 ECDH ` +
          `public key is available, or (b) have the recipient perform a ` +
          `fresh document load against an authorized peer to recover ` +
          `keychain state.`,
      );
      return;
    }

    // Send a BeeKEM Welcome with the document key so the new reader can
    // decrypt subsequent (and, per visibility, prior) messages. Failures
    // are logged but do not abort -- the ACL change has already been
    // broadcast and the reader can also recover via a fresh document load.
    try {
      await this._sendBeeKEMWelcome(reader, readerKemPublicKey);
    } catch (err) {
      console.warn(
        `Failed to send BeeKEM Welcome for ${this.documentPath}:`,
        err,
      );
    }
  }

  /**
   * Build and send a BeeKEM Welcome message to a newly-added reader.
   *
   * The Welcome payload is a `CRDTSyncMessage` carrying:
   * - `welcomeEpochId`: the current keychain key ID, which the recipient
   *   records as their `_invitationEpoch` for later `since_invited` history
   *   filtering.
   * - `welcomeRecipient`: serialized public key of the intended recipient.
   *   The inviter cannot identify which connected peer is the new reader,
   *   so Welcomes are broadcast to every peer; the recipient binding
   *   ensures a *well-behaved* non-target peer drops the Welcome rather
   *   than installing the document key. The binding is covered by the
   *   writer signature, so a non-writer cannot redirect a Welcome to a
   *   different recipient.
   * - `welcomeRecipientKemPublicKey`: raw SEC1 P-256 ECDH public key of
   *   the recipient. Also covered by the writer signature -- the writer
   *   commits to a specific encryption key for a specific identity, so
   *   an attacker that owns one of those two values alone cannot
   *   redirect the sealed payload.
   * - `eciesSealed`: the inviter-side serialized keychain delta
   *   encrypted under the recipient's ECDH key via ECIES (see
   *   `ecies.ts`). This is the confidentiality control: a
   *   non-recipient peer that receives the broadcast cannot decrypt
   *   the keychain delta. The keychain plaintext is filtered per the
   *   document's `historyVisibility` **from the recipient's
   *   perspective** (see `_keychainChangesForWelcome()`).
   * - `signature`: writer signature over the message so the receiver can
   *   confirm a legitimate writer is the inviter (and ignore forgeries).
   *   Crucially, the signature covers the **sealed** bytes, not the
   *   plaintext, so a replayed or tampered sealed payload fails
   *   signature verification.
   *
   * Confidentiality: the keychain delta is end-to-end encrypted to the
   * recipient at the application layer. libp2p's Noise/TLS transport
   * still protects on-wire bytes against off-path observers, but the
   * application-layer ECIES seal is the primary confidentiality
   * guarantee against on-path connected peers.
   *
   * Wire format (mirrors `documentKeyUpdateV2`):
   *   [4-byte BE doc-path length] [UTF-8 doc-path] [serialized sync message]
   */
  private async _sendBeeKEMWelcome(
    reader: PublicKey,
    readerKemPublicKey: Uint8Array,
  ): Promise<void> {
    // Validate the recipient KEM public key length up front so a
    // malformed caller fails fast at the call site rather than deep
    // inside the WebCrypto import.
    if (readerKemPublicKey.byteLength !== ECIES_P256_PUBLIC_KEY_LENGTH) {
      throw new Error(
        `BeeKEM Welcome for ${this.documentPath}: readerKemPublicKey ` +
          `must be ${ECIES_P256_PUBLIC_KEY_LENGTH} raw SEC1 bytes (P-256 ` +
          `uncompressed), got ${readerKemPublicKey.byteLength}`,
      );
    }

    // Defensive copy: snapshot the recipient's KEM public key bytes once
    // at the entry point so a caller that reuses or mutates the same
    // buffer (or shares it across async tasks) after `addReader` returns
    // cannot corrupt the in-flight Welcome. Both the signed message
    // field (`welcomeRecipientKemPublicKey`) and the WebCrypto import
    // must observe the *same* byte sequence; otherwise the receiver
    // would see a signature/payload mismatch.
    const kemPub = new Uint8Array(readerKemPublicKey);

    // Build the welcome message.
    const welcomeMessage: CRDTSyncMessage<ChangesType, PublicKey> = {
      documentId: this.documentPath,
    };

    // The invitation epoch is the *current* keychain key ID at the time
    // of invitation -- the boundary between "before I joined" and "from
    // when I joined". `_keychain.current()` throws on an empty keychain;
    // in practice that cannot happen here because the inviter is in the
    // group (and so has at least one key), but if it ever does we surface
    // the error to the caller of `addReader` rather than silently sending
    // a Welcome with no epoch ID.
    const [currentKeyID] = await this._keychain.current();
    welcomeMessage.welcomeEpochId = currentKeyID;

    // Recipient binding: serialize the new reader's public key so
    // recipients that aren't this reader can drop the broadcast Welcome.
    // The signed payload covers this field, so only an authorized writer
    // can claim a specific recipient. `serializePublicKey` is optional
    // on `AuthProvider` for backwards compatibility, but Welcome
    // onboarding cannot function without it.
    const serializePublicKey = requireSerializePublicKey(
      this._authProvider,
      'BeeKEM Welcome onboarding',
    );
    welcomeMessage.welcomeRecipient = await serializePublicKey(reader);
    welcomeMessage.welcomeRecipientKemPublicKey = kemPub;

    // Visibility-filtered keychain so the new reader can decrypt the
    // appropriate window of document history. Note: this uses
    // `_keychainChangesForWelcome()` (recipient's perspective), NOT
    // `_keychainChangesForVisibility()` (sender's perspective) -- the
    // latter would, in `since_invited` mode, leak the inviter's
    // post-invite slice (or, for founders, the full history) to a
    // reader whose invitation epoch starts at this moment.
    const keychainPlaintext = await this._keychainChangesForWelcome();
    const keychainPlaintextBytes =
      this._changesSerializer.serializeChanges(keychainPlaintext);

    // Seal the keychain delta to the recipient's ECDH public key. Only
    // the recipient holding the matching ECDH private key can recover
    // the plaintext; every other connected peer that observes the
    // broadcast sees only opaque ciphertext + ephemeral public key +
    // nonce + AES-GCM tag.
    const recipientKemKey = await importEciesPublicKey(kemPub);
    welcomeMessage.eciesSealed = await eciesSeal(
      keychainPlaintextBytes,
      recipientKemKey,
    );

    // Sign so the receiver can verify the inviter is an authorized
    // writer. Welcomes are ALWAYS writer-authenticated, regardless of
    // the swarm-wide `enableSigning` toggle that gates normal
    // sync-message signing (see SECURITY NOTE in
    // `beekem-welcome-handler.ts`). The signature covers the sealed
    // bytes (`eciesSealed`) and the recipient bindings
    // (`welcomeRecipient` + `welcomeRecipientKemPublicKey`), so an
    // attacker cannot redirect or substitute the sealed payload
    // without invalidating the signature.
    welcomeMessage.signature = await this._signWelcomeAsWriter(welcomeMessage);

    const serialized =
      this._syncMessageSerializer.serializeSyncMessage(welcomeMessage);

    // Build the V1 path-prefixed payload that the shared handler routes.
    const pathBytes = this._encoder.encode(this.documentPath);
    if (pathBytes.length === 0 || pathBytes.length > MAX_DOCUMENT_PATH_LENGTH) {
      throw new Error(
        `Document path "${this.documentPath}" encoded length (${pathBytes.length}) exceeds ` +
          `the maximum allowed path length (${MAX_DOCUMENT_PATH_LENGTH} bytes) for the BeeKEM Welcome v1 protocol`,
      );
    }
    const pathHeader = new Uint8Array(4);
    pathHeader[0] = (pathBytes.length >> 24) & 0xff;
    pathHeader[1] = (pathBytes.length >> 16) & 0xff;
    pathHeader[2] = (pathBytes.length >> 8) & 0xff;
    pathHeader[3] = pathBytes.length & 0xff;

    const payload = concatUint8Arrays(pathHeader, pathBytes, serialized);

    // Best-effort fan-out to all connected peers. Each peer will either
    // process the Welcome (if it identifies as the new reader) or drop it.
    // We do not have a way to know which peer is the new reader from the
    // libp2p connection alone, so broadcasting is the conservative choice.
    const peers = this.swarm.heliaNode.libp2p
      .getConnections()
      ?.map((x) => x.remoteAddr) ?? [];

    const failedPeers: string[] = [];
    for (const peer of peers) {
      try {
        const stream = wrapStream(
          await this.libp2p.dialProtocol(peer, [beekemWelcomeV1]),
        );
        await pipe([payload], stream.sink);
      } catch (err) {
        failedPeers.push(peer.toString());
        console.warn(
          `Failed to send BeeKEM Welcome to peer:`,
          peer.toString(),
          err,
        );
      }
    }

    if (failedPeers.length > 0) {
      console.warn(
        `BeeKEM Welcome for ${this.documentPath} failed to reach ${failedPeers.length} peer(s):`,
        failedPeers,
      );
    }
  }

  /**
   * Handles an incoming BeeKEM Welcome message with pre-read payload. Called
   * by the shared protocol handler in Collabswarm after the document path
   * header has been stripped and the document looked up in the registry.
   *
   * Verifies the writer signature on the message, merges the included
   * keychain changes so future blocks can be decrypted, and records the
   * `welcomeEpochId` as `_invitationEpoch` so subsequent `since_invited`
   * history responses are correctly filtered.
   *
   * @internal
   * @param payload The serialized sync message (without the document path
   *   header that the shared handler already stripped).
   */
  public async handleBeeKEMWelcomeRequestData(
    payload: Uint8Array,
  ): Promise<void> {
    try {
      const message = this._syncMessageSerializer.deserializeSyncMessage(payload);
      await this._evaluateAndApplyBeeKEMWelcome(message, {
        fromBuffer: false,
      });
    } catch (err: unknown) {
      console.error(
        `Error handling BeeKEM Welcome for document ${this.documentPath}:`,
        err,
      );
    }
  }

  /**
   * Shared receive-path body for both freshly-arrived Welcomes (called
   * from `handleBeeKEMWelcomeRequestData`) and Welcomes replayed from the
   * pending-welcomes buffer (called from `_drainPendingWelcomes` after a
   * readers-ACL update unblocks a previously-dropped Welcome).
   *
   * @param message The deserialized sync message.
   * @param opts.fromBuffer When `true`, the message is being replayed from
   *   the pending-welcomes buffer; we suppress re-buffering on
   *   `not-in-readers-acl` to avoid an infinite drain loop and instead
   *   leave the entry in place for the next drain cycle (or TTL
   *   eviction).
   * @returns `true` iff the Welcome was accepted and applied.
   *
   * @internal
   */
  private async _evaluateAndApplyBeeKEMWelcome(
    message: CRDTSyncMessage<ChangesType, PublicKey>,
    opts: { fromBuffer: boolean },
  ): Promise<boolean> {
    // Run the pure validation gates (extracted to
    // `beekem-welcome-handler.ts` so they can be unit-tested without
    // a full libp2p/Helia stack). On `accept` we apply the keychain
    // merge + invitation-epoch assignment below. `serializePublicKey`
    // is required on the AuthProvider for the recipient-binding gate;
    // we surface a clear error instead of silently dropping
    // every Welcome for misconfigured providers.
    const serializePublicKey = requireSerializePublicKey(
      this._authProvider,
      'BeeKEM Welcome onboarding',
    );
    const decision = await evaluateBeeKEMWelcome(message, {
      documentPath: this.documentPath,
      localUserPublicKey: this._userPublicKey,
      serializePublicKey,
      isReader: (pk) => this._readers.check(pk),
      // Welcomes always require writer-auth, independent of the
      // swarm-wide `enableSigning` toggle -- wire the unconditional
      // verifier so the validator can't be downgraded by config.
      verifyWriterSignature: (raw, signature) =>
        this._verifyWelcomeWriterSignature(raw, signature),
      syncMessageSerializer: this._syncMessageSerializer,
    });

    if (decision.kind !== 'accept') {
      switch (decision.kind) {
        case 'drop-not-for-us':
          // Legitimate Welcome to another peer flowing past our
          // connection -- silently ignore.
          return false;
        case 'drop-malformed':
          console.warn(
            `Dropping malformed BeeKEM Welcome for ${this.documentPath}: ${decision.reason}`,
          );
          return false;
        case 'drop-unauthorized':
          // If the Welcome was dropped solely because the local user is
          // not yet a reader (ACL update + Welcome can reorder;
          // `_sendBeeKEMWelcome` is fire-and-forget), park the Welcome
          // in a small bounded buffer and replay it after the next
          // readers-ACL merge. Without this buffer, a transiently-late
          // ACL update would permanently wedge onboarding.
          if (
            decision.reason === 'not-in-readers-acl' &&
            !opts.fromBuffer &&
            message.welcomeEpochId &&
            message.welcomeEpochId.length > 0
          ) {
            this._bufferPendingWelcome(message);
          } else if (
            opts.fromBuffer &&
            decision.reason === 'not-in-readers-acl'
          ) {
            // A buffered Welcome that is still blocked by
            // `not-in-readers-acl` on a drain cycle is the expected
            // steady state until the readers-ACL catches up. The
            // first-arrival case (above) already logged via
            // `_bufferPendingWelcome`; emitting `console.warn` on every
            // subsequent drain produces noisy spam (and is
            // attacker-triggerable via repeated ACL merges). Use
            // `console.debug` so operators can still trace if needed.
            console.debug(
              `Buffered BeeKEM Welcome for ${this.documentPath} still blocked: ${decision.reason}`,
            );
          } else {
            console.warn(
              `Dropping unauthorized BeeKEM Welcome for ${this.documentPath}: ${decision.reason}`,
            );
          }
          return false;
      }
    }

    // Open the sealed keychain delta. We must hold the matching ECDH
    // private key (see `setKemKeyPair`); without it, even a Welcome
    // that addresses us by identity and KEM public key cannot be
    // applied. Drop in that case -- the recipient must recover via a
    // fresh document load against an authorized peer.
    //
    // Defense in depth: if the writer-signed `welcomeRecipientKemPublicKey`
    // does NOT match the local installed KEM public key, the writer
    // is claiming a different encryption key than the one we hold.
    // Refuse to attempt decryption: this prevents an attacker who
    // somehow registered a fake KEM key (e.g. via a parallel
    // out-of-band channel) from getting us to silently install
    // keychain state under a key we don't actually control. A
    // legitimate writer who follows the documented onboarding flow
    // will always echo back the recipient's own KEM public key.
    if (!this._kemKeyPair || !this._kemPublicKeyRaw) {
      console.warn(
        `Dropping BeeKEM Welcome for ${this.documentPath}: no local KEM ` +
          `key pair installed via setKemKeyPair; cannot open sealed payload.`,
      );
      return false;
    }
    // Use the eagerly-cached raw bytes from `setKemKeyPair` rather
    // than re-exporting on every Welcome.
    const localKemPublicRaw = this._kemPublicKeyRaw;
    const messageKemPublic = message.welcomeRecipientKemPublicKey;
    if (
      !messageKemPublic ||
      messageKemPublic.byteLength !== localKemPublicRaw.byteLength ||
      !this._constantTimeEquals(messageKemPublic, localKemPublicRaw)
    ) {
      console.warn(
        `Dropping BeeKEM Welcome for ${this.documentPath}: ` +
          `welcomeRecipientKemPublicKey does not match the locally-installed ` +
          `KEM public key.`,
      );
      return false;
    }

    let keychainPlaintext: ChangesType;
    try {
      const sealed = message.eciesSealed as Uint8Array;
      const plaintextBytes = await eciesOpen(
        sealed,
        this._kemKeyPair.privateKey,
      );
      keychainPlaintext =
        this._changesSerializer.deserializeChanges(plaintextBytes);
    } catch (err) {
      // ECIES open failure typically means: the sealed payload is
      // tampered (AES-GCM tag check fails), or the writer encrypted
      // under a different ECDH public key than the one we hold (so
      // ECDH produces a different shared secret and the HKDF-derived
      // AES key cannot decrypt). Both are security-relevant; log and
      // drop.
      console.warn(
        `Failed to open sealed BeeKEM Welcome payload for ${this.documentPath}:`,
        err,
      );
      return false;
    }

    // Merge the keychain changes before recording the invitation epoch,
    // so a recipient handling concurrent Welcomes is not left with an
    // _invitationEpoch pointing at a key that hasn't been installed.
    try {
      this._keychain.merge(keychainPlaintext);
    } catch (err) {
      console.error(
        `Failed to merge keychain changes from BeeKEM Welcome for ${this.documentPath}:`,
        err,
      );
      return false;
    }

    // Record the invitation epoch -- this gates `since_invited` history
    // filtering on subsequent doc-load / snapshot-load responses we send.
    // `evaluateBeeKEMWelcome` guarantees `welcomeEpochId` is set when
    // it returns `accept`.
    //
    // MONOTONIC UPDATE: if we already have an
    // `_invitationEpoch`, only advance it forward in keychain order --
    // never regress to an earlier epoch.
    //
    // The threat model: a writer could (maliciously or via reordering)
    // send a later writer-signed Welcome that nominally addresses this
    // node but carries an *earlier* `welcomeEpochId`. If we
    // unconditionally overwrote `_invitationEpoch`, this would shrink
    // the recipient's join boundary, broadening the set of keys
    // returned by future `since_invited` history responses we send
    // (leaking more history than the original invitation granted).
    //
    // Comparison strategy: `_keychain.keys()` returns entries in the
    // insertion order used by Yjs/Automerge keychain implementations
    // (`keychain.keys.push(...)`). Position in that array is the
    // canonical "later means later" relation -- the same one
    // `historySince` relies on to slice the suffix. We compare the
    // positions of the existing and incoming epoch IDs; if the new
    // one is strictly later we advance, otherwise we keep the
    // existing anchor.
    //
    // Fallback: if either ID is not present in `keys()` after the
    // merge above (e.g. the merge dropped the entry, or the local
    // keychain implementation does not expose insertion order), we
    // conservatively keep the existing `_invitationEpoch` -- it is
    // already known-good. The only path that loses fidelity is the
    // first-Welcome-ever case (no existing anchor) which is handled
    // by the simple assignment branch.
    const newEpochId = message.welcomeEpochId as Uint8Array;
    if (this._invitationEpoch === undefined) {
      this._invitationEpoch = newEpochId;
      console.log(
        `Recorded BeeKEM Welcome invitation epoch for ${this.documentPath}`,
      );
    } else {
      const advanced = await this._shouldAdvanceInvitationEpoch(
        this._invitationEpoch,
        newEpochId,
      );
      if (advanced) {
        this._invitationEpoch = newEpochId;
        console.log(
          `Recorded BeeKEM Welcome invitation epoch for ${this.documentPath}`,
        );
      } else {
        // Byte-equality check distinguishes benign duplicate Welcomes
        // (same epoch ID arriving more than once -- expected with
        // gossipsub fanout) from genuine out-of-order or regression
        // cases (different epoch ID that is not strictly later than
        // the current anchor). Only the latter is worth warning about;
        // duplicates are silently ignored to avoid log noise.
        let isDuplicate = false;
        if (this._invitationEpoch.byteLength === newEpochId.byteLength) {
          let diff = 0;
          for (let i = 0; i < this._invitationEpoch.byteLength; i++) {
            diff |= this._invitationEpoch[i] ^ newEpochId[i];
          }
          isDuplicate = diff === 0;
        }
        if (!isDuplicate) {
          console.warn(
            `Ignoring out-of-order BeeKEM Welcome for ${this.documentPath}: ` +
              `incoming epoch is not later than current invitation epoch`,
          );
        }
      }
    }
    return true;
  }

  /**
   * Buffer a Welcome that was dropped solely because the local user is
   * not yet in the readers ACL. The entry is keyed by
   * `hex(welcomeEpochId)` so duplicate Welcomes for the same epoch
   * coalesce automatically. Bounded by
   * `_PENDING_WELCOMES_MAX_ENTRIES` (oldest evicted in insertion
   * order); replayed by `_drainPendingWelcomes()` after the next
   * readers-ACL merge.
   *
   * Idempotent and safe to call repeatedly with the same epoch ID --
   * the buffer is conceptually a set keyed on epoch ID, with
   * insertion-order eviction.
   *
   * @internal
   */
  private _bufferPendingWelcome(
    message: CRDTSyncMessage<ChangesType, PublicKey>,
  ): void {
    const epochId = message.welcomeEpochId;
    if (!epochId || epochId.length === 0) return;
    const key = this._hexEncode(epochId);
    // Refresh recency for duplicate Welcomes: delete-then-set so the
    // Map iteration order puts this entry at the back, matching the
    // intent of insertion-order eviction.
    this._pendingWelcomes.delete(key);

    // Bound: if at capacity, evict the oldest entry (first in Map
    // iteration order).
    if (
      this._pendingWelcomes.size >=
      CollabswarmDocument._PENDING_WELCOMES_MAX_ENTRIES
    ) {
      const oldestKey = this._pendingWelcomes.keys().next().value;
      if (oldestKey !== undefined) {
        this._pendingWelcomes.delete(oldestKey);
        console.warn(
          `Pending BeeKEM Welcomes buffer for ${this.documentPath} ` +
            `at capacity (${CollabswarmDocument._PENDING_WELCOMES_MAX_ENTRIES}); ` +
            `evicting oldest entry to make room.`,
        );
      }
    }

    this._pendingWelcomes.set(key, {
      message,
      bufferedAtMs: this._now(),
    });
    console.log(
      `Buffered BeeKEM Welcome for ${this.documentPath} pending readers-ACL update ` +
        `(epoch=${key.slice(0, 16)}..., buffer size=${this._pendingWelcomes.size})`,
    );
  }

  /**
   * Replay buffered BeeKEM Welcomes whose recipient is now in the
   * readers ACL. Called after every readers-ACL `merge` so a Welcome
   * that arrived ahead of the ACL update on this node is unblocked as
   * soon as the ACL catches up. Also discards entries past their TTL
   * (`_PENDING_WELCOMES_TTL_MS`) so the buffer cannot retain stale
   * Welcomes indefinitely.
   *
   * Each accepted Welcome is removed from the buffer; entries that
   * still return `not-in-readers-acl` (e.g. the ACL merge didn't
   * add this user; the merge added someone else) stay in the buffer
   * until they either resolve or expire.
   *
   * @internal
   */
  private async _drainPendingWelcomes(): Promise<void> {
    if (this._pendingWelcomes.size === 0) return;
    const now = this._now();
    // Iterate over a snapshot of entries because we mutate the Map
    // during iteration (delete on accept / TTL).
    const entries = Array.from(this._pendingWelcomes.entries());
    for (const [key, entry] of entries) {
      if (now - entry.bufferedAtMs > CollabswarmDocument._PENDING_WELCOMES_TTL_MS) {
        this._pendingWelcomes.delete(key);
        console.warn(
          `Discarding stale buffered BeeKEM Welcome for ${this.documentPath} ` +
            `(epoch=${key.slice(0, 16)}..., age=${now - entry.bufferedAtMs}ms ` +
            `exceeds TTL=${CollabswarmDocument._PENDING_WELCOMES_TTL_MS}ms)`,
        );
        continue;
      }
      const accepted = await this._evaluateAndApplyBeeKEMWelcome(entry.message, {
        fromBuffer: true,
      });
      if (accepted) {
        this._pendingWelcomes.delete(key);
        console.log(
          `Replayed buffered BeeKEM Welcome for ${this.documentPath} ` +
            `after readers-ACL update (epoch=${key.slice(0, 16)}...)`,
        );
      }
    }
  }

  /** Indirection so unit tests can stub the wall clock. */
  private _now(): number {
    return Date.now();
  }

  /** Lower-case hex encoding of a `Uint8Array`. */
  private _hexEncode(bytes: Uint8Array): string {
    let s = '';
    for (let i = 0; i < bytes.length; i++) {
      s += bytes[i].toString(16).padStart(2, '0');
    }
    return s;
  }

  /**
   * Constant-time byte-equality check. Used by the BeeKEM Welcome
   * receive path to compare the writer-signed
   * `welcomeRecipientKemPublicKey` against the locally-installed KEM
   * public key without leaking byte-position timing on a mismatch.
   * Callers must supply equal-length buffers.
   */
  private _constantTimeEquals(a: Uint8Array, b: Uint8Array): boolean {
    if (a.length !== b.length) return false;
    let diff = 0;
    for (let i = 0; i < a.length; i++) {
      diff |= a[i] ^ b[i];
    }
    return diff === 0;
  }

  /**
   * Test/inspection helper: number of BeeKEM Welcomes currently parked
   * in the pending-welcomes buffer awaiting a readers-ACL update.
   *
   * @internal exposed only for unit tests.
   */
  public get pendingWelcomesCount(): number {
    return this._pendingWelcomes.size;
  }

  /**
   * Test/inspection helper: returns a copy of the recorded invitation
   * epoch, or `undefined` if no Welcome has been processed (e.g.
   * founding member). The returned `Uint8Array` is a defensive copy so
   * external callers cannot mutate the document's internal state and
   * alter subsequent `since_invited` filtering behavior.
   */
  public get invitationEpoch(): Uint8Array | undefined {
    return this._invitationEpoch === undefined
      ? undefined
      : new Uint8Array(this._invitationEpoch);
  }

  /**
   * Decide whether an incoming BeeKEM Welcome's `welcomeEpochId` is
   * strictly later than the existing `_invitationEpoch`. Used by
   * `handleBeeKEMWelcomeRequestData` to enforce a monotonic-forward
   * update on the invitation-epoch anchor.
   *
   * Comparison is performed by looking up both IDs in the
   * post-merge `_keychain.keys()` ordering. Yjs and Automerge keychain
   * implementations append entries in insertion order, so the array
   * position is the canonical "later means later" ordering -- the
   * same relation `historySince` slices on.
   *
   * Returns `true` iff the new epoch is strictly later than the
   * existing one. Returns `false` if:
   *   - the two IDs are byte-equal (no-op, do not log a regression),
   *   - the new epoch is at an earlier position than the existing one
   *     (would regress the anchor),
   *   - either ID is not present in the keychain after the merge
   *     (we cannot establish ordering; conservatively keep the
   *     known-good existing anchor).
   *
   * @internal exposed only for unit tests.
   */
  public async _shouldAdvanceInvitationEpoch(
    existing: Uint8Array,
    incoming: Uint8Array,
  ): Promise<boolean> {
    // Byte-equal: no advancement needed and not a regression.
    if (
      existing.length === incoming.length &&
      existing.every((b, i) => b === incoming[i])
    ) {
      return false;
    }

    let allKeys: [Uint8Array, unknown][];
    try {
      allKeys = await this._keychain.keys();
    } catch {
      // Keychain refused to enumerate keys (empty keychain, transient
      // error). Conservatively keep the known-good anchor.
      return false;
    }

    const sameBytes = (a: Uint8Array, b: Uint8Array): boolean => {
      if (a.length !== b.length) return false;
      for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
      return true;
    };

    const existingIdx = allKeys.findIndex(([id]) => sameBytes(id, existing));
    const incomingIdx = allKeys.findIndex(([id]) => sameBytes(id, incoming));
    if (existingIdx === -1 || incomingIdx === -1) {
      // One of the IDs is not in the keychain -- cannot establish
      // ordering. Keep the existing anchor.
      return false;
    }
    return incomingIdx > existingIdx;
  }

  /**
   * Remove a user as a valid reader. Users are identified by their public keys
   *
   * @param reader User's public key
   */
  public async removeReader(reader: PublicKey) {
    await this._ensureCurrentUserCanWrite();

    // Check that the reader is already a reader.
    if (!(await this._readers.check(reader))) {
      return;
    }

    // Send change over network.
    const changes = await this._readers.remove(reader);
    await this._makeChange(changes, crdtReaderChangeNode);

    // Save the current (soon-to-be-previous) key before rotation.
    // This key is what peers currently have and can use to decrypt the update.
    const previousKey = await this._keychain.current();

    // Create a new document key (rotation required after reader removal).
    const [keyID, key, keychainChanges] = await this._keychain.add();

    // Distribute the new key to all remaining readers, encrypted with the previous key.
    await this._distributeKeyUpdate(keychainChanges, previousKey);
  }

  /**
   * Distribute keychain changes to all connected peers via the key-update protocol.
   * Used after key rotation (e.g., when a reader is removed).
   *
   * @param keychainChanges The keychain CRDT changes containing the new key.
   * @param previousKey The previous document key to encrypt the update with.
   *   Peers already have this key and can decrypt the message to learn about the new key.
   *   This avoids the chicken-and-egg problem of encrypting with a key peers don't have yet.
   */
  private async _distributeKeyUpdate(
    keychainChanges: ChangesType,
    previousKey: [Uint8Array, DocumentKey],
  ) {
    const keyUpdateMessage: CRDTSyncMessage<ChangesType, PublicKey> = {
      documentId: this.documentPath,
      keychainChanges,
    };

    // Sign the key update message.
    keyUpdateMessage.signature = await this._signAsWriter(keyUpdateMessage);

    const serialized =
      this._syncMessageSerializer.serializeSyncMessage(keyUpdateMessage);

    // Encrypt with the PREVIOUS key so that existing peers can decrypt the message.
    // Peers don't have the new key yet -- that's what this message delivers to them.
    const [previousKeyID, previousDocumentKey] = previousKey;
    const { nonce, data } = await this._authProvider.encrypt(
      serialized,
      previousDocumentKey,
    );
    if (!nonce) {
      throw new Error(`Failed to encrypt key update! Nonce cannot be empty`);
    }

    // Send to all connected peers via the V2 key-update protocol.
    // V2 payload format: 4-byte big-endian path length + UTF-8 path + encrypted payload
    const peers = this.swarm.heliaNode.libp2p
      .getConnections()
      ?.map((x) => x.remoteAddr);

    const pathBytes = this._encoder.encode(this.documentPath);
    if (pathBytes.length === 0 || pathBytes.length > MAX_DOCUMENT_PATH_LENGTH) {
      throw new Error(
        `Document path "${this.documentPath}" encoded length (${pathBytes.length}) exceeds ` +
        `the maximum allowed path length (${MAX_DOCUMENT_PATH_LENGTH} bytes) for the V2 key-update protocol`,
      );
    }
    const pathHeader = new Uint8Array(4);
    pathHeader[0] = (pathBytes.length >> 24) & 0xff;
    pathHeader[1] = (pathBytes.length >> 16) & 0xff;
    pathHeader[2] = (pathBytes.length >> 8) & 0xff;
    pathHeader[3] = pathBytes.length & 0xff;

    const v2Payload = concatUint8Arrays(pathHeader, pathBytes, previousKeyID, nonce, data);

    // WARNING: If some peers fail to receive this update, they will be unable
    // to decrypt future messages encrypted with the new key. They will need to
    // perform a fresh document load to recover the keychain state.
    const failedPeers: string[] = [];
    for (const peer of peers) {
      try {
        // Wrap the v3 stream so we can keep using the legacy `pipe(..., sink)`
        // pattern below; see snapshot-load above for the rationale.
        const stream = wrapStream(await this.libp2p.dialProtocol(peer, [
          documentKeyUpdateV2,
        ]));
        await pipe(
          [v2Payload],
          stream.sink,
        );
      } catch (err) {
        const peerAddr = peer.toString();
        failedPeers.push(peerAddr);
        console.warn(
          `Failed to send key update to peer:`,
          peerAddr,
          err,
        );
      }
    }

    if (failedPeers.length > 0) {
      console.warn(
        `Key update for ${this.documentPath} failed to reach ${failedPeers.length} peer(s):`,
        failedPeers,
        'These peers may be unable to decrypt future messages until they reload the document.',
      );
    }
  }

  /**
   * Handles a key-update request with pre-read payload data. Called by
   * the shared protocol handler in Collabswarm after reading the document
   * path header and routing.
   *
   * @internal
   * @param payload The encrypted key-update payload (without the document
   *   path header that was already stripped by the shared handler).
   */
  public async handleKeyUpdateRequestData(
    payload: Uint8Array,
  ): Promise<void> {
    try {
      // Decrypt the key update message.
      const blockKeyID = payload.slice(
        0,
        this._keychainProvider.keyIDLength,
      );
      const blockNonce = payload.slice(
        this._keychainProvider.keyIDLength,
        this._keychainProvider.keyIDLength + this._authProvider.nonceBits,
      );
      const blockData = payload.slice(
        this._keychainProvider.keyIDLength + this._authProvider.nonceBits,
      );

      let rawContent: Uint8Array | undefined;
      try {
        rawContent = await this._decryptBlock(
          blockKeyID,
          blockNonce,
          blockData,
        );
      } catch (e) {
        console.warn('Failed to decrypt key update message:', e);
      }

      if (!rawContent) {
        console.warn(
          `Unable to decrypt key update for ${this.documentPath}`,
        );
        return;
      }

      const message =
        this._syncMessageSerializer.deserializeSyncMessage(rawContent);

      // The shared V2 key-update handler already routes by the
      // length-prefixed document-path header and drops invalid headers;
      // this check is kept as a defense-in-depth guard against malformed
      // or misrouted messages.
      if (message.documentId && message.documentId !== this.documentPath) {
        console.warn(
          `Ignoring key-update for wrong document ` +
          `(${message.documentId} !== ${this.documentPath})`,
        );
        return;
      }

      // Verify the sender is an authorized writer.
      if (this._isSigningEnabled()) {
        if (message.signature) {
          const { signature, ...messageWithoutSignature } = message;
          const raw =
            this._syncMessageSerializer.serializeSyncMessage(
              messageWithoutSignature,
            );
          if (!(await this._verifyWriterSignature(raw, signature))) {
            console.warn(
              `Received key update with invalid signature for ${this.documentPath}`,
            );
            return;
          }
        } else {
          console.warn(
            `Received unsigned key update for ${this.documentPath}`,
          );
          return;
        }
      }

      console.log(`received key-update for ${this.documentPath}`);

      // Merge keychain changes.
      if (message.keychainChanges) {
        try {
          this._keychain.merge(message.keychainChanges);
          console.log(
            `Updated keychain via key-update protocol in ${this.documentPath}`,
          );
        } catch (e) {
          console.error(
            'Failed to merge keychain changes from key update:',
            e,
          );
        }
      }
    } catch (err: unknown) {
      console.error(
        `Error handling key update request for document ${this.documentPath}:`,
        err,
      );
    }
  }

}
