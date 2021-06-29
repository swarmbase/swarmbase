import pipe from "it-pipe";
import Libp2p from "libp2p";
import { MessageHandlerFn } from "ipfs-core-types/src/pubsub";
import { Collabswarm } from "./collabswarm";
import { readUint8Iterable, shuffleArray } from "./utils";
import { CRDTProvider } from "./crdt-provider";
import { CRDTSyncMessage } from "./crdt-sync-message";
import { ChangesSerializer } from "./changes-serializer";
import { MessageSerializer } from "./message-serializer";

/**
 * Handler type for local-change (changes made on the current computer) and remote-change (changes made by a remote peer) events.
 * 
 * Subscribe functions that match this type signature to track local-change/remote-change events.
 */
export type CollabswarmDocumentChangeHandler<DocType> = (
  current: DocType,
  hashes: string[]
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
 */
export class CollabswarmDocument<
  DocType,
  ChangesType,
  ChangeFnType,
  MessageType extends CRDTSyncMessage<ChangesType>
  > {
  // Only store/cache the full automerge document.
  private _document: DocType = this._provider.newDocument();
  get document(): DocType {
    return this._document;
  }

  private _hashes = new Set<string>();

  private _pubsubHandler: MessageHandlerFn | undefined;

  private _remoteHandlers: {
    [id: string]: CollabswarmDocumentChangeHandler<DocType>;
  } = {};
  private _localHandlers: {
    [id: string]: CollabswarmDocumentChangeHandler<DocType>;
  } = {};

  public get libp2p(): Libp2p {
    return (this.swarm.ipfsNode as any).libp2p;
  }

  constructor(
    public readonly swarm: Collabswarm<
      DocType,
      ChangesType,
      ChangeFnType,
      MessageType
    >,
    public readonly documentPath: string,
    private readonly _provider: CRDTProvider<
      DocType,
      ChangesType,
      ChangeFnType,
      MessageType
    >,
    private readonly _changesSerializer: ChangesSerializer<ChangesType>,
    private readonly _messageSerializer: MessageSerializer<MessageType>
  ) { }

  // https://gist.github.com/alanshaw/591dc7dd54e4f99338a347ef568d6ee9#duplex-it
  /**
   * Load sends a new load request to any connected peer (each peer is tried one at a time). The expected
   * response from a load request is a sync message containing all document change hashes.
   * 
   * Load is used to fetch any new changes that a connecting node is missing.
   * @returns false if this is a new document (no peers exist).
   */
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
          console.log("Selected peer addresses:", peer.addr.toString());
          const docLoadConnection = await this.libp2p.dialProtocol(
            peer.addr.toString(),
            ["/collabswarm-automerge/doc-load/1.0.0"]
          );
          return docLoadConnection.stream;
        } catch (err) {
          console.warn(
            "Failed to load document from:",
            peer.addr.toString(),
            err
          );
        }
      }
    })();

    // TODO: Close connection upon receipt of data.
    // See: https://stackoverflow.com/questions/53467489/ipfs-how-to-send-message-from-a-peer-to-another
    if (stream) {
      console.log(
        "Opening stream for /collabswarm-automerge/doc-load/1.0.0",
        stream
      );
      await pipe(stream, async (source) => {
        const assembled = await readUint8Iterable(source);
        const message = this._messageSerializer.deserializeMessage(assembled);
        console.log(
          "received /collabswarm-automerge/doc-load/1.0.0 response:",
          assembled,
          message
        );

        if (message.documentId === this.documentPath) {
          await this.sync(message);
        }

        // Return an ACK.
        return [];
      });
      return true;
    } else {
      console.log("Failed to open document on any nodes.", this);
      return false;
    }
  }

  public async pin() {
    // Apply local change w/ automerge.
    const changes = this._provider.getHistory(this.document);

    // Store changes in ipfs.
    const newFileResult = await this.swarm.ipfsNode.add(
      this._changesSerializer.serializeChanges(changes)
    );
    const hash = newFileResult.cid.toString();
    this._hashes.add(hash);

    // Send new message.
    const updateMessage = this._provider.newMessage(this.documentPath);
    for (const oldHash of this._hashes) {
      updateMessage.changes[oldHash] = null;
    }
    updateMessage.changes[hash] = changes;

    if (!this.swarm.config) {
      throw "Can not pin a file when the node has not been initialized"!;
    }
    this.swarm.ipfsNode.pubsub.publish(
      this.swarm.config.pubsubDocumentPublishPath,
      this._messageSerializer.serializeMessage(updateMessage)
    );
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
      const message = this._messageSerializer.deserializeMessage(
        rawMessage.data
      );
      this.sync(message);
    };
    await this.swarm.ipfsNode.pubsub.subscribe(
      this.documentPath,
      this._pubsubHandler
    );

    // Make the messages on this specific to a document.
    this.libp2p.handle(
      "/collabswarm-automerge/doc-load/1.0.0",
      ({ stream }) => {
        console.log("received /collabswarm-automerge/doc-load/1.0.0 dial");
        const loadMessage = this._provider.newMessage(this.documentPath);
        for (const hash of this._hashes) {
          loadMessage.changes[hash] = null;
        }

        const assembled = this._messageSerializer.serializeMessage(loadMessage);
        console.log(
          "sending /collabswarm-automerge/doc-load/1.0.0 response:",
          assembled,
          loadMessage
        );

        // Immediately send the connecting peer either the automerge.save'd document or a list of
        // hashes with the changes that are cached locally.
        pipe(
          [this._messageSerializer.serializeMessage(loadMessage)],
          stream,
          async (source: any) => {
            // Ignores responses.
            for await (const _ of source) {
            }
          }
        );
      }
    );

    // Load initial document from peers.
    return await this.load();
  }

  /**
   * Disconnects from this collabswarm document. Running this method disconnects from the
   * document pubsub topic.
   */
  public async close() {
    if (this._pubsubHandler) {
      await this.swarm.ipfsNode.pubsub.unsubscribe(
        this.documentPath,
        this._pubsubHandler
      );
    }
  }

  public async getFile(hash: string): Promise<ChangesType> {
    const assembled = await readUint8Iterable(
      this.swarm.ipfsNode.files.read(`/ipfs/${hash}`)
    );

    return this._changesSerializer.deserializeChanges(assembled);
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

  /**
   * Given a sync message containing a list of hashes:
   * - Fetch new changes that are only hashes (missing change itself) from IPFS (using the hash).
   * - Apply new changes to the existing CRDT document.
   * 
   * @param message A sync message to apply.
   */
  public async sync(message: MessageType) {
    // Only process hashes that we haven't seen yet.
    const newChangeEntries = Object.entries(message.changes).filter(
      ([sentHash]) => sentHash && !this._hashes.has(sentHash)
    );

    // First apply changes that were sent directly.
    let newDocument = this.document;
    const newDocumentHashes: string[] = [];
    const missingDocumentHashes: string[] = [];
    for (const [sentHash, sentChanges] of newChangeEntries) {
      if (sentChanges) {
        // Apply the changes that were sent directly.
        newDocument = this._provider.remoteChange(newDocument, sentChanges);
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
      this.getFile(missingHash)
        .then((missingChanges) => {
          if (missingChanges) {
            this._document = this._provider.remoteChange(
              this._document,
              missingChanges
            );
            this._hashes.add(missingHash);
            this._fireRemoteUpdateHandlers([missingHash]);
          } else {
            console.error(
              `'/ipfs/${missingHash}' returned nothing`,
              missingChanges
            );
          }
        })
        .catch((err) => {
          console.error(
            "Failed to fetch missing change from ipfs:",
            missingHash,
            err
          );
        });
    }
  }

  public subscribe(
    id: string,
    handler: CollabswarmDocumentChangeHandler<DocType>,
    originFilter: "all" | "remote" | "local" = "all"
  ) {
    switch (originFilter) {
      case "all": {
        this._remoteHandlers[id] = handler;
        this._localHandlers[id] = handler;
        break;
      }
      case "remote": {
        this._remoteHandlers[id] = handler;
        break;
      }
      case "local": {
        this._localHandlers[id] = handler;
        break;
      }
    }
  }

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
    const [newDocument, changes] = this._provider.localChange(
      this.document,
      message || "",
      changeFn
    );
    // Apply local change w/ automerge.
    this._document = newDocument;

    // Store changes in ipfs.
    const newFileResult = await this.swarm.ipfsNode.add(
      this._changesSerializer.serializeChanges(changes)
    );
    const hash = newFileResult.cid.toString();
    this._hashes.add(hash);

    // Send new message.
    const updateMessage = this._provider.newMessage(this.documentPath);
    for (const oldHash of this._hashes) {
      updateMessage.changes[oldHash] = null;
    }
    updateMessage.changes[hash] = changes;
    await this.swarm.ipfsNode.pubsub.publish(
      this.documentPath,
      this._messageSerializer.serializeMessage(updateMessage)
    );

    // Fire change handlers.
    this._fireLocalUpdateHandlers([hash]);
  }
}
