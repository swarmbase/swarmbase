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

import { AuthProvider } from './auth-provider';
import { CRDTProvider } from './crdt-provider';
import {
  CollabswarmConfig,
  defaultConfig,
  defaultBootstrapConfig,
} from './collabswarm-config';
import { CollabswarmDocument } from './collabswarm-document';
import { SyncMessageSerializer } from './sync-message-serializer';
import { ChangesSerializer } from './changes-serializer';
import { ACLProvider } from './acl-provider';
import { KeychainProvider } from './keychain-provider';
import { LoadMessageSerializer } from './load-request-serializer';
import { createHelia, DefaultLibp2pServices } from 'helia';
import type { Helia } from '@helia/interface';
import { Libp2p } from 'libp2p';
import { PeerId } from '@libp2p/interface';
import { peerIdFromString } from '@libp2p/peer-id';
import { PubSubBaseProtocol } from '@libp2p/pubsub';

/**
 * Handler type for peer-connect and peer-disconnect events.
 *
 * Subscribe functions that match this type signature to track peer-connection/peer-disconnection events.
 */
export type CollabswarmPeersHandler = (
  address: string,
  connection: CustomEvent<PeerId>,
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
 * @typeParam DocType The CRDT document type
 * @typeParam ChangesType A block of CRDT change(s)
 * @typeParam ChangeFnType A function for applying changes to a document
 */
export class Collabswarm<
  DocType,
  ChangesType,
  ChangeFnType,
  PrivateKey, // TODO (eric) if it's here it's not per document?
  PublicKey,
  DocumentKey,
> {
  constructor(
    private readonly _userKey: PrivateKey,
    private readonly _userPublicKey: PublicKey,
    private readonly _crdtProvider: CRDTProvider<
      DocType,
      ChangesType,
      ChangeFnType
    >,
    private readonly _changesSerializer: ChangesSerializer<ChangesType>,
    private readonly _syncMessageSerializer: SyncMessageSerializer<ChangesType>,
    private readonly _loadMessageSerializer: LoadMessageSerializer,
    private readonly _authProvider: AuthProvider<
      PrivateKey,
      PublicKey,
      DocumentKey
    >,
    private readonly _aclProvider: ACLProvider<ChangesType, PublicKey>,
    private readonly _keychainProvider: KeychainProvider<
      ChangesType,
      DocumentKey
    >,
  ) {}

  // configs for the swarm, thus passing its config to all documents opened in a swarm
  protected _config: CollabswarmConfig | null = null;
  private _ipfsNode:
    | Helia<
        Libp2p<DefaultLibp2pServices & { pubsub: PubSubBaseProtocol }>
      >
    | undefined;
  private _ipfsInfo: PeerId | undefined;
  private _peerAddrs: string[] = [];
  private _peerConnectHandlers: Map<string, CollabswarmPeersHandler> = new Map<
    string,
    CollabswarmPeersHandler
  >();
  private _peerDisconnectHandlers: Map<string, CollabswarmPeersHandler> =
    new Map<string, CollabswarmPeersHandler>();

  /**
   * Gets the current libp2p node instance.
   *
   * Only works after `.initialize()` has been called.
   */
  public get libp2p(): Libp2p {
    return this.ipfsNode.libp2p;
  }

  /**
   * Gets the current IPFS node instance.
   *
   * Only works after `.initialize()` has been called.
   */
  public get ipfsNode(): Helia<
    Libp2p<DefaultLibp2pServices & { pubsub: PubSubBaseProtocol }>
  > {
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
  public get ipfsInfo(): PeerId {
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
  public async initialize(config?: CollabswarmConfig) {
    if (!config) {
      config = defaultConfig(defaultBootstrapConfig([]));
    }

    this._config = config;

    // Setup IPFS node.
    this._ipfsNode = await (config.ipfs
      ? (createHelia(config.ipfs) as Promise<
          Helia<
            Libp2p<DefaultLibp2pServices & { pubsub: PubSubBaseProtocol }>
          >
        >) // TODO: Is this correct?
      : (createHelia() as Promise<
          Helia<
            Libp2p<DefaultLibp2pServices & { pubsub: PubSubBaseProtocol }>
          >
        >));
    this.libp2p.addEventListener('peer:connect', (connection) => {
      const peerAddress = connection.detail.toString(); // TODO: Is this correct?
      this._peerAddrs.push(peerAddress);
      for (const [, handler] of this._peerConnectHandlers) {
        handler(peerAddress, connection);
      }
    });
    this.libp2p.addEventListener('peer:disconnect', (connection) => {
      const peerAddress = connection.detail.toString(); // TODO: Is this correct?
      const peerIndex = this._peerAddrs.indexOf(peerAddress);
      if (peerIndex > 0) {
        this._peerAddrs.splice(peerIndex, 1);
      }
      for (const [, handler] of this._peerDisconnectHandlers) {
        handler(peerAddress, connection);
      }
    });
    this._ipfsInfo = this._ipfsNode?.libp2p?.peerId;
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
    const connectionPromises: Promise<unknown>[] = [];
    for (const address of addresses) {
      connectionPromises.push(
        this.ipfsNode.libp2p.dial(peerIdFromString(address)),
      );
    }
    await Promise.all(connectionPromises);
  }

  /**
   * Opens a collabswarm document instance.
   *
   * @param documentPath Path identifying the document to open.
   * @returns The requested collabswarm document.
   */
  doc(
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
      this._userKey,
      this._userPublicKey,
      this._crdtProvider,
      this._authProvider,
      this._aclProvider,
      this._keychainProvider,
      this._changesSerializer,
      this._syncMessageSerializer,
      this._loadMessageSerializer,
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
