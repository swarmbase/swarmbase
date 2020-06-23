import IPFS from "ipfs";
import { Doc, init, Change, getHistory, applyChanges, change, getChanges } from "automerge";

class AutomergeSwarm {
  private _ipfsNode: any;
  private _ipfsInfo: any;

  public get ipfsNode(): any {
    return this._ipfsNode;
  }
  public get ipfsInfo(): any {
    return this._ipfsInfo;
  }

  // Initialize
  async connect(addresses: string[]) {
    // Setup IPFS node.
    this._ipfsNode = await IPFS.create({
      config: {
        Addresses: {
          // TODO: Move these into method parameters.
          Swarm: [
            '/ip4/0.0.0.0/tcp/4012',       // This is the desktop/relay node?
            '/ip4/127.0.0.1/tcp/4013/ws'   // This is the signaling web-rtc-star server.
          ],
          API: '/ip4/127.0.0.1/tcp/5012',
          Gateway: '/ip4/127.0.0.1/tcp/9191'
        }
      }
    });
    this._ipfsInfo = await this._ipfsNode.id();
    console.log('IPFS node initialized:', this._ipfsInfo);

    // TODO ===================================================================
    // Listen for sync requests on libp2p channel:
    // https://stackoverflow.com/questions/53467489/ipfs-how-to-send-message-from-a-peer-to-another
    //   Respond with full document or just hashes (compare speed?)
    // /TODO ==================================================================
    
    // Connect to bootstrapping node(s).
    const connectionPromises: Promise<any>[] = [];
    for (const address of addresses) {
      connectionPromises.push(this._ipfsNode.swarm.connect(address));
    }
    await Promise.all(connectionPromises);
  }

  // Open
  async open(documentPath: string): Promise<AutomergeSwarmDocument | null> {
    if (!this._ipfsNode || !this._ipfsInfo) {
      return null;
    }

    // Return new document reference.
    return new AutomergeSwarmDocument(this, documentPath)
  }
}

type AutomergeSwarmDocumentChangeHandler<T = any> = (current: Doc<T>) => void;

class AutomergeSwarmDocument<T = any> {
  // Only store/cache the full automerge document.
  private _document: Doc<T> = init();
  get document(): Doc<T> {
    return this._document;
  }

  private _hashes = new Set<string>();

  // WARNING: This is a local cache of the hashes above ()

  private _remoteHandlers: { [id: string]: AutomergeSwarmDocumentChangeHandler } = {};
  private _localHandlers: { [id: string]: AutomergeSwarmDocumentChangeHandler } = {};

  constructor(
    public readonly swarm: AutomergeSwarm,
    public readonly documentPath: string
  ) {
    // Open pubsub connection.
    this.swarm.ipfsNode.pubsub.subscribe(documentPath, this.sync);

    // TODO ===================================================================
    // Load initial document from peers.
    // /TODO ==================================================================
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
    const messageData = JSON.parse(message.data.toString()) as AutomergeSwarmUpdateMessage;
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

  load() {
    // Listen for a new message or send a sync message to 1 or more peers over libp2p channel.
    //   sync when new hashes received.
    
    // Listen for new messages on pubsub channel.
    //   sync when new hashes received.
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
    const updateMessage: AutomergeSwarmUpdateMessage = { changes: { } };
    for (const oldHash of this._hashes) {
      updateMessage.changes[oldHash] = null;
    }
    updateMessage.changes[hash] = changes;
    await this.swarm.ipfsNode.pubsub.publish(this.documentPath, IPFS.Buffer.from(JSON.stringify(updateMessage)));

    // Fire change handlers.
    this._fireLocalUpdateHandlers();
  }

  close() {
    this.swarm.ipfsNode.pubsub.unsubscribe(this.documentPath);
  }
}

interface AutomergeSwarmUpdateMessage {
  // A null value just means that the change was not sent explicitly.
  changes: { [hash: string]: Change[] | null };
}

// Encoded using automerge.
type AutomergeSwarmLoadMessage = string;
