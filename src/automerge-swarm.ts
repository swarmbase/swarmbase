import IPFS from "ipfs";
import { AutomergeSwarmDocument } from "./automerge-swarm-document";

export class AutomergeSwarm {
  private _ipfsNode: any;
  private _ipfsInfo: any;
  private _peerAddrs: string[] = [];

  public get ipfsNode(): any {
    return this._ipfsNode;
  }
  public get ipfsInfo(): any {
    return this._ipfsInfo;
  }
  public get peerAddrs(): string[] {
    return this._peerAddrs;
  }

  public async initialize() {
    // Setup IPFS node.
    this._ipfsNode = await IPFS.create({
      relay: {
        enabled: true, // enable circuit relay dialer and listener
        hop: {
          enabled: true // enable circuit relay HOP (make this node a relay)
        }
      },
      config: {
        Addresses: {
          Swarm: [
            '/ip4/127.0.0.1/tcp/9090/wss/p2p-webrtc-star',
            // '/dns4/star-signal.cloud.ipfs.team/tcp/443/wss/p2p-webrtc-star'
          ]
        },
        Bootstrap: [
          '/ip4/127.0.0.1/tcp/4003/ws/ipfs/QmRgNzjTje3BvSYbfbVQzZV33cecsApBYrvVRfyZnjVRpj'
        ],
      }
    });
    this._ipfsNode.libp2p.connectionManager.on('peer:connect', (connection: any) => {
      this._peerAddrs.push(connection.remotePeer.toB58String());
    });
    this._ipfsNode.libp2p.connectionManager.on('peer:disconnect', (connection: any) => {
      const peerAddr = connection.remotePeer.toB58String();
      const peerIndex = this._peerAddrs.indexOf(peerAddr);
      if (peerIndex > 0) {
        this._peerAddrs.splice(peerIndex, 1);
      }
    });
    this._ipfsInfo = await this._ipfsNode.id();
    console.log('IPFS node initialized:', this._ipfsInfo);
  }

  // Initialize
  public async connect(addresses: string[]) {
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
  doc<T = any>(documentPath: string): AutomergeSwarmDocument<T> | null {
    // Return new document reference.
    return new AutomergeSwarmDocument(this, documentPath)
  }
}
