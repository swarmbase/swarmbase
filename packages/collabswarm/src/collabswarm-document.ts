/**
 * Document  is just for opening documents right now
 * @remarks
 *   A document is part of a Swarm.
 *   Document keys are attached to a single document.
 */

import { pipe } from 'it-pipe';
import { Libp2p } from 'libp2p';
import { Collabswarm } from './collabswarm';
import {
  concatUint8Arrays,
  firstTrue,
  readUint8Iterable,
  shuffleArray,
} from './utils';
import { CRDTProvider } from './crdt-provider';
import { AuthProvider } from './auth-provider';
import {
  CRDTChangeNode,
  crdtChangeNodeDeferred,
  CRDTChangeNodeKind,
  crdtDocumentChangeNode,
  crdtReaderChangeNode,
  crdtWriterChangeNode,
} from './crdt-change-node';
import { CRDTSyncMessage } from './crdt-sync-message';
import { ChangesSerializer } from './changes-serializer';
import { SyncMessageSerializer } from './sync-message-serializer';
import { documentKeyUpdateV1, documentLoadV1, snapshotLoadV1 } from './wire-protocols';
import { CRDTSnapshotNode } from './snapshot-node';
import { CompactionConfig, defaultCompactionConfig } from './compaction-config';
import { documentTopic } from './document-topic';
import { ACLProvider } from './acl-provider';
import { KeychainProvider } from './keychain-provider';
import { LoadMessageSerializer } from './load-request-serializer';
import { CRDTLoadRequest } from './crdt-load-request';
import { Base64 } from 'js-base64';
import * as uuid from 'uuid';
import BufferList from 'bl';
import { Uint8ArrayList } from 'uint8arraylist';
import { CID } from 'multiformats';
import { UnixFS, unixfs } from '@helia/unixfs';
import { PubSubBaseProtocol } from '@libp2p/pubsub';
import { EventHandler, Message, PeerId, StreamHandler } from '@libp2p/interface';

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

  // List of document encryption keys. Lower index numbers mean more recent.
  // Since the document is created from change history, all keys are needed.
  private _keychain;

  // Controls what historical data new members receive when joining.
  private _historyVisibility: HistoryVisibility = 'current_only';

  // Tracks the epoch at which this node was invited to the document.
  // Used by `since_invited` history visibility to filter keychain history.
  // TODO: Wire this up during the BeeKEM Welcome flow so it is set when
  // a new member is onboarded.
  private _invitationEpoch: Uint8Array | undefined;

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
  // private _readersHashes = new Set<string>();
  // private _writersHashes = new Set<string>();

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

  // Cached pubsub topic string. Initialized in constructor via _computeTopic()
  // so that callers that invoke _makeChange() before open() (e.g. via load())
  // publish to a valid topic. open() recomputes this with the configured prefix.
  private _topic: string;

  // When the prefixed topic differs from the bare documentPath, we also
  // subscribe to the legacy (unprefixed) topic for backward compatibility
  // during rollout. This field is set in open() and used in close().
  private _legacyTopic: string | undefined;

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

  public get protocolLoadV1() {
    return `${documentLoadV1}${this.documentPath}`;
  }

  public get protocolKeyUpdateV1() {
    return `${documentKeyUpdateV1}${this.documentPath}`;
  }

  /**
   * Returns the versioned snapshot-load protocol string for this document.
   * Used to register and dial the `/collabswarm/snapshot-load/1.0.0` handler
   * scoped to this document's path.
   */
  public get protocolSnapshotLoadV1() {
    return `${snapshotLoadV1}${this.documentPath}`;
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
    const block = await this.swarm.heliaNode.blockstore.get(hash);
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

  private async _mergeSyncTree(
    remoteRootId: string | undefined,
    remoteRoot: CRDTChangeNode<ChangesType>,

    localRootId: string | undefined,
    localHashes: Set<string>,
  ): Promise<[string, CRDTChangeNodeKind, ChangesType | undefined][]> {
    if (remoteRootId === undefined) {
      return [];
    }

    // If remote root CID is the same as the current root CID, do nothing and return.
    if (remoteRootId === localRootId) {
      return [];
    }

    // If remote root CID is already in the set of seen CIDs, do nothing and return.
    if (localHashes.has(remoteRootId)) {
      return [];
    }

    // If this is a leaf node, return the current node pair.
    const results: Promise<
      [string, CRDTChangeNodeKind, ChangesType | undefined][]
    >[] = [
      Promise.resolve([[remoteRootId, remoteRoot.kind, remoteRoot.change]] as [
        string,
        CRDTChangeNodeKind,
        ChangesType | undefined,
      ][]),
    ];
    if (remoteRoot.children === undefined) {
      return (await Promise.all(results)).flat(1);
    }

    if (remoteRoot.children === crdtChangeNodeDeferred) {
      throw new Error('IPLD dereferencing is not supported yet!');
    }
    for (const [hash, currentNode] of Object.entries(remoteRoot.children)) {
      results.push(
        this._mergeSyncTree(hash, currentNode, localRootId, localHashes),
      );
    }

    return (await Promise.all(results)).flat(1);
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
            this._documentChangeCount++;
            this._changesSinceSnapshot++;
            break;
          }
          case crdtReaderChangeNode: {
            // Apply the changes that were sent directly.
            this._readers.merge(sentChanges);
            newDocumentHashes.push(sentHash);
            break;
          }
          case crdtWriterChangeNode: {
            // Apply the changes that were sent directly.
            this._writers.merge(sentChanges);
            newDocumentHashes.push(sentHash);
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
                  await this._fireRemoteUpdateHandlers([missingHash]);
                  return;
                }
                case crdtReaderChangeNode: {
                  this._readers.merge(missingChanges);
                  this._hashes.add(missingHash);
                  await this._fireRemoteUpdateHandlers([missingHash]);
                  return;
                }
                case crdtWriterChangeNode: {
                  this._writers.merge(missingChanges);
                  this._hashes.add(missingHash);
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
        this._writers.merge(node.change);
      } else if (node.kind === crdtReaderChangeNode) {
        this._readers.merge(node.change);
      }
    }
    if (node.children !== undefined && node.children !== crdtChangeNodeDeferred) {
      for (const child of Object.values(node.children)) {
        this._applyACLFromTree(child);
      }
    }
  }

  /**
   * Whether application-level signing is enabled for this document's swarm.
   * Centralizes the `enableSigning` config check to avoid drift across many call sites.
   */
  private _isSigningEnabled(): boolean {
    return this.swarm.config?.enableSigning !== false;
  }

  private async _verifyWriterSignature(raw: Uint8Array, signature: string) {
    if (!this._isSigningEnabled()) {
      return true;
    }

    // TODO: Cache list of current writers per dag node for now.
    const verificationTasks: Promise<boolean>[] = [];
    for (const writerKey of await this._writers.users()) {
      verificationTasks.push(
        this._authProvider.verify(
          raw,
          writerKey,
          this._deserializeSignature(signature),
        ),
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

    const verificationTasks: Promise<boolean>[] = [];
    for (const writerKey of await this._writers.users()) {
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

    const { signature: oldSignature, ...messageWithoutSignature } = message;

    const raw = this._syncMessageSerializer.serializeSyncMessage(
      messageWithoutSignature,
    );
    const rawSignature = await this._authProvider.sign(raw, this._userKey);
    return this._serializeSignature(rawSignature);
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
    // Ensure we have a valid topic. Normally set in open(), but guard
    // against callers that reach this path before open() completes.
    if (!this._topic) {
      this._topic = this._computeTopic();
    }

    // Store changes in blockstore.
    const hash = await this._putBlock(changes);
    this._hashes.add(hash);

    // Send new message.
    let updateMessage = this._createSyncMessage();
    const changeNode: CRDTChangeNode<ChangesType> = { kind, change: changes };
    if (updateMessage.changeId && updateMessage.changes) {
      // TODO: Add links to other part of change tree (See Merkle CRDT paper section VI.B.e).
      changeNode.children = {};
      changeNode.children[updateMessage.changeId] = updateMessage.changes;
    }
    updateMessage.changeId = hash;
    updateMessage.changes = changeNode;

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
   */
  private async _keychainChangesForVisibility(): Promise<ChangesType> {
    switch (this._historyVisibility) {
      case 'full_history':
        // Send ALL epoch keys -- for audit trails and regulatory compliance.
        return this._keychain.history();
      case 'since_invited':
        // TODO: Filter using _invitationEpoch when epoch-based keychain
        // filtering is fully wired. Falls back to full history for now.
        return this._keychain.history();
      case 'current_only':
      default:
        // Only send the current key -- most private option.
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
   * Prune the change tree in the last sync message to keep only the most recent
   * N change nodes. Nodes beyond the limit have their children removed, turning
   * them into leaf nodes. Old blocks remain in the Helia blockstore for peers
   * that already have them.
   *
   * @param keepCount Maximum number of change nodes to retain in the sync tree.
   */
  private _pruneChanges(keepCount: number) {
    if (keepCount <= 0) {
      // Pruning everything (including root) is destructive and nonsensical; skip.
      return;
    }
    if (!this._lastSyncMessage?.changes || !this._lastSyncMessage.changeId) {
      return;
    }

    // Recursively collect all ACL nodes from a subtree that is about to be pruned.
    // Re-attached ACL nodes are stored as leaf nodes (children stripped) so they
    // don't pull in the full pre-prune subtree through their parent pointers.
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
      `Pruned change tree for ${this.documentPath}: kept ${documentNodesVisited} document nodes of ${this._hashes.size} total nodes`,
    );
  }

  private _handleLoadRequest: StreamHandler = ({ stream }) => {
    console.log(`received ${this.protocolLoadV1} dial`);
    pipe(
      stream.source,
      async (source: AsyncIterable<Uint8ArrayList | Uint8Array>) => {
        const assembledRequest = await readUint8Iterable(source);
        const message =
          this._loadMessageSerializer.deserializeLoadRequest(assembledRequest);
        console.log(
          `received ${this.protocolLoadV1} request:`,
          assembledRequest,
          message,
        );

        if (message.documentId !== this.documentPath) {
          console.warn(
            `Received a load request for the wrong document (${message.documentId} !== ${this.documentPath})`,
          );
          await stream.sink([] as Iterable<Uint8Array>);
          return [];
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
            return [];
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
          return [];
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
          `sending ${this.protocolLoadV1} response (encrypted)`,
        );

        await stream.sink([assembled] as Iterable<Uint8Array>);
        return [];
      },
    ).catch((err: unknown) => {
      console.error(`Error handling ${this.protocolLoadV1} load request:`, err);
    });
  };

  private _handleSnapshotLoadRequest: StreamHandler = ({ stream }) => {
    console.log(`received ${this.protocolSnapshotLoadV1} dial`);
    pipe(
      stream.source,
      async (source: AsyncIterable<Uint8ArrayList | Uint8Array>) => {
        const assembledRequest = await readUint8Iterable(source);
        const message =
          this._loadMessageSerializer.deserializeLoadRequest(assembledRequest);
        console.log(
          `received ${this.protocolSnapshotLoadV1} request:`,
          assembledRequest,
          message,
        );

        if (message.documentId !== this.documentPath) {
          console.warn(
            `Received a snapshot load request for the wrong document (${message.documentId} !== ${this.documentPath})`,
          );
          await stream.sink([] as Iterable<Uint8Array>);
          return [];
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
            return [];
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
          return [];
        }

        if (!this._latestSnapshot) {
          // No snapshot available -- respond with empty payload so the peer
          // can fall back to the normal doc-load protocol.
          console.log(
            `No snapshot available for ${this.documentPath}, sending empty response`,
          );
          await stream.sink([] as Iterable<Uint8Array>);
          return [];
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
          `sending ${this.protocolSnapshotLoadV1} response (encrypted)`,
        );

        await stream.sink([assembled] as Iterable<Uint8Array>);
        return [];
      },
    ).catch((err: unknown) => {
      console.error(
        `Error handling ${this.protocolSnapshotLoadV1} snapshot load request:`,
        err,
      );
    });
  };

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
        const preLoadWriters = await this._writers.users();
        if (preLoadWriters.length > 0 && this._isSigningEnabled()) {
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
          const signatureBytes = this._deserializeSignature(signature);
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
   *   pubsub message sender). Matched against peers by extracting the PeerId
   *   component from their Multiaddr via `getPeerId()`.
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
        // Falling back to p.toString() would compare against the full
        // multiaddr string (e.g. "/ip4/.../p2p/<id>") which will never
        // match a plain PeerId string.
        const peerId = p.getPeerId?.();
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
        const snapshotStream = await this.libp2p.dialProtocol(peer, [
          this.protocolSnapshotLoadV1,
        ]);
        const loaded = await this._sendLoadRequestAndSync(snapshotStream, serializedRequest);
        if (loaded) return true;
        // Empty response -- peer has no snapshot, try doc-load below.
      } catch {
        // Peer doesn't support snapshot-load protocol.
      }

      try {
        console.log('Trying doc-load from peer:', peer.toString());
        const docStream = await this.libp2p.dialProtocol(peer, [
          this.protocolLoadV1,
        ]);
        const loaded = await this._sendLoadRequestAndSync(docStream, serializedRequest);
        if (loaded) return true;
      } catch (err) {
        console.warn(
          `Failed to load document from (${this.protocolLoadV1}): `,
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

    // Subscribe to pubsub topic and register protocol handlers.
    const pubsub = this.swarm.heliaNode.libp2p.services
      .pubsub as PubSubBaseProtocol;
    // Cast required: EventHandler<CustomEvent<Message>> is incompatible with PubSubBaseProtocol's
    // addEventListener due to duplicate @libp2p/interface versions in the dependency tree
    pubsub.addEventListener('message', this._pubsubHandler as EventListener);
    pubsub.subscribe(this._topic);

    // For backward compatibility during rollout, also subscribe to the legacy
    // (unprefixed) topic so we receive messages from peers that haven't upgraded.
    if (this._topic !== this.documentPath) {
      this._legacyTopic = this.documentPath;
      pubsub.subscribe(this._legacyTopic);
    }

    // For now we support multiple protocols, one per document path.
    // TODO: Consider moving this to a single shared handler in Collabswarm and route messages to the
    //       right document. This should be more efficient.
    this.libp2p.handle(this.protocolLoadV1, this._handleLoadRequest.bind(this));
    this.libp2p.handle(this.protocolKeyUpdateV1, this._handleKeyUpdateRequest.bind(this));
    // Snapshot-load protocol: load() tries this first for faster initial sync,
    // falling back to protocolLoadV1 if the peer doesn't support it or has no snapshot.
    this.libp2p.handle(this.protocolSnapshotLoadV1, this._handleSnapshotLoadRequest.bind(this));

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
      await this._writers.add(this._userPublicKey);

      // Add initial document key.
      console.log(`Adding a key to ${this.documentPath}`);
      await this._keychain.add();
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
    // Compute the topic to clean up. Prefer the cached value, but fall back
    // to computing it so cleanup works even if _topic was never set.
    const topic = this._topic || this._computeTopic();

    if (this._pubsubHandler) {
      const pubsub = this.swarm.heliaNode.libp2p.services
        .pubsub as PubSubBaseProtocol;
      pubsub.unsubscribe(topic);

      // Unsubscribe from the legacy (unprefixed) topic if we subscribed to it.
      if (this._legacyTopic) {
        pubsub.unsubscribe(this._legacyTopic);
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

    this._legacyTopic = undefined;

    // Unregister protocol handlers.
    await this.libp2p.unhandle(this.protocolLoadV1).catch(() => {});
    await this.libp2p.unhandle(this.protocolKeyUpdateV1).catch(() => {});
    await this.libp2p.unhandle(this.protocolSnapshotLoadV1).catch(() => {});
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

  // TODO: Unit tests for CollabswarmDocument require mocking libp2p, IPFS/Helia,
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
   * pubsub publish throws), internal metadata (`_hashes`,
   * `_lastSyncMessage`) may be left in an inconsistent state because
   * `_makeChange` mutates them before completing all steps. Compaction
   * counters (`_documentChangeCount`, `_changesSinceSnapshot`) are also
   * NOT rolled back. These partial mutations are not reversed.
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
   * `_documentChangeCount`, and `_changesSinceSnapshot` are restored from
   * snapshots captured before `_makeChange()`. For `_hashes`, all entries
   * added to the Set after `hashSizeBefore` are removed. Because the node
   * remains subscribed to pubsub during the async transaction, this may
   * include CIDs appended by concurrent remote syncs, not just local ones.
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
      this._pruneChanges(this._compactionConfig.keepRecentNodes);
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
    const changes = await this._writers.add(writer);

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
    const changes = await this._writers.remove(writer);

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
   * Add a new user as a valid reader. Users are identified by their public keys
   *
   * @param reader User's public key
   */
  public async addReader(reader: PublicKey) {
    await this._ensureCurrentUserCanWrite();

    // Check that the reader is not already a reader.
    if (await this._readers.check(reader)) {
      return;
    }

    // Send change over network.
    const changes = await this._readers.add(reader);
    await this._makeChange(changes, crdtReaderChangeNode);

    // TODO: Send document key to new reader via BeeKEM Welcome flow
    // or asymmetric encryption to reader's public key. Cannot use
    // _distributeKeyUpdate() because it encrypts with the existing
    // document key that the new reader doesn't yet possess.
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

    // Send to all connected peers via the key-update protocol.
    const peers = this.swarm.heliaNode.libp2p
      .getConnections()
      ?.map((x) => x.remoteAddr);

    // WARNING: If some peers fail to receive this update, they will be unable
    // to decrypt future messages encrypted with the new key. They will need to
    // perform a fresh document load to recover the keychain state.
    const failedPeers: string[] = [];
    for (const peer of peers) {
      try {
        const stream = await this.libp2p.dialProtocol(peer, [
          this.protocolKeyUpdateV1,
        ]);
        await pipe(
          [concatUint8Arrays(previousKeyID, nonce, data)],
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
   * Handle incoming key-update protocol messages.
   * Verifies the sender is an authorized writer, then merges the keychain changes.
   */
  private _handleKeyUpdateRequest: StreamHandler = ({ stream }) => {
    console.log(`received ${this.protocolKeyUpdateV1} dial`);
    pipe(
      stream.source,
      async (source: AsyncIterable<Uint8ArrayList | Uint8Array>) => {
        const assembled = await readUint8Iterable(source);

        // Decrypt the key update message.
        const blockKeyID = assembled.slice(
          0,
          this._keychainProvider.keyIDLength,
        );
        const blockNonce = assembled.slice(
          this._keychainProvider.keyIDLength,
          this._keychainProvider.keyIDLength + this._authProvider.nonceBits,
        );
        const blockData = assembled.slice(
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
          return [];
        }

        const message =
          this._syncMessageSerializer.deserializeSyncMessage(rawContent);

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
              return [];
            }
          } else {
            console.warn(
              `Received unsigned key update for ${this.documentPath}`,
            );
            return [];
          }
        }

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

        return [];
      },
    ).catch((err: unknown) => {
      console.error(
        `Error handling ${this.protocolKeyUpdateV1} request:`,
        err,
      );
    });
  };

  // public async pin() {
  //   // Apply local change w/ CRDT provider.
  //   const changes = this._crdtProvider.getHistory(this.document);

  //   // Store changes in ipfs.
  //   const newFileResult = await this.swarm.heliaNode.add(
  //     this._changesSerializer.serializeChanges(changes),
  //   );
  //   const hash = newFileResult.cid.toString();
  //   this._hashes.add(hash);

  //   // Send new message.
  //   const updateMessage = this._createSyncMessage();
  //   // updateMessage.changes[hash] = changes;

  //   if (!this.swarm.config) {
  //     throw 'Can not pin a file when the node has not been initialized'!;
  //   }
  //   this.swarm.heliaNode.pubsub.publish(
  //     this.swarm.config.pubsubDocumentPublishPath,
  //     this._syncMessageSerializer.serializeSyncMessage(updateMessage),
  //   );
  // }
}
