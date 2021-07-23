/**
 * Document  is just for opening documents right now
 * @remarks
 *   A document is part of a Swarm.
 *   Document keys are attached to a single document.
 */

import pipe from 'it-pipe';
import Libp2p from 'libp2p';
import { MessageHandlerFn } from 'ipfs-core-types/src/pubsub';
import { Collabswarm } from './collabswarm';
import { readUint8Iterable, shuffleArray } from './utils';
import { CRDTProvider } from './crdt-provider';
import { AuthProvider } from './auth-provider';
import { CRDTChangeNode, crdtChangeNodeDeferred, CRDTSyncMessage } from './crdt-sync-message';
import { ChangesSerializer } from './changes-serializer';
import { SyncMessageSerializer } from './sync-message-serializer';
import { documentLoadV1 } from './wire-protocols';
import { ACLProvider } from './acl-provider';
import { KeychainProvider } from './keychain-provider';
import { ACL } from './acl';
import { LoadMessageSerializer } from './load-request-serializer';
import { CRDTLoadRequest } from './crdt-load-request';

/**
 * Handler type for local-change (changes made on the current computer) and remote-change (changes made by a remote peer) events.
 *
 * Subscribe functions that match this type signature to track local-change/remote-change events.
 */
export type CollabswarmDocumentChangeHandler<DocType> = (
  current: DocType,
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
 * @example
 * // Open a document.
 * const doc1 = collabswarm.doc("/my-doc1-path");
 *
 * // Make a change to the CRDT document (example is written assuming the CRDT document is
 * // an automerge doc).
 * doc1.change(doc => {
 *   // After the change function is completed, this updated field `field1` will be sent
 *   // to all peers connected to the document.
 *   doc.field1 = "new-value";
 * });
 * @tparam DocType The CRDT document type
 * @tparam ChangesType A block of CRDT change(s)
 * @tparam ChangeFnType A function for applying changes to a document
 * @tparam PrivateKey The type of secret key used to identify a user (for writing)
 * @tparam PublicKey The type of key used to identify a user publicly
 * @tparam DocumentKey The type of key used to encrypt/decrypt document changes
 */
export class CollabswarmDocument<
  DocType,
  ChangesType,
  ChangeFnType,
  PrivateKey,
  PublicKey,
  DocumentKey
  > {
  // Only store/cache the full automerge document.
  private _document: DocType = this._crdtProvider.newDocument();
  get document(): DocType {
    return this._document;
  }

  // Last sync message (for populating load requests).
  private _lastSyncMessage?: CRDTSyncMessage<ChangesType>;

  // Document readers ACL.
  private _readers = this._aclProvider.initialize();

  // Document writers ACL.
  private _writers = this._aclProvider.initialize();

  // List of document encryption keys. Lower index numbers mean more recent.
  // Since the document is created from change history, all keys are needed.
  private _keychain = this._keychainProvider.initialize();

  // Set of already-merged change blocks.
  private _hashes = new Set<string>();
  private _readersHashes = new Set<string>();
  private _writersHashes = new Set<string>();

  // Handler for listening for sync messages on the document topic. Is `undefined` until
  // the document is `.open()`-ed.
  private _pubsubHandler: MessageHandlerFn | undefined;

  // Handlers registered by users of `CollabswarmDocument` that fire on remote changes.
  private _remoteHandlers: {
    [id: string]: CollabswarmDocumentChangeHandler<DocType>;
  } = {};

  // Handlers registered by users of `CollabswarmDocument` that fire on local changes.
  private _localHandlers: {
    [id: string]: CollabswarmDocumentChangeHandler<DocType>;
  } = {};

  public get libp2p(): Libp2p {
    return (this.swarm.ipfsNode as any).libp2p;
  }

  public get protocolLoadV1() {
    return `${documentLoadV1}/${this.documentPath}`;
  }

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
    private readonly _syncMessageSerializer: SyncMessageSerializer<ChangesType>,

    /**
     * LoadMessageSerializer is responsible for serializing/deserializing CRDTLoadMessages.
     */
    private readonly _loadMessageSerializer: LoadMessageSerializer,
  ) { }

  // Helpers ------------------------------------------------------------------

  private async _getBlock(hash: string): Promise<ChangesType> {
    const block = await this.swarm.ipfsNode.block.get(hash);
    return this._changesSerializer.deserializeChanges(block.data);
  }

  private async _mergeSyncTree(
    remoteRootId: string | undefined,
    remoteRoot: CRDTChangeNode<ChangesType>,

    localRootId: string | undefined,
    localHashes: Set<string>,
  ): Promise<[string, ChangesType | undefined][]> {
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
    if (remoteRoot.children === undefined) {
      return [[remoteRootId, remoteRoot.change]];
    }

    if (remoteRoot.children === crdtChangeNodeDeferred) {
      throw new Error("IPLD dereferencing is not supported yet!");
    }

    const results: Promise<[string, ChangesType | undefined][]>[] = [];
    for (const [hash, currentNode] of Object.entries(remoteRoot.children)) {
      results.push(this._mergeSyncTree(hash, currentNode, localRootId, localHashes));
    }

    return (await Promise.all(results)).flat(1);
  }

  private _fireRemoteUpdateHandlers(hashes: string[]) {
    for (const handler of Object.values(this._remoteHandlers)) {
      handler(this.document, hashes);
    }
  }
  private _fireLocalUpdateHandlers(hashes: string[]) {
    for (const handler of Object.values(this._localHandlers)) {
      handler(this.document, hashes);
    }
  }

  private _createSyncMessage(): CRDTSyncMessage<ChangesType> {
    const message: CRDTSyncMessage<ChangesType> = {
      ...(this._lastSyncMessage || {
        documentId: this.documentPath,
      }),
    };
    return message;
  }

  private async _syncDocumentChanges(changeId: string | undefined, changes: CRDTChangeNode<ChangesType>) {
    // Only process hashes that we haven't seen yet.
    const newChangeEntries = await this._mergeSyncTree(changeId, changes, this._lastSyncMessage && this._lastSyncMessage.changeId, this._hashes);

    // First apply changes that were sent directly.
    let newDocument = this.document;
    const newDocumentHashes: string[] = [];
    const missingDocumentHashes: string[] = [];
    for (const [sentHash, sentChanges] of newChangeEntries) {
      if (sentChanges) {
        // Apply the changes that were sent directly.
        newDocument = this._crdtProvider.remoteChange(newDocument, sentChanges);
        newDocumentHashes.push(sentHash);
      } else {
        missingDocumentHashes.push(sentHash);
      }
    }
    if (newDocumentHashes.length) {
      this._document = newDocument;
      for (const newHash of newDocumentHashes) {
        this._hashes.add(newHash);
      }
      this._fireRemoteUpdateHandlers(newDocumentHashes);
    }

    // Then apply missing hashes by fetching them via IPFS.
    for (const missingHash of missingDocumentHashes) {
      // Fetch missing hashes using IPFS.
      this._getBlock(missingHash)
        .then((missingChanges) => {
          if (missingChanges) {
            this._document = this._crdtProvider.remoteChange(
              this._document,
              missingChanges,
            );
            this._hashes.add(missingHash);
            this._fireRemoteUpdateHandlers([missingHash]);
          } else {
            console.error(
              `'/ipfs/${missingHash}' returned nothing`,
              missingChanges,
            );
          }
        })
        .catch((err) => {
          console.error(
            'Failed to fetch missing change from ipfs:',
            missingHash,
            err,
          );
        });
    }
  }

  private async _syncACLChanges(
    changeId: string | undefined,
    changes: CRDTChangeNode<ChangesType>,
    acl: ACL<ChangesType, PublicKey>,
    hashes: Set<string>,
  ) {
    // Only process hashes that we haven't seen yet.
    const newChangeEntries = await this._mergeSyncTree(changeId, changes, this._lastSyncMessage && this._lastSyncMessage.changeId, this._hashes);

    // First apply changes that were sent directly.
    const newDocumentHashes: string[] = [];
    const missingDocumentHashes: string[] = [];
    for (const [sentHash, sentChanges] of newChangeEntries) {
      if (sentChanges) {
        // Apply the changes that were sent directly.
        acl.merge(sentChanges);
        newDocumentHashes.push(sentHash);
      } else {
        missingDocumentHashes.push(sentHash);
      }
    }
    if (newDocumentHashes.length) {
      for (const newHash of newDocumentHashes) {
        hashes.add(newHash);
      }
      this._fireRemoteUpdateHandlers(newDocumentHashes);
    }

    // Then apply missing hashes by fetching them via IPFS.
    for (const missingHash of missingDocumentHashes) {
      // Fetch missing hashes using IPFS.
      this._getBlock(missingHash)
        .then((missingChanges) => {
          if (missingChanges) {
            acl.merge(missingChanges);
            hashes.add(missingHash);
            this._fireRemoteUpdateHandlers([missingHash]);
          } else {
            console.error(
              `'/ipfs/${missingHash}' returned nothing`,
              missingChanges,
            );
          }
        })
        .catch((err) => {
          console.error(
            'Failed to fetch missing change from ipfs:',
            missingHash,
            err,
          );
        });
    }
  }

  // API Methods --------------------------------------------------------------

  // https://gist.github.com/alanshaw/591dc7dd54e4f99338a347ef568d6ee9#duplex-it
  /**
   * Load sends a new load request to any connected peer (each peer is tried one at a time). The expected
   * response from a load request is a sync message containing all document change hashes.
   *
   * Load is used to fetch any new changes that a connecting node is missing.
   * @returns false if this is a new document (no peers exist).
   */
  // Key exchange happens during:
  // - Load messages.
  // - ACL updates via /collabswarm/key-update/1.0.0 protocol
  public async load(): Promise<boolean> {
    // Pick a peer.
    // TODO: In the future, try to re-use connections that already are open.
    const peers = await this.swarm.ipfsNode.swarm.peers();
    if (peers.length === 0) {
      return false;
    }

    // Shuffle peer array.
    const shuffledPeers = [...peers];
    shuffleArray(shuffledPeers);

    const stream = await (async () => {
      for (const peer of shuffledPeers) {
        try {
          console.log('Selected peer addresses:', peer.addr.toString());
          const docLoadConnection = await this.libp2p.dialProtocol(
            peer.addr.toString(),
            [this.protocolLoadV1],
          );
          return docLoadConnection.stream;
        } catch (err) {
          console.warn(
            'Failed to load document from:',
            peer.addr.toString(),
            err,
          );
        }
      }
    })();

    // See: https://stackoverflow.com/questions/53467489/ipfs-how-to-send-message-from-a-peer-to-another
    // TODO: Close connection upon receipt of data.
    if (stream) {
      console.log(`Opening stream for ${this.protocolLoadV1}`, stream);

      const encoder = new TextEncoder();
      const decoder = new TextDecoder();
      const signatureBytes = await this._authProvider.sign(
        encoder.encode(this.documentPath),
        this._userKey,
      );
      const signature = btoa(decoder.decode(signatureBytes));

      // Construct a load request.
      const loadRequest: CRDTLoadRequest = {
        documentId: this.documentPath,
        signature,
      };

      // Immediately send a load request.
      await pipe(
        [this._loadMessageSerializer.serializeLoadRequest(loadRequest)],
        stream,
        async (source: any) => {
          const assembled = await readUint8Iterable(source);
          const message = this._syncMessageSerializer.deserializeSyncMessage(
            assembled,
          );
          console.log(
            `received ${this.protocolLoadV1} response:`,
            assembled,
            message,
          );

          if (message.documentId === this.documentPath) {
            await this.sync(message);
          }

          // Return an ACK.
          return [];
        },
      );
      return true;
    } else {
      // Assume new document
      console.log('Failed to open document on any nodes.', this);
      return false;
    }
  }

  /**
   * Connects to a collabswarm document. Running this method connects to the document pubsub topic
   * and starts the document `.load()` process.
   *
   * Once opened, a document can be closed with `.close()`.
   *
   * @returns false if this is a new document (no peers exist).
   */
  public async open(): Promise<boolean> {
    // Open pubsub connection.
    this._pubsubHandler = (rawMessage) => {
      const message = this._syncMessageSerializer.deserializeSyncMessage(
        rawMessage.data,
      );
      this.sync(message);
    };
    await this.swarm.ipfsNode.pubsub.subscribe(
      this.documentPath,
      this._pubsubHandler,
    );

    // For now we support multiple protocols, one per document path.
    // TODO: Consider moving this to a single shared handler in Collabswarm and route messages to the
    //       right document. This should be more efficient.
    this.libp2p.handle(this.protocolLoadV1, ({ stream }) => {
      console.log(`received ${this.protocolLoadV1} dial`);
      pipe(stream, async (source) => {
        const assembledRequest = await readUint8Iterable(source);
        const message = this._loadMessageSerializer.deserializeLoadRequest(
          assembledRequest,
        );
        console.log(
          `received ${this.protocolLoadV1} response:`,
          assembledRequest,
          message,
        );

        if (message.documentId === this.documentPath) {
          console.warn(
            `Received a load request for the wrong document (${message.documentId} !== ${this.documentPath})`,
          );
          return [];
        }

        // Verify that this user is a reader.
        let requestor: PublicKey | undefined;
        for (const reader of await this._readers.users()) {
          const encoder = new TextEncoder();
          // TODO: Is this secure? Do we need a salt added to the signed payload?
          if (
            await this._authProvider.verify(
              encoder.encode(message.documentId),
              reader,
              encoder.encode(atob(message.signature)),
            )
          ) {
            requestor = reader;
            break;
          }
        }

        if (!requestor) {
          console.warn(
            `Detected an unauthorized load request for ${message.documentId}`,
          );
          return [];
        }

        // Since this is a load request, send document keys.
        const loadMessage = this._createSyncMessage();
        loadMessage.keychainChanges = this._keychain.history();

        const assembled = this._syncMessageSerializer.serializeSyncMessage(
          loadMessage,
        );
        console.log(
          `sending ${this.protocolLoadV1} response:`,
          assembled,
          loadMessage,
        );

        // Return a sync message.
        return [this._syncMessageSerializer.serializeSyncMessage(loadMessage)];
      });
    });

    // Load initial document from peers.
    return await this.load(); // new document would return false; then a key is needed
  }

  /**
   * Disconnects from this collabswarm document. Running this method disconnects from the
   * document pubsub topic.
   */
  public async close() {
    if (this._pubsubHandler) {
      await this.swarm.ipfsNode.pubsub.unsubscribe(
        this.documentPath,
        this._pubsubHandler,
      );
    }
  }

  /**
   * Given a sync message containing a list of hashes:
   * - Fetch new changes that are only hashes (missing change itself) from IPFS (using the hash).
   * - Apply new changes to the existing CRDT document.
   *
   * @param message A sync message to apply.
   */
  public async sync(message: CRDTSyncMessage<ChangesType>) {
    const syncTasks: Promise<void>[] = [];

    // Apply new ACL changes.
    if (message.readersChanges) {
      syncTasks.push(
        this._syncACLChanges(
          message.readersChangeId,
          message.readersChanges,
          this._readers,
          this._readersHashes,
        ),
      );
    }
    if (message.writersChanges) {
      syncTasks.push(
        this._syncACLChanges(
          message.writersChangeId,
          message.writersChanges,
          this._writers,
          this._writersHashes,
        ),
      );
    }

    // Update/replace list of document keys (if provided).
    if (message.keychainChanges) {
      this._keychain.merge(message.keychainChanges);
    }

    // Sync document changes.
    if (message.changes) {
      syncTasks.push(this._syncDocumentChanges(message.changeId, message.changes));
    }

    await Promise.all(syncTasks);
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
    handler: CollabswarmDocumentChangeHandler<DocType>,
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

  /**
   * Applies a new local change (defined by `changeFn`) to the collabswarm document and updates
   * all peers.
   *
   * @param changeFn A function that makes changes to the current CRDT document.
   * @param message An optional change message/description to include.
   */
  public async change(changeFn: ChangeFnType, message?: string) {
    const [newDocument, changes] = this._crdtProvider.localChange(
      this.document,
      message || '',
      changeFn,
    );
    // Apply local change w/ automerge.
    this._document = newDocument;

    // Store changes in ipfs.
    const newFileResult = await this.swarm.ipfsNode.block.put(
      this._changesSerializer.serializeChanges(changes),
    );
    const hash = newFileResult.cid.toString();
    this._hashes.add(hash);

    // Send new message.
    const updateMessage = this._createSyncMessage();
    const changeNode: CRDTChangeNode<ChangesType> = {
      change: changes,
    };
    if (updateMessage.changeId && updateMessage.changes) {
      // TODO: Add links to other part of change tree (See Merkle CRDT paper section VI.B.e).
      changeNode.children = {};
      changeNode.children[updateMessage.changeId] = updateMessage.changes;
    }
    updateMessage.changeId = hash;
    updateMessage.changes = changeNode;

    // TODO: Sign new message.

    this._lastSyncMessage = updateMessage;
    await this.swarm.ipfsNode.pubsub.publish(
      this.documentPath,
      this._syncMessageSerializer.serializeSyncMessage(updateMessage),
    );

    // Fire change handlers.
    this._fireLocalUpdateHandlers([hash]);
  }

  // public async pin() {
  //   // Apply local change w/ CRDT provider.
  //   const changes = this._crdtProvider.getHistory(this.document);

  //   // Store changes in ipfs.
  //   const newFileResult = await this.swarm.ipfsNode.add(
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
  //   this.swarm.ipfsNode.pubsub.publish(
  //     this.swarm.config.pubsubDocumentPublishPath,
  //     this._syncMessageSerializer.serializeSyncMessage(updateMessage),
  //   );
  // }
}
