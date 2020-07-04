import IPFS from "ipfs";
import { AutomergeSwarmDocument } from "./automerge-swarm-document";
import { AutomergeSwarmConfig, DEFAULT_CONFIG } from "./automerge-swarm-config";

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

  constructor(public readonly config: AutomergeSwarmConfig = DEFAULT_CONFIG) { }

  public async initialize() {
    // Setup IPFS node.
    this._ipfsNode = await IPFS.create(this.config.ipfs);
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
