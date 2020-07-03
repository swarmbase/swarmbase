import { AutomergeSwarm } from "./automerge-swarm";
import { AutomergeSwarmDocument } from "./automerge-swarm-document";
import { AutomergeSwarmSyncMessage } from "./automerge-swarm-messages";

export class AutomergeSwarmNode {
  private _swarm = new AutomergeSwarm();
  public get swarm(): AutomergeSwarm {
    return this._swarm;
  }

  private readonly _subscriptions = new Map<string, AutomergeSwarmDocument>();
  private readonly _seenCids = new Set<string>();

  private _docPublishHandler: ((rawMessage: any) => void) | null = null;

  constructor(
    public readonly documentsPath = '/documents'
  ) {}

  // Start
  public async start() {
    await this.swarm.initialize();
    console.log('Node Addresses:', this.swarm.ipfsInfo.addresses);
    
    // Open a pubsub channel (set by some config) for controlling this swarm of listeners.
    // TODO: Add a '/document/<id>' prefix to all "normal" document paths.
    this._docPublishHandler = (rawMessage: any) => {
      try {
        const message = JSON.parse(rawMessage.data.toString()) as AutomergeSwarmSyncMessage;
        const docRef = this.swarm.doc(message.documentId);

        if (docRef) {
          // Also add a subscription that pins new received files.
          this._subscriptions.set(message.documentId, docRef);
          docRef.subscribe('pinning-handler', (doc, hashes) => {
            for (const cid of hashes) {
              if (!this._seenCids.has(cid)) {
                // TODO: Handle this operation failing (retry).
                this.swarm.ipfsNode.pin.add(cid);
                this._seenCids.add(cid);
              }
            }
          });
    
          // Listen to the file.
          docRef.open();
    
          // Pin all of the files that were received.
          for (const cid of Object.keys(message.changes)) {
            if (!this._seenCids.has(cid)) {
              // TODO: Handle this operation failing (retry).
              this.swarm.ipfsNode.pin.add(cid);
              this._seenCids.add(cid);
            }
          }
        } else {
          console.warn('Failed to process incoming document pin message:', rawMessage);
          console.warn('Unable to load document', message.documentId);
        }
      } catch (err) {
        console.error('Failed to process incoming document pin message:', rawMessage);
        console.error('Error:', err);
      }
    };
    await this.swarm.ipfsNode.pubsub.subscribe(this.documentsPath, this._docPublishHandler);
    console.log(`Listening for pinning requests on: ${this.documentsPath}`)
  }

  public stop() {
    if (this._docPublishHandler) {
      this.swarm.ipfsNode.pubsub.unsubscribe(this.documentsPath, this._docPublishHandler);
    }
    if (this._subscriptions) {
      for (const [id, ref] of this._subscriptions) {
        ref.unsubscribe('pinning-handler');
      }
    }
  }
}
  