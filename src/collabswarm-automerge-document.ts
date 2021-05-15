import pipe from "it-pipe";
import Libp2p from "libp2p";
import BufferList from "bl";
import { MessageHandlerFn } from "ipfs-core-types/src/pubsub";
import { Doc, init, Change, applyChanges, change, getChanges, getHistory } from "automerge";
import { AutomergeSwarm } from "./collabswarm-automerge";
import { shuffleArray } from "./utils";
import { AutomergeSwarmDocumentChangeHandler } from "./collabswarm-automerge-change-handlers";
import { AutomergeSwarmSyncMessage } from "./collabswarm-automerge-messages";

export class AutomergeSwarmDocument<T = any> {
  // Only store/cache the full automerge document.
  private _document: Doc<T> = init();
  get document(): Doc<T> {
    return this._document;
  }

  private _hashes = new Set<string>();

  private _pubsubHandler: MessageHandlerFn | undefined;

  private _remoteHandlers: { [id: string]: AutomergeSwarmDocumentChangeHandler } = {};
  private _localHandlers: { [id: string]: AutomergeSwarmDocumentChangeHandler } = {};

  public get libp2p(): Libp2p {
    return (this.swarm.ipfsNode as any).libp2p;
  }

  constructor(
    public readonly swarm: AutomergeSwarm,
    public readonly documentPath: string
  ) { }

  // https://gist.github.com/alanshaw/591dc7dd54e4f99338a347ef568d6ee9#duplex-it
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
          const docLoadConnection = await this.libp2p.dialProtocol(peer.addr.toString(), ['/collabswarm-automerge/doc-load/1.0.0']);
          return docLoadConnection.stream;
        } catch (err) {
          console.warn('Failed to load document from:', peer.addr.toString(), err);
        }
      }
    })();

    // TODO: Close connection upon receipt of data.
    if (stream) {
      console.log('Opening stream for /collabswarm-automerge/doc-load/1.0.0', stream);
      await pipe(
        stream,
        async source => {
          const assembled = await this.readUint8Iterable(source);
          const message = this.deserializeMessage(assembled);
          console.log('received /collabswarm-automerge/doc-load/1.0.0 response:', assembled, message);

          if (message.documentId === this.documentPath) {
            await this.sync(message);
          }

          // Return an ACK.
          return [];
        }
      );
      return true;
    } else {
      console.log('Failed to open document on any nodes.', this);
      return false;
    }
  }

  public async pin() {
    // Apply local change w/ automerge.
    const changes = getHistory(this.document).map(state => state.change);

    // Store changes in ipfs.
    const newFileResult = await this.swarm.ipfsNode.add(this.serializeChanges(changes));
    const hash = newFileResult.cid.toString();
    this._hashes.add(hash);

    // Send new message.
    const updateMessage: AutomergeSwarmSyncMessage = { documentId: this.documentPath, changes: { } };
    for (const oldHash of this._hashes) {
      updateMessage.changes[oldHash] = null;
    }
    updateMessage.changes[hash] = changes;

    if (!this.swarm.config) {
      throw 'Can not pin a file when the node has not been initialized'!;
    }
    this.swarm.ipfsNode.pubsub.publish(this.swarm.config.pubsubDocumentPublishPath, this.serializeMessage(updateMessage));
  }

  public async open(): Promise<boolean> {
    // Open pubsub connection.
    this._pubsubHandler = rawMessage => {
      const message = this.deserializeMessage(rawMessage.data);
      this.sync(message);
    }
    await this.swarm.ipfsNode.pubsub.subscribe(this.documentPath, this._pubsubHandler);

    // Make the messages on this specific to a document.
    this.libp2p.handle('/collabswarm-automerge/doc-load/1.0.0', ({ stream }) => {
      console.log('received /collabswarm-automerge/doc-load/1.0.0 dial');
      const loadMessage = {
        documentId: this.documentPath,
        changes: {},
      } as AutomergeSwarmSyncMessage;
      for (const hash of this._hashes) {
        loadMessage.changes[hash] = null;
      }

      const assembled = this.serializeMessage(loadMessage);
      console.log('sending /collabswarm-automerge/doc-load/1.0.0 response:', assembled, loadMessage);

      // Immediately send the connecting peer either the automerge.save'd document or a list of
      // hashes with the changes that are cached locally.
      pipe(
        [this.serializeMessage(loadMessage)],
        // [JSON.stringify(loadMessage)],
        stream,
        async (source: any) =>  {
          // Ignores responses.
          for await (const _ of source) { }
        }
      );
    });

    // Load initial document from peers.
    return await this.load();
  }

  public async close() {
    if (this._pubsubHandler) {
      await this.swarm.ipfsNode.pubsub.unsubscribe(this.documentPath, this._pubsubHandler);
    }
  }

  // HACK:
  public isBufferList(input: Uint8Array | BufferList): boolean {
    return !!Object.getOwnPropertySymbols(input).find((s) => {
      return String(s) === "Symbol(BufferList)";
    });
  }

  public async readUint8Iterable(iterable: AsyncIterable<Uint8Array | BufferList>): Promise<Uint8Array> {
    let length = 0;
    const chunks = [] as (Uint8Array | BufferList)[];
    for await (const chunk of iterable) {
      if (chunk) {
        chunks.push(chunk);
        length += chunk.length;
      }
    }

    let index = 0;
    const assembled = new Uint8Array(length);
    for (const chunk of chunks) {
      if (this.isBufferList(chunk)) {
        const bufferList = chunk as BufferList;
        for (let i = 0; i < bufferList.length; i++) {
          assembled.set([bufferList.readUInt8(i)], index + i);
        }
      } else {
        const arr = chunk as Uint8Array;
        assembled.set(arr, index);
      }
      index += chunk.length;
    }

    return assembled
  }

  public async getFile(hash: string): Promise<Change[]> {
    const assembled = await this.readUint8Iterable(this.swarm.ipfsNode.files.read(`/ipfs/${hash}`));
    const decoder = new TextDecoder();

    return this.deserializeChanges(decoder.decode(assembled));
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

  // Given a list of hashes, fetch missing update messages.
  public async sync(message: AutomergeSwarmSyncMessage) {
    // Only process hashes that we haven't seen yet.
    const newChangeEntries = Object.entries(message.changes).filter(([sentHash]) => sentHash && !this._hashes.has(sentHash));

    // First apply changes that were sent directly.
    let newDocument = this.document;
    const newDocumentHashes: string[] = [];
    const missingDocumentHashes: string[] = [];
    for (const [sentHash, sentChanges] of newChangeEntries) {
      if (sentChanges) {
        // Apply the changes that were sent directly.
        newDocument = applyChanges(newDocument, sentChanges);
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
        .then(missingChanges => {
          if (missingChanges) {
            this._document = applyChanges(this._document, missingChanges);
            this._hashes.add(missingHash);
            this._fireRemoteUpdateHandlers([missingHash]);
          } else {
            console.error(`'/ipfs/${missingHash}' returned nothing`, missingChanges);
          }
        })
        .catch(err => {
          console.error('Failed to fetch missing change from ipfs:', missingHash, err);
        });
    }
  }

  public subscribe(id: string, handler: AutomergeSwarmDocumentChangeHandler, originFilter: 'all' | 'remote' | 'local' = 'all') {
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

  public unsubscribe(id: string) {
    if (this._remoteHandlers[id]) {
      delete this._remoteHandlers[id];
    }
    if (this._localHandlers[id]) {
      delete this._localHandlers[id];
    }
  }

  public serializeMessage(message: AutomergeSwarmSyncMessage): Uint8Array {
    const encoder = new TextEncoder();
    return encoder.encode(JSON.stringify(message));
  }

  public deserializeMessage(message: Uint8Array): AutomergeSwarmSyncMessage {
    const decoder = new TextDecoder();
    const rawMessage = decoder.decode(message);
    try {
      return JSON.parse(rawMessage);
    } catch (err) {
      console.error("Failed to parse message:", rawMessage, message);
      throw err;
    }
  }

  public serializeChanges(changes: Change[]): string {
    return JSON.stringify(changes);
  }

  public deserializeChanges(changes: string): Change[] {
    return JSON.parse(changes);
  }

  public async change(changeFn: (doc: T) => void, message?: string) {
    // Apply local change w/ automerge.
    const newDocument = message ? change(this.document, message, changeFn) : change(this.document, changeFn);
    const changes = getChanges(this.document, newDocument);
    this._document = newDocument;

    // Store changes in ipfs.
    const newFileResult = await this.swarm.ipfsNode.add(this.serializeChanges(changes));
    const hash = newFileResult.cid.toString();
    this._hashes.add(hash);

    // Send new message.
    const updateMessage: AutomergeSwarmSyncMessage = { documentId: this.documentPath, changes: { } };
    for (const oldHash of this._hashes) {
      updateMessage.changes[oldHash] = null;
    }
    updateMessage.changes[hash] = changes;
    await this.swarm.ipfsNode.pubsub.publish(this.documentPath, this.serializeMessage(updateMessage));

    // Fire change handlers.
    this._fireLocalUpdateHandlers([hash]);
  }
}
