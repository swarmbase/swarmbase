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

import IPFS from 'ipfs';
import Libp2p from 'libp2p';
import { AuthProvider } from './auth-provider';
import { CRDTProvider } from './crdt-provider';
import { CollabswarmConfig, DEFAULT_CONFIG } from './collabswarm-config';
import { IDResult } from 'ipfs-core-types/src/root';
import { CollabswarmDocument } from './collabswarm-document';
import { MessageSerializer } from './message-serializer';
import { ChangesSerializer } from './changes-serializer';

/**
 * Handler type for peer-connect and peer-disconnect events.
 *
 * Subscribe functions that match this type signature to track peer-connection/peer-disconnection events.
 */
export type CollabswarmPeersHandler = (
  address: string,
  connection: any,
) => void;

/**
 * The collabswarm object is the main entry point for the collabswarm library.
 *
 * @example
 * import { Collabswarm } from '@collabswarm/collabswarm';
 * import { AutomergeJSONSerializer, AutomergeProvider } from '@collabswarm/collabswarm-automerge';
 *
 * // Create the necessary providers and pass them to the collabswarm constructor.
 * const crdt = new AutomergeProvider();
 * const serializer = new AutomergeJSONSerializer();
 * const collabswarm = new Collabswarm(crdt, serializer, serializer);
 *
 * // Set the config for your collabswarm object and startup an IPFS node.
 * await collabswarm.initialize(config);
 *
 * // Connect to a swarm (an address of any member of the swarm works here).
 * await collabswarm.connect(["/some/libp2p/peer/address"]);
 *
 * // Open a document.
 * const doc1 = collabswarm.doc("/my-doc1-path");
 * @tparam DocType The CRDT document type
 * @tparam ChangesType A block of CRDT change(s)
 * @tparam ChangeFnType A function for applying changes to a document
 */
export class Collabswarm<
  DocType,
  ChangesType,
  ChangeFnType,
  PrivateKey, // TODO (eric) if it's here it's not per document?
  PublicKey,
  DocumentKey
  > {
  constructor(
    private readonly _crdtProvider: CRDTProvider<
      DocType,
      ChangesType,
      ChangeFnType
    >,
    private readonly _changesSerializer: ChangesSerializer<ChangesType>,
    private readonly _messageSerializer: MessageSerializer<ChangesType>,
    private readonly _authProvider: AuthProvider<
      PrivateKey,
      PublicKey,
      DocumentKey
    >,
  ) { }

  // configs for the swarm, thus passing its config to all documents opened in a swarm
  protected _config: CollabswarmConfig | null = null;
  private _ipfsNode: IPFS.IPFS | undefined;
  private _ipfsInfo: IDResult | undefined;
  private _peerAddrs: string[] = [];
  private _peerConnectHandlers: Map<string, CollabswarmPeersHandler> = new Map<
    string,
    CollabswarmPeersHandler
  >();
  private _peerDisconnectHandlers: Map<
    string,
    CollabswarmPeersHandler
  > = new Map<string, CollabswarmPeersHandler>();

  /**
   * Gets the current libp2p node instance.
   *
   * Only works after `.initialize()` has been called.
   */
  public get libp2p(): Libp2p {
    return (this.ipfsNode as any).libp2p;
  }

  /**
   * Gets the current IPFS node instance.
   *
   * Only works after `.initialize()` has been called.
   */
  public get ipfsNode(): IPFS.IPFS {
    if (this._ipfsNode) {
      return this._ipfsNode;
    }

    throw new Error('IPFS node not initialized yet!');
  }

  /**
   * Gets the current IPFS node info.
   *
   * Only works after `.initialize()` has been called.
   */
  public get ipfsInfo(): IDResult {
    if (this._ipfsInfo) {
      return this._ipfsInfo;
    }

    throw new Error('IPFS node not initialized yet!');
  }

  /**
   * Gets the current list of peers that this collabswarm node is connected to.
   */
  public get peerAddrs(): string[] {
    return this._peerAddrs;
  }

  /**
   * Gets the current collabswarm configuration.
   */
  public get config(): CollabswarmConfig | null {
    return this._config;
  }

  /**
   * Sets up the collabswarm node and starts its underlying IPFS/libp2p node.
   *
   * @param config General settings for collabswarm.
   */
  public async initialize(config: CollabswarmConfig = DEFAULT_CONFIG) {
    this._config = config;

    // Setup IPFS node.
    this._ipfsNode = await IPFS.create(config.ipfs);
    this.libp2p.connectionManager.on('peer:connect', (connection) => {
      const peerAddress = connection.remotePeer.toB58String();
      this._peerAddrs.push(peerAddress);
      for (const [, handler] of this._peerConnectHandlers) {
        handler(peerAddress, connection);
      }
    });
    this.libp2p.connectionManager.on('peer:disconnect', (connection) => {
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

  /**
   * Connects to a collabswarm swarm.
   *
   * An address of any peer of the desired swarm will work. Providing multiple addresses will cause
   * each to be connected to in sequence.
   *
   * @param addresses Peers that should be connected to identified by their address.
   */
  public async connect(addresses: string[]) {
    // Connect to bootstrapping node(s).
    const connectionPromises: Promise<any>[] = [];
    for (const address of addresses) {
      connectionPromises.push(this.ipfsNode.swarm.connect(address));
    }
    await Promise.all(connectionPromises);
  }

  /**
   * Opens a collabswarm document instance.
   *
   * @param documentPath Path identifying the document to open.
   * @returns The requested collabswarm document.
   */
  doc<T = any>(
    documentPath: string,
  ): CollabswarmDocument<
    DocType,
    ChangesType,
    ChangeFnType,
    PrivateKey,
    PublicKey,
    DocumentKey
  > | null {
    // Return new document reference.
    return new CollabswarmDocument( // TODO (eric) pass in initial DocumentKey here?
      this,
      documentPath,
      this._crdtProvider,
      this._authProvider,
      this._changesSerializer,
      this._messageSerializer,
    );
  }

  /**
   * Adds a handler that is run every time that a peer connects.
   *
   * @param handlerId An identifier used to unsubscribe the provided handler later.
   * @param handler A function that is run every time a peer connects.
   */
  subscribeToPeerConnect(handlerId: string, handler: CollabswarmPeersHandler) {
    this._peerConnectHandlers.set(handlerId, handler);
  }

  /**
   * Removes a peer-connect handler.
   *
   * @param handlerId The identifier of the handler to remove.
   */
  unsubscribeFromPeerConnect(handlerId: string) {
    this._peerConnectHandlers.delete(handlerId);
  }

  /**
   * Adds a handler that is run every time that a peer disconnects.
   *
   * @param handlerId An identifier used to unsubscribe the provided handler later.
   * @param handler A function that is run every time a peer disconnects.
   */
  subscribeToPeerDisconnect(
    handlerId: string,
    handler: CollabswarmPeersHandler,
  ) {
    this._peerDisconnectHandlers.set(handlerId, handler);
  }

  /**
   * Removes a peer-disconnect handler.
   *
   * @param handlerId The identifier of the handler to remove.
   */
  unsubscribeFromPeerDisconnect(handlerId: string) {
    this._peerDisconnectHandlers.delete(handlerId);
  }
}
