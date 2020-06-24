import IPFS from "ipfs";
import pipe from 'it-pipe';
import { Doc, init, Change, getHistory, applyChanges, change, getChanges } from "automerge";
import { AutomergeSwarmSyncMessage } from "./automerge-swarm-message";
import { AutomergeSwarm } from "./automerge-swarm";

export type AutomergeSwarmDocumentChangeHandler<T = any> = (current: Doc<T>) => void;

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
  async load() {
    // Pick a peer.
    // TODO: In the future, try to re-use connections that already are open.
    const peers = await this.swarm.ipfsNode.swarm.peers();
    // TODO: Improve this selection algorithm.
    const peerIndex = Math.floor(Math.random() * (peers.length - 1));
    const { stream } = await this.swarm.ipfsNode.libp2p.dialProtocol(peers[peerIndex]);
    // No need to send data, the handler will send data on stream init.

    // TODO: Close connection upon receipt of data.
    await pipe(
      stream,
      async (source: any) => {
        let rawMessage = "";

        // For each chunk of data
        for await (const chunk of source) {
          // TODO: Is this a full message or is a marker value needed?
          rawMessage += chunk.toString();
        }

        console.log('received /automerge-swarm/doc-load/1.0.0 dial:', rawMessage);

        const message = JSON.parse(rawMessage) as AutomergeSwarmSyncMessage;
        await this.sync(message);

        // Return an ACK.
        return [];
      }
    );
  }

  async open() {
    // Open pubsub connection.
    await this.swarm.ipfsNode.pubsub.subscribe(this.documentPath, this.sync);

    await this.swarm.ipfsNode.libp2p.handle('/automerge-swarm/doc-load/1.0.0', ({ stream }: any) => {
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
    await this.load();
  }

  async close() {
    await this.swarm.ipfsNode.pubsub.unsubscribe(this.documentPath);
  }

  async getFile(hash: string) {
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

  private _fireRemoteUpdateHandlers() {
    for (const handler of Object.values(this._remoteHandlers)) {
      handler(this.document);
    }
  }
  private _fireLocalUpdateHandlers() {
    for (const handler of Object.values(this._localHandlers)) {
      handler(this.document);
    }
  }

  // Given a list of hashes, fetch missing update messages.
  async sync(message: any) {
    // Get document history.
    const history = getHistory(this._document);
    const historyHashes = new Set<string>();
    for (const state of history) {
      if (state.change.message) {
        historyHashes.add(state.change.message);
      } else {
        console.error('Found a history state without a hash', state);
        console.error('Was syncing:', message);
      }
    }

    // Calculate set difference between hashes and doc history ids.
    const sender = message.from as string;
    const messageData = JSON.parse(message.data.toString()) as AutomergeSwarmSyncMessage;
    const messageHashes = Object.keys(messageData.changes);
    for (const [sentHash, sentChanges] of Object.entries(messageData.changes)) {
      if (sentHash && sentChanges) {
        this._document = applyChanges(this.document, sentChanges);
        this._hashes.add(sentHash);
        this._fireRemoteUpdateHandlers();
      }
    }

    // Fetch missing hashes using IPFS.
    const missingHashes = messageHashes.filter(x => messageData.changes[x] && !historyHashes.has(x));
    for (const missingHash of missingHashes) {
      this.getFile(missingHash)
        .then(missingChanges => {
          if (missingChanges) {
            this._document = applyChanges(this.document, missingChanges);
            this._hashes.add(missingHash);
            this._fireLocalUpdateHandlers();
          }
        })
        .catch(err => {
          console.error('Failed to fetch missing change from ipfs:', missingHash, err);
        });
    }
  }

  subscribe(id: string, handler: AutomergeSwarmDocumentChangeHandler, originFilter: 'all' | 'remote' | 'local' = 'all') {
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

  unsubscribe(id: string) {
    if (this._remoteHandlers[id]) {
      delete this._remoteHandlers[id];
    }
    if (this._localHandlers[id]) {
      delete this._localHandlers[id];
    }
  }

  async change(changeFn: (doc: T) => void, message?: string) {
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
    const updateMessage: AutomergeSwarmSyncMessage = { changes: { } };
    for (const oldHash of this._hashes) {
      updateMessage.changes[oldHash] = null;
    }
    updateMessage.changes[hash] = changes;
    await this.swarm.ipfsNode.pubsub.publish(this.documentPath, IPFS.Buffer.from(JSON.stringify(updateMessage)));

    // Fire change handlers.
    this._fireLocalUpdateHandlers();
  }
}
