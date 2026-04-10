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

import { pipe } from 'it-pipe';
import { AuthProvider } from './auth-provider';
import { CRDTProvider } from './crdt-provider';
import {
  CollabswarmConfig,
  defaultConfig,
  defaultBootstrapConfig,
} from './collabswarm-config';
import { CollabswarmDocument } from './collabswarm-document';
import { NetworkStats } from './network-stats';
import { SyncMessageSerializer } from './sync-message-serializer';
import { ChangesSerializer } from './changes-serializer';
import { ACLProvider } from './acl-provider';
import { KeychainProvider } from './keychain-provider';
import { LoadMessageSerializer } from './load-request-serializer';
import {
  documentLoadV2, documentKeyUpdateV2, snapshotLoadV2,
} from './wire-protocols';
import { readUint8Iterable } from './utils';
import { createHelia, DefaultLibp2pServices } from 'helia';
import type { Helia } from '@helia/interface';
import { Libp2p } from 'libp2p';
import { PeerId } from '@libp2p/interface';
import { peerIdFromString } from '@libp2p/peer-id';
import { multiaddr } from '@multiformats/multiaddr';
import { PubSubBaseProtocol } from '@libp2p/pubsub';
import type { Uint8ArrayList } from 'uint8arraylist';

/** Maximum allowed document path length in key-update V2 wire format. */
export const MAX_DOCUMENT_PATH_LENGTH = 4096;

/** Maximum allowed request size for shared protocol handlers (10 MB). */
const MAX_REQUEST_SIZE = 10 * 1024 * 1024;

/** Minimal stream shape used by shared protocol handlers. */
interface ProtocolStream {
  source: AsyncIterable<Uint8ArrayList | Uint8Array>;
  sink: (data: Iterable<Uint8Array>) => Promise<void>;
  close?: () => void | Promise<void>;
}

/**
 * Handler type for peer-connect and peer-disconnect events.
 *
 * Subscribe functions that match this type signature to track peer-connection/peer-disconnection events.
 */
export type CollabswarmPeersHandler = (
  peerId: string,
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
 * // Set the config for your collabswarm object and startup a Helia node.
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
  PrivateKey,
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
    private readonly _syncMessageSerializer: SyncMessageSerializer<ChangesType, PublicKey>,
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
  private _heliaNode:
    | Helia<
        Libp2p<DefaultLibp2pServices & { pubsub: PubSubBaseProtocol }>
      >
    | undefined;
  private _peerId: PeerId | undefined;
  private _peerIds: string[] = [];
  private _peerConnectHandlers: Map<string, CollabswarmPeersHandler> = new Map<
    string,
    CollabswarmPeersHandler
  >();
  private _peerDisconnectHandlers: Map<string, CollabswarmPeersHandler> =
    new Map<string, CollabswarmPeersHandler>();
  private _networkStats?: NetworkStats;

  // Whether shared protocol handlers have already been registered via
  // _registerSharedProtocolHandlers(). Prevents duplicate registration
  // if initialize() is called more than once.
  private _sharedHandlersRegistered = false;

  // Registry of open documents keyed by document path. Shared protocol
  // handlers use this to route incoming stream requests to the correct
  // CollabswarmDocument instance.
  private _documentRegistry = new Map<
    string,
    CollabswarmDocument<DocType, ChangesType, ChangeFnType, PrivateKey, PublicKey, DocumentKey>
  >();

  /**
   * Network statistics tracker. Only available when `enableNetworkStats`
   * is set to `true` in the config passed to `initialize()`.
   */
  public get networkStats(): NetworkStats | undefined {
    return this._networkStats;
  }

  /**
   * Gets the current libp2p node instance.
   *
   * Only works after `.initialize()` has been called.
   */
  public get libp2p(): Libp2p {
    return this.heliaNode.libp2p;
  }

  /**
   * Gets the current Helia node instance.
   *
   * Only works after `.initialize()` has been called.
   */
  public get heliaNode(): Helia<
    Libp2p<DefaultLibp2pServices & { pubsub: PubSubBaseProtocol }>
  > {
    if (this._heliaNode) {
      return this._heliaNode;
    }

    throw new Error('Helia node not initialized yet!');
  }

  /**
   * Gets the current peer ID.
   *
   * Only works after `.initialize()` has been called.
   */
  public get peerId(): PeerId {
    if (this._peerId) {
      return this._peerId;
    }

    throw new Error('Helia node not initialized yet!');
  }

  /**
   * Gets the current list of peer IDs that this collabswarm node is connected to.
   */
  public get peerIds(): string[] {
    return this._peerIds;
  }

  /**
   * Gets the current collabswarm configuration.
   */
  public get config(): CollabswarmConfig | null {
    return this._config;
  }

  /**
   * Sets up the collabswarm node and starts its underlying Helia/libp2p node.
   *
   * @param config General settings for collabswarm.
   */
  public async initialize(config?: CollabswarmConfig) {
    if (this._documentRegistry.size > 0) {
      throw new Error(
        'Cannot reinitialize while documents are open. ' +
        'Close all documents before calling initialize() again.',
      );
    }

    // Tear down the previous Helia/libp2p instance if reinitializing,
    // preventing leaked background resources (connections, timers, etc.).
    if (this._heliaNode) {
      try { await this._heliaNode.stop(); } catch (err) { console.warn('Failed to stop previous Helia node during reinit:', err); }
      this._heliaNode = undefined;
      this._peerId = undefined;
      this._peerIds = [];
    }

    if (!config) {
      config = defaultConfig(defaultBootstrapConfig([]));
    }

    this._config = config;

    // Reset shared handler flag so re-initialization registers handlers on
    // the new libp2p node instance.
    this._sharedHandlersRegistered = false;

    this._networkStats = config.enableNetworkStats ? new NetworkStats() : undefined;

    // Setup Helia node.
    const heliaInit = config.helia;
    this._heliaNode = await (heliaInit
      ? (createHelia(heliaInit) as Promise<
          Helia<
            Libp2p<DefaultLibp2pServices & { pubsub: PubSubBaseProtocol }>
          >
        >)
      : (createHelia() as Promise<
          Helia<
            Libp2p<DefaultLibp2pServices & { pubsub: PubSubBaseProtocol }>
          >
        >));

    // Runtime guard: ensure the Helia node was initialized with a pubsub service.
    if (!this._heliaNode.libp2p.services.pubsub) {
      throw new Error('Helia node must be initialized with a pubsub service (e.g., gossipsub)');
    }

    // In libp2p v2, 'peer:connect'/'peer:disconnect' emit CustomEvent<PeerId>.
    // event.detail is a PeerId whose toString() returns the peer ID string.
    // Note: libp2p v3 changed this to emit Connection objects -- this must be
    // updated if libp2p is upgraded past v2.x.
    this.libp2p.addEventListener('peer:connect', (event) => {
      const peerId = event.detail.toString();
      this._peerIds.push(peerId);
      for (const [, handler] of this._peerConnectHandlers) {
        handler(peerId, event);
      }
    });
    this.libp2p.addEventListener('peer:disconnect', (event) => {
      const peerId = event.detail.toString();
      const peerIndex = this._peerIds.indexOf(peerId);
      if (peerIndex >= 0) {
        this._peerIds.splice(peerIndex, 1);
      }
      for (const [, handler] of this._peerDisconnectHandlers) {
        handler(peerId, event);
      }
    });
    this._peerId = this._heliaNode?.libp2p?.peerId;

    // Register shared protocol handlers that route incoming requests to
    // the appropriate document via the document registry. This replaces
    // per-document protocol handler registration, reducing protocol
    // handler overhead for multi-document applications.
    this._registerSharedProtocolHandlers();

    console.log('Helia node initialized:', this._peerId);
  }

  /**
   * Registers a document in the shared handler registry so incoming
   * protocol requests can be routed to it.
   *
   * Called by CollabswarmDocument.open().
   *
   * @internal
   */
  registerDocument(
    documentPath: string,
    document: CollabswarmDocument<DocType, ChangesType, ChangeFnType, PrivateKey, PublicKey, DocumentKey>,
  ): void {
    if (this._documentRegistry.has(documentPath)) {
      throw new Error(
        `A document is already registered for "${documentPath}". ` +
        'Multiple instances per path are not supported. Close the existing document first.',
      );
    }
    this._documentRegistry.set(documentPath, document);
  }

  /**
   * Removes a document from the shared handler registry.
   *
   * Instance-safe: only removes the entry if the registered document
   * matches the provided reference. This prevents a stale close()
   * from removing a live document that was re-opened at the same path.
   *
   * Called by CollabswarmDocument.close().
   *
   * @internal
   */
  unregisterDocument(
    documentPath: string,
    document: CollabswarmDocument<DocType, ChangesType, ChangeFnType, PrivateKey, PublicKey, DocumentKey>,
  ): void {
    if (this._documentRegistry.get(documentPath) === document) {
      this._documentRegistry.delete(documentPath);
    }
  }

  /**
   * Registers shared protocol handlers on libp2p for all three
   * protocols (doc-load, snapshot-load, key-update). Each handler reads
   * the incoming stream, extracts the document path, and routes to the
   * matching CollabswarmDocument instance in the registry.
   *
   * For doc-load and snapshot-load, the document path is extracted by
   * deserializing the CRDTLoadRequest from the stream data. For
   * key-update, a 4-byte length-prefixed document path header precedes
   * the encrypted payload.
   */
  private _registerSharedProtocolHandlers(): void {
    if (this._sharedHandlersRegistered) {
      return;
    }
    this._sharedHandlersRegistered = true;

    // Handler implementation for doc-load requests.
    const docLoadHandler = ({ stream }: { stream: ProtocolStream }) => {
      pipe(
        stream.source,
        async (source: AsyncIterable<Uint8ArrayList | Uint8Array>) => {
          try {
            let assembled: Uint8Array;
            try {
              assembled = await readUint8Iterable(source, MAX_REQUEST_SIZE);
            } catch (err) {
              const reason = err instanceof RangeError ? 'request too large' : 'failed to read request';
              console.warn(`Shared doc-load handler: ${reason}, dropping`);
              await stream.sink([] as Iterable<Uint8Array>);
              return [];
            }
            let request;
            try {
              request = this._loadMessageSerializer.deserializeLoadRequest(assembled);
            } catch (err) {
              console.warn(
                'Shared doc-load handler: failed to deserialize load request, dropping:',
                err,
              );
              await stream.sink([] as Iterable<Uint8Array>);
              return [];
            }
            const doc = this._documentRegistry.get(request.documentId);
            if (!doc) {
              console.warn(
                `Shared doc-load handler: no document registered for "${request.documentId}"`,
              );
              await stream.sink([] as Iterable<Uint8Array>);
              return [];
            }
            await doc.handleLoadRequestData(request, stream);
            return [];
          } finally {
            stream.close?.();
          }
        },
      ).catch((err: unknown) => {
        console.error('Error in shared doc-load handler:', err);
      });
    };

    // Handler implementation for snapshot-load requests.
    const snapshotLoadHandler = ({ stream }: { stream: ProtocolStream }) => {
      pipe(
        stream.source,
        async (source: AsyncIterable<Uint8ArrayList | Uint8Array>) => {
          try {
            let assembled: Uint8Array;
            try {
              assembled = await readUint8Iterable(source, MAX_REQUEST_SIZE);
            } catch (err) {
              const reason = err instanceof RangeError ? 'request too large' : 'failed to read request';
              console.warn(`Shared snapshot-load handler: ${reason}, dropping`);
              await stream.sink([] as Iterable<Uint8Array>);
              return [];
            }
            let request;
            try {
              request = this._loadMessageSerializer.deserializeLoadRequest(assembled);
            } catch (err) {
              console.warn(
                'Shared snapshot-load handler: failed to deserialize load request, dropping:',
                err,
              );
              await stream.sink([] as Iterable<Uint8Array>);
              return [];
            }
            const doc = this._documentRegistry.get(request.documentId);
            if (!doc) {
              console.warn(
                `Shared snapshot-load handler: no document registered for "${request.documentId}"`,
              );
              await stream.sink([] as Iterable<Uint8Array>);
              return [];
            }
            await doc.handleSnapshotLoadRequestData(request, stream);
            return [];
          } finally {
            stream.close?.();
          }
        },
      ).catch((err: unknown) => {
        console.error('Error in shared snapshot-load handler:', err);
      });
    };

    // Handler implementation for key-update requests. The stream data
    // is prefixed with a 4-byte big-endian length followed by the
    // UTF-8 document path. The remaining bytes are the encrypted
    // key-update payload.
    const keyUpdateHandler = ({ stream }: { stream: ProtocolStream }) => {
      pipe(
        stream.source,
        async (source: AsyncIterable<Uint8ArrayList | Uint8Array>) => {
          try {
            let assembled: Uint8Array;
            try {
              assembled = await readUint8Iterable(source, MAX_REQUEST_SIZE);
            } catch (err) {
              const reason = err instanceof RangeError ? 'request too large' : 'failed to read request';
              console.warn(`Shared key-update handler: ${reason}, dropping`);
              return [];
            }
            if (assembled.length < 4) {
              console.warn('Shared key-update handler: message too short');
              return [];
            }
            // Use unsigned right shift (>>> 0) to ensure the path length
            // is interpreted as an unsigned 32-bit integer.
            const pathLength =
              ((assembled[0] << 24) |
              (assembled[1] << 16) |
              (assembled[2] << 8) |
              assembled[3]) >>> 0;

            // Validate the path length header. If it looks invalid, treat the
            // message as malformed, log a warning, and drop it rather than
            // attempting to interpret it as a legacy (V1) payload.
            if (
              pathLength === 0 ||
              pathLength > MAX_DOCUMENT_PATH_LENGTH ||
              pathLength + 4 > assembled.length
            ) {
              console.warn(
                'Shared key-update handler: invalid path header (pathLength=' +
                pathLength + '), dropping message',
              );
              return [];
            }

            const documentPath = new TextDecoder().decode(
              assembled.slice(4, 4 + pathLength),
            );
            const payload = assembled.slice(4 + pathLength);
            const doc = this._documentRegistry.get(documentPath);
            if (!doc) {
              console.warn(
                `Shared key-update handler: no document registered for "${documentPath}"`,
              );
              return [];
            }
            await doc.handleKeyUpdateRequestData(payload);
            return [];
          } finally {
            // Key-update is fire-and-forget (no response via stream.sink),
            // but the inbound stream must still be closed to release resources.
            stream.close?.();
          }
        },
      ).catch((err: unknown) => {
        console.error('Error in shared key-update handler:', err);
      });
    };

    // Register shared protocol handlers. Each protocol ID uses a single
    // handler for all documents; the document path is extracted from the
    // stream payload for routing.
    this.libp2p.handle(documentLoadV2, docLoadHandler);
    this.libp2p.handle(snapshotLoadV2, snapshotLoadHandler);
    this.libp2p.handle(documentKeyUpdateV2, keyUpdateHandler);
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
      // Multiaddr strings start with '/'; bare peer IDs need conversion.
      // multiaddr() validates the address format and fails fast on invalid input.
      // Cast required: @multiformats/multiaddr types are structurally incompatible
      // with the version bundled in @libp2p/interface due to sub-dependency version
      // mismatches in the dependency tree.
      const dialTarget = address.startsWith('/')
        ? multiaddr(address) as any
        : peerIdFromString(address);
      connectionPromises.push(
        this.heliaNode.libp2p.dial(dialTarget),
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
    return new CollabswarmDocument(
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
