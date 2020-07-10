import { AutomergeSwarm } from "./automerge-swarm";
import { AutomergeSwarmDocument } from "./automerge-swarm-document";
import { AutomergeSwarmSyncMessage } from "./automerge-swarm-messages";
import { AutomergeSwarmConfig } from "./automerge-swarm-config";

export const DEFAULT_NODE_CONFIG: AutomergeSwarmConfig = {
  ipfs: {
    relay: {
      enabled: true, // enable circuit relay dialer and listener
      hop: {
        enabled: true // enable circuit relay HOP (make this node a relay)
      }
    },
    config: {
      Addresses: {
        Swarm: [
          '/ip4/0.0.0.0/tcp/4003/ws',
          '/ip4/0.0.0.0/tcp/4001',
          '/ip6/::/tcp/4002'
        ]
      },
      Bootstrap: [],
    }
  },

  pubsubDocumentPrefix: '/document/',
  pubsubDocumentPublishPath: '/documents'
};

export class AutomergeSwarmNode {
  private _swarm = new AutomergeSwarm(this.config);
  public get swarm(): AutomergeSwarm {
    return this._swarm;
  }

  private readonly _subscriptions = new Map<string, AutomergeSwarmDocument>();
  private readonly _seenCids = new Set<string>();

  private _docPublishHandler: ((rawMessage: any) => void) | null = null;

  constructor(
    public readonly config: AutomergeSwarmConfig = DEFAULT_NODE_CONFIG
  ) {}

  // Start
  public async start() {
    await this.swarm.initialize();
    // console.log('Node Addresses:', this.swarm.ipfsInfo.addresses);
    
    // Open a pubsub channel (set by some config) for controlling this swarm of listeners.
    // TODO: Add a '/document/<id>' prefix to all "normal" document paths.
    this._docPublishHandler = (rawMessage: any) => {
      try {
        const thisNodeId = this.swarm.ipfsInfo.id.toString()
        const senderNodeId = rawMessage.from;

        if (thisNodeId !== senderNodeId) {
          const message = JSON.parse(rawMessage.data.toString()) as AutomergeSwarmSyncMessage;
          console.log('Received Document Publish message:', rawMessage);
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
        } else {
          console.log('Skipping publish message from this node...');
        }
      } catch (err) {
        console.error('Failed to process incoming document pin message:', rawMessage);
        console.error('Error:', err);
      }
    };
    await this.swarm.ipfsNode.pubsub.subscribe(this.config.pubsubDocumentPublishPath, this._docPublishHandler);
    console.log(`Listening for pinning requests on: ${this.config.pubsubDocumentPublishPath}`)
  }

  public stop() {
    if (this._docPublishHandler) {
      this.swarm.ipfsNode.pubsub.unsubscribe(this.config.pubsubDocumentPublishPath, this._docPublishHandler);
    }
    if (this._subscriptions) {
      for (const [id, ref] of this._subscriptions) {
        ref.unsubscribe('pinning-handler');
      }
    }
  }
}
  