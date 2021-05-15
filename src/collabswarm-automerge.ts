import IPFS from "ipfs";
import Libp2p from "libp2p";
import { AutomergeSwarmDocument } from "./collabswarm-automerge-document";
import { AutomergeSwarmConfig, DEFAULT_CONFIG } from "./collabswarm-automerge-config";
import { IDResult } from "ipfs-core-types/src/root";

export type AutomergeSwarmPeersHandler = (address: string, connection: any) => void;

export class AutomergeSwarm {
  protected _config: AutomergeSwarmConfig | null = null;
  private _ipfsNode: IPFS.IPFS | undefined;
  private _ipfsInfo: IDResult | undefined;
  private _peerAddrs: string[] = [];
  private _peerConnectHandlers: Map<string, AutomergeSwarmPeersHandler> = new Map<string, AutomergeSwarmPeersHandler>();
  private _peerDisconnectHandlers: Map<string, AutomergeSwarmPeersHandler> = new Map<string, AutomergeSwarmPeersHandler>();

  public get libp2p(): Libp2p {
    return (this.ipfsNode as any).libp2p;
  }
  public get ipfsNode(): IPFS.IPFS {
    if (this._ipfsNode) {
      return this._ipfsNode;
    }

    throw new Error("IPFS node not initialized yet!");
  }
  public get ipfsInfo(): IDResult {
    if (this._ipfsInfo) {
      return this._ipfsInfo;
    }

    throw new Error("IPFS node not initialized yet!");
  }
  public get peerAddrs(): string[] {
    return this._peerAddrs;
  }
  public get config(): AutomergeSwarmConfig | null {
    return this._config;
  }

  public async initialize(config: AutomergeSwarmConfig = DEFAULT_CONFIG) {
    this._config = config;

    // Setup IPFS node.
    this._ipfsNode = await IPFS.create(config.ipfs);
    this.libp2p.connectionManager.on('peer:connect', connection => {
      const peerAddress = connection.remotePeer.toB58String();
      this._peerAddrs.push(peerAddress);
      for (const [, handler] of this._peerConnectHandlers) {
        handler(peerAddress, connection);
      }
    });
    this.libp2p.connectionManager.on('peer:disconnect', connection => {
      const peerAddress = connection.remotePeer.toB58String();
      const peerIndex = this._peerAddrs.indexOf(peerAddress);
      if (peerIndex > 0) {
        this._peerAddrs.splice(peerIndex, 1);
      }
      for (const [, handler] of this._peerDisconnectHandlers) {
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
      connectionPromises.push(this.ipfsNode.swarm.connect(address));
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
