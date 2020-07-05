import IPFS from "ipfs";
import pipe from "it-pipe";
import { Doc, init, Change, applyChanges, change, getChanges, getHistory } from "automerge";
import { AutomergeSwarm } from "./automerge-swarm";
import { shuffleArray } from "./utils";
import { AutomergeSwarmDocumentChangeHandler } from "./automerge-swarm-change-handlers";
import { AutomergeSwarmSyncMessage } from "./automerge-swarm-messages";

export class AutomergeSwarmDocument<T = any> {
  // Only store/cache the full automerge document.
  private _document: Doc<T> = init();
  get document(): Doc<T> {
    return this._document;
  }

  private _hashes = new Set<string>();

  private _remoteHandlers: { [id: string]: AutomergeSwarmDocumentChangeHandler } = {};
  private _localHandlers: { [id: string]: AutomergeSwarmDocumentChangeHandler } = {};

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

    let stream: any;
    for (const peer of shuffledPeers) {
      try {
        console.log('Selected peer addresses:', peer.addr.toString());
        const docLoadConnection = await this.swarm.ipfsNode.libp2p.dialProtocol(peer.addr.toString(), ['/automerge-swarm/doc-load/1.0.0']);
        stream = docLoadConnection.stream;
        break;
      } catch (err) {
        console.warn('Failed to load document from:', peer.addr.toString(), err);
      }
    }

    // TODO: Close connection upon receipt of data.
    if (stream) {
      console.log('Opening stream for /automerge-swarm/doc-load/1.0.0', stream);
      await pipe(
        stream,
        async (source: any) => {
          let rawMessage = "";

          // For each chunk of data
          for await (const chunk of source) {
            // TODO: Is this a full message or is a marker value needed?
            rawMessage += chunk.toString();
          }

          console.log('received /automerge-swarm/doc-load/1.0.0 response:', rawMessage);

          const message = JSON.parse(rawMessage) as AutomergeSwarmSyncMessage;
          await this.sync(message);

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
    const newFileResult = this.swarm.ipfsNode.add(JSON.stringify(changes));
    let newFile: any = null;
    for await (newFile of newFileResult) { }
    const hash = newFile.cid.toString() as string;
    this._hashes.add(hash);

    // Send new message.
    const updateMessage: AutomergeSwarmSyncMessage = { documentId: this.documentPath, changes: { } };
    for (const oldHash of this._hashes) {
      updateMessage.changes[oldHash] = null;
    }
    updateMessage.changes[hash] = changes;

    this.swarm.ipfsNode.pubsub.publish(this.swarm.config.pubsubDocumentPublishPath, IPFS.Buffer.from(JSON.stringify(updateMessage)));
  }

  public async open(): Promise<boolean> {
    // Open pubsub connection.
    // await this.swarm.ipfsNode.pubsub.subscribe(this.documentPath, this.sync.bind(this));
    await this.swarm.ipfsNode.pubsub.subscribe(this.documentPath, (rawMessage: any) => {
      const message = JSON.parse(rawMessage.data.toString()) as AutomergeSwarmSyncMessage;
      this.sync(message);
    });

    // TODO: Make the messages on this specific to a document.
    await this.swarm.ipfsNode.libp2p.handle('/automerge-swarm/doc-load/1.0.0', ({ stream }: any) => {
      console.log('received /automerge-swarm/doc-load/1.0.0 dial');
      const loadMessage = { changes: {} } as AutomergeSwarmSyncMessage;
      for (const hash of this._hashes) {
        loadMessage.changes[hash] = null;
      }

      // Immediately send the connecting peer either the automerge.save'd document or a list of
      // hashes with the changes that are cached locally.
      pipe(
        [JSON.stringify(loadMessage)],
        stream,
        async (source: any) =>  {
          // Ignores responses.
          for await (const _ of source) { }
        }
      );
    });

    // TODO ===================================================================
    // Load initial document from peers.
    // /TODO ==================================================================
    return await this.load();
  }

  public async close() {
    await this.swarm.ipfsNode.pubsub.unsubscribe(this.documentPath);
  }

  public async getFile(hash: string) {
    for await (const file of this.swarm.ipfsNode.get(hash)) {
      if (file.content) {
        const blocks = [] as any[];
        for await (const block of file.content) {
          blocks.push(block);
        }
        const content = IPFS.Buffer.concat(blocks);
        // TODO(r.chu): Should this store multiple changes per file?
        return JSON.parse(content) as Change[];
      }
    }

    return null;
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
      this._fireLocalUpdateHandlers(newDocumentHashes);
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

  public async change(changeFn: (doc: T) => void, message?: string) {
    // Apply local change w/ automerge.
    const newDocument = message ? change(this.document, message, changeFn) : change(this.document, changeFn);
    const changes = getChanges(this.document, newDocument);
    this._document = newDocument;

    // Store changes in ipfs.
    const newFileResult = this.swarm.ipfsNode.add(JSON.stringify(changes));
    let newFile: any = null;
    for await (newFile of newFileResult) { }
    const hash = newFile.cid.toString() as string;
    this._hashes.add(hash);

    // Send new message.
    const updateMessage: AutomergeSwarmSyncMessage = { documentId: this.documentPath, changes: { } };
    for (const oldHash of this._hashes) {
      updateMessage.changes[oldHash] = null;
    }
    updateMessage.changes[hash] = changes;
    await this.swarm.ipfsNode.pubsub.publish(this.documentPath, IPFS.Buffer.from(JSON.stringify(updateMessage)));

    // Fire change handlers.
    this._fireLocalUpdateHandlers([hash]);
  }
}
