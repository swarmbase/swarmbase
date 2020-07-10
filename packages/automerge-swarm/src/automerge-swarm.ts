import IPFS from "ipfs";
import { AutomergeSwarmDocument } from "./automerge-swarm-document";
import { AutomergeSwarmConfig, DEFAULT_CONFIG } from "./automerge-swarm-config";

export type AutomergeSwarmPeersHandler = (address: string, connection: any) => void;

export class AutomergeSwarm {
  private _ipfsNode: any;
  private _ipfsInfo: any;
  private _peerAddrs: string[] = [];
  private _peerConnectHandlers: Map<string, AutomergeSwarmPeersHandler> = new Map<string, AutomergeSwarmPeersHandler>();
  private _peerDisconnectHandlers: Map<string, AutomergeSwarmPeersHandler> = new Map<string, AutomergeSwarmPeersHandler>();

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
      const peerAddress = connection.remotePeer.toB58String();
      this._peerAddrs.push(peerAddress);
      for (const [handlerId, handler] of this._peerConnectHandlers) {
        handler(peerAddress, connection);
      }
    });
    this._ipfsNode.libp2p.connectionManager.on('peer:disconnect', (connection: any) => {
      const peerAddress = connection.remotePeer.toB58String();
      const peerIndex = this._peerAddrs.indexOf(peerAddress);
      if (peerIndex > 0) {
        this._peerAddrs.splice(peerIndex, 1);
      }
      for (const [handlerId, handler] of this._peerDisconnectHandlers) {
        handler(peerAddress, connection);
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

  subscribeToPeerConnect(handlerId: string, handler: AutomergeSwarmPeersHandler) {
    this._peerConnectHandlers.set(handlerId, handler);
  }
  
  unsubscribeFromPeerConnect(handlerId: string) {
    this._peerConnectHandlers.delete(handlerId);
  }

  subscribeToPeerDisconnect(handlerId: string, handler: AutomergeSwarmPeersHandler) {
    this._peerDisconnectHandlers.set(handlerId, handler);
  }
  
  unsubscribeFromPeerDisconnect(handlerId: string) {
    this._peerDisconnectHandlers.delete(handlerId);
  }
}
