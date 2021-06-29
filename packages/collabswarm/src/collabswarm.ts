/**
 * A Swarm is for opening documents
 * and it allows you to store your configuration in a single line when you use it as a library
 * 
 * Conceptually a "swarm" is a connected group of nodes
 * Not all collabswarm nodes will be connected to each other
 * 
 * basic config
 *   what the swarm name is
 *   at least one address to join
 */

import IPFS from "ipfs";
import Libp2p from "libp2p";
import { AuthProvider } from "./auth-provider";
import { CRDTProvider } from "./crdt-provider";
import { CRDTSyncMessage } from "./crdt-sync-message";
import { CollabswarmConfig, DEFAULT_CONFIG } from "./collabswarm-config";
import { IDResult } from "ipfs-core-types/src/root";
import { CollabswarmDocument } from "./collabswarm-document";
import { MessageSerializer } from "./message-serializer";
import { ChangesSerializer } from "./changes-serializer";

export type CollabswarmPeersHandler = (
  address: string,
  connection: any
) => void;

export class Collabswarm<
  DocType,
  ChangesType,
  ChangeFnType,
  MessageType extends CRDTSyncMessage<ChangesType>,
  PrivateKey, // TODO (eric) if it's here it's not per document?
  PublicKey,
  DocumentKey
> {
  // configs for the swarm, thus passing its config to all documents opened in a swarm
  protected _config: CollabswarmConfig | null = null;
  constructor(
    private readonly _crdtProvider: CRDTProvider<
    DocType,
    ChangesType,
    ChangeFnType,
    MessageType
    >,
    private readonly _changesSerializer: ChangesSerializer<ChangesType>,
    private readonly _messageSerializer: MessageSerializer<MessageType>,
    private readonly _authProvider: AuthProvider<
      PrivateKey,
      PublicKey,
      DocumentKey
    >
  ) {}
  private _ipfsNode: IPFS.IPFS | undefined;
  private _ipfsInfo: IDResult | undefined;
  private _peerAddrs: string[] = [];
  private _peerConnectHandlers: Map<string, CollabswarmPeersHandler> = new Map<
    string,
    CollabswarmPeersHandler
  >();
  private _peerDisconnectHandlers: Map<string, CollabswarmPeersHandler> =
    new Map<string, CollabswarmPeersHandler>();

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
  public get config(): CollabswarmConfig | null {
    return this._config;
  }

  public async initialize(config: CollabswarmConfig = DEFAULT_CONFIG) {
    this._config = config;

    // Setup IPFS node.
    this._ipfsNode = await IPFS.create(config.ipfs);
    this.libp2p.connectionManager.on("peer:connect", (connection) => {
      const peerAddress = connection.remotePeer.toB58String();
      this._peerAddrs.push(peerAddress);
      for (const [, handler] of this._peerConnectHandlers) {
        handler(peerAddress, connection);
      }
    });
    this.libp2p.connectionManager.on("peer:disconnect", (connection) => {
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
    console.log("IPFS node initialized:", this._ipfsInfo);
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
  doc<T = any>(
    documentPath: string
  ): CollabswarmDocument<
    DocType,
    ChangesType,
    ChangeFnType,
    MessageType,
    PrivateKey,
    PublicKey,
    DocumentKey
  > | null {
    // Return new document reference.
    return new CollabswarmDocument( // TODO (eric) pass in initial DocumentKey here?
      this,
      documentPath,
      this._crdtProvider,
      this._changesSerializer,  // TODO (eric) squiggly here
      this._messageSerializer,
      this._authProvider
    );
  }

  subscribeToPeerConnect(handlerId: string, handler: CollabswarmPeersHandler) {
    this._peerConnectHandlers.set(handlerId, handler);
  }

  unsubscribeFromPeerConnect(handlerId: string) {
    this._peerConnectHandlers.delete(handlerId);
  }

  subscribeToPeerDisconnect(
    handlerId: string,
    handler: CollabswarmPeersHandler
  ) {
    this._peerDisconnectHandlers.set(handlerId, handler);
  }

  unsubscribeFromPeerDisconnect(handlerId: string) {
    this._peerDisconnectHandlers.delete(handlerId);
  }
}
