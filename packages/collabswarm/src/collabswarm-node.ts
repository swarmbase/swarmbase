import * as fs from 'fs';
import {
  CollabswarmConfig,
  defaultBootstrapConfig,
  defaultConfig,
} from './collabswarm-config';
import { Collabswarm } from './collabswarm';
import { CollabswarmDocument } from './collabswarm-document';
import { CRDTProvider } from './crdt-provider';
import { SyncMessageSerializer } from './sync-message-serializer';
import { ChangesSerializer } from './changes-serializer';
import { AuthProvider } from './auth-provider';
import { ACLProvider } from './acl-provider';
import { KeychainProvider } from './keychain-provider';
import { LoadMessageSerializer } from './load-request-serializer';
import { CRDTChangeNode, crdtChangeNodeDeferred } from './crdt-change-node';
import { CID } from 'multiformats';
import { EventHandler, Message } from '@libp2p/interface';
import { gossipsub } from '@chainsafe/libp2p-gossipsub';
import { autoNAT } from '@libp2p/autonat';
import { circuitRelayTransport } from '@libp2p/circuit-relay-v2';
import { identify } from '@libp2p/identify';
import { kadDHT } from '@libp2p/kad-dht';
import { pubsubPeerDiscovery } from '@libp2p/pubsub-peer-discovery';
import { webRTC, webRTCDirect } from '@libp2p/webrtc';
import { webSockets } from '@libp2p/websockets';
import { all } from '@libp2p/websockets/filters';
import { webTransport } from '@libp2p/webtransport';
import { IDBBlockstore } from 'blockstore-idb';
import { IDBDatastore } from 'datastore-idb';
import { ipnsSelector } from 'ipns/selector';
import { ipnsValidator } from 'ipns/validator';
import { bitswap } from '@helia/block-brokers';
import { yamux } from '@chainsafe/libp2p-yamux';
import { bootstrap, BootstrapInit } from '@libp2p/bootstrap';

export const defaultNodeConfig = (bootstrapConfig: BootstrapInit) =>
  ({
    helia: {
      blockstore: new IDBBlockstore('/collabswarm-blocks'),
      datastore: new IDBDatastore('/collabswarm-data'),
      blockBrokers: [bitswap()],
      libp2p: {
        // See: https://github.com/ipfs/helia/blob/main/packages/helia/src/utils/libp2p-defaults.browser.ts#L27
        addresses: {
          listen: ['/webrtc', '/wss', '/ws'],
        },
        transports: [
          circuitRelayTransport({
            reservationConcurrency: 1,
          }),
          webSockets({ filter: all }),
          webRTC(),
          webRTCDirect(),
          webTransport(),
          // https://github.com/libp2p/js-libp2p-websockets#libp2p-usage-example
          // circuitRelayTransport({ discoverRelays: 3 }),
        ],
        //streamMuxers: [mplex()],
        streamMuxers: [yamux()],
        peerDiscovery: [bootstrap(bootstrapConfig), pubsubPeerDiscovery()],
        services: {
          identify: identify(),
          autoNAT: autoNAT(),
          pubsub: gossipsub({
            allowPublishToZeroTopicPeers: true,
            emitSelf: false,
            canRelayMessage: true,
            globalSignaturePolicy: 'StrictSign',
          }),
          dht: kadDHT({
            clientMode: true,
            validators: { ipns: ipnsValidator },
            selectors: { ipns: ipnsSelector },
          }),
        },
        // https://github.com/libp2p/js-libp2p/blob/master/doc/CONFIGURATION.md#configuring-connection-gater
        connectionGater: { denyDialMultiaddr: async () => false },
      },
    },
    // ipfs: {
    //   relay: {
    //     enabled: true, // enable circuit relay dialer and listener
    //     hop: {
    //       enabled: true, // enable circuit relay HOP (make this node a relay)
    //     },
    //   },
    //   config: {
    //     Addresses: {
    //       Swarm: [
    //         '/ip4/0.0.0.0/tcp/4003/ws',
    //         '/ip4/0.0.0.0/tcp/4001',
    //         '/ip6/::/tcp/4002',
    //       ],
    //     },
    //     Bootstrap: [],
    //   },
    // },

    pubsubDocumentPrefix: '/document/',
    pubsubDocumentPublishPath: '/documents',
  // Cast required: libp2p sub-dependency types have version mismatches that prevent structural compatibility
  } as unknown as CollabswarmConfig);

export class CollabswarmNode<
  DocType,
  ChangesType,
  ChangeFnType,
  PrivateKey,
  PublicKey,
  DocumentKey,
> {
  private _swarm: Collabswarm<
    DocType,
    ChangesType,
    ChangeFnType,
    PrivateKey,
    PublicKey,
    DocumentKey
  >;
  public get swarm(): Collabswarm<
    DocType,
    ChangesType,
    ChangeFnType,
    PrivateKey,
    PublicKey,
    DocumentKey
  > {
    return this._swarm;
  }

  private readonly _subscriptions = new Map<
    string,
    CollabswarmDocument<
      DocType,
      ChangesType,
      ChangeFnType,
      PrivateKey,
      PublicKey,
      DocumentKey
    >
  >();
  private readonly _seenCids = new Set<string>();
  private readonly _pinningCids = new Set<string>();
  /** Queue of pending pin operations waiting for a concurrency slot. */
  private readonly _pinQueue: (() => void)[] = [];
  /** Number of pin operations currently in flight. */
  private _activePins = 0;
  /** Maximum concurrent pin operations to prevent overwhelming the blockstore. */
  private static readonly MAX_CONCURRENT_PINS = 10;

  private _docPublishHandler: EventHandler<CustomEvent<Message>> | null = null;

  constructor(
    private readonly nodeKey: PrivateKey,
    private readonly nodePublicKey: PublicKey,
    public readonly provider: CRDTProvider<DocType, ChangesType, ChangeFnType>,
    public readonly changesSerializer: ChangesSerializer<ChangesType>,
    public readonly syncMessageSerializer: SyncMessageSerializer<ChangesType, PublicKey>,
    public readonly loadMessageSerializer: LoadMessageSerializer,
    public readonly authProvider: AuthProvider<
      PrivateKey,
      PublicKey,
      DocumentKey
    >,
    private readonly aclProvider: ACLProvider<ChangesType, PublicKey>,
    private readonly keychainProvider: KeychainProvider<
      ChangesType,
      DocumentKey
    >,
    public readonly config: CollabswarmConfig,
  ) {
    this._swarm = new Collabswarm(
      this.nodeKey,
      this.nodePublicKey,
      this.provider,
      this.changesSerializer,
      this.syncMessageSerializer,
      this.loadMessageSerializer,
      this.authProvider,
      this.aclProvider,
      this.keychainProvider,
    );
  }

  /**
   * Acquire a concurrency slot for pin operations. Resolves when a slot
   * is available (at most MAX_CONCURRENT_PINS operations run at once).
   */
  private _acquirePinSlot(): Promise<void> {
    if (this._activePins < CollabswarmNode.MAX_CONCURRENT_PINS) {
      this._activePins++;
      return Promise.resolve();
    }
    return new Promise<void>((resolve) => {
      this._pinQueue.push(resolve);
    });
  }

  private _releasePinSlot(): void {
    const next = this._pinQueue.shift();
    if (next) {
      next();
    } else {
      this._activePins--;
    }
  }

  /**
   * Pin a single CID with concurrency limiting.
   */
  private async _pinCID(cid: string): Promise<void> {
    if (this._seenCids.has(cid) || this._pinningCids.has(cid)) {
      return;
    }
    let parsedCid: CID;
    try {
      parsedCid = CID.parse(cid);
    } catch (err) {
      console.error('Skipping malformed CID', cid, err);
      return;
    }
    this._pinningCids.add(cid);
    await this._acquirePinSlot();
    try {
      for await (const _ of this.swarm.heliaNode.pins.add(parsedCid)) { /* drain */ }
      this._seenCids.add(cid);
    } catch (err) {
      console.error('Failed to pin CID', cid, err);
    } finally {
      this._pinningCids.delete(cid);
      this._releasePinSlot();
    }
  }

  private async _pinNewCIDs(cid: string, node: CRDTChangeNode<ChangesType>) {
    const tasks: Promise<void>[] = [this._pinCID(cid)];

    if (node.children === crdtChangeNodeDeferred) {
      throw new Error('Currently IPLD deferred nodes are not supported!');
    }

    if (node.children !== undefined) {
      for (const [childHash, childNode] of Object.entries(node.children)) {
        tasks.push(this._pinNewCIDs(childHash, childNode));
      }
    }
    await Promise.all(tasks);
  }

  // Start
  public async start(boostrapAddresses?: string[]) {
    await this.swarm.initialize(this.config);
    const clientConfig = defaultConfig(
      defaultBootstrapConfig(boostrapAddresses ?? []),
    );
    const clientConfigFile =
      process.env.REACT_APP_CLIENT_CONFIG_FILE || 'client-config.env';
    fs.writeFile(
      clientConfigFile,
      `REACT_APP_CLIENT_CONFIG='${JSON.stringify(clientConfig)}'`,
      (err: NodeJS.ErrnoException | null) => {
        if (err) {
          console.error(`Failed to write ${clientConfigFile}:`, err);
        } else {
          console.log(`Wrote ${clientConfigFile}:`, clientConfig);
        }
      },
    );

    // Open a pubsub channel (set by some config) for controlling this swarm of listeners.
    this._docPublishHandler = (rawMessage) => {
      try {
        const thisNodeId = this.swarm.peerId.toString();
        const senderNodeId = (() => {
          switch (rawMessage.detail.type) {
            case 'signed':
              return rawMessage.detail.from.toString();
            default:
              return undefined;
          }
        })();

        if (thisNodeId !== senderNodeId) {
          const message = this.syncMessageSerializer.deserializeSyncMessage(
            rawMessage.detail.data,
          );
          console.log('Received Document Publish message:', rawMessage);
          const docRef = this.swarm.doc(message.documentId);

          if (docRef) {
            // Also add a subscription that pins new received files.
            this._subscriptions.set(message.documentId, docRef);
            docRef.subscribe(
              'pinning-handler',
              (doc, readers, writers, hashes) => {
                for (const cid of hashes) {
                  // _pinCID handles dedup, concurrency limiting, and error handling.
                  this._pinCID(cid).catch(() => {});
                }
              },
            );

            // Listen to the file.
            docRef.open();

            // Pin all of the files that were received.
            if (message.changeId && message.changes) {
              this._pinNewCIDs(message.changeId, message.changes).catch((err) => {
                console.error('Failed to pin CIDs for message:', message.changeId, err);
              });
            }
          } else {
            console.warn(
              'Failed to process incoming document pin message:',
              rawMessage,
            );
            console.warn('Unable to load document', message.documentId);
          }
        } else {
          console.log('Skipping publish message from this node...');
        }
      } catch (err) {
        console.error(
          'Failed to process incoming document pin message:',
          rawMessage,
        );
        console.error('Error:', err);
      }
    };
    // Cast required: EventHandler<CustomEvent<Message>> is incompatible with PubSubBaseProtocol's
    // addEventListener due to duplicate @libp2p/interface versions in the dependency tree
    this.swarm.heliaNode.libp2p.services.pubsub.addEventListener(
      'message',
      this._docPublishHandler as EventListener,
    );
    this.swarm.heliaNode.libp2p.services.pubsub.subscribe(
      this.config.pubsubDocumentPublishPath,
    );
    console.log(
      `Listening for pinning requests on: ${this.config.pubsubDocumentPublishPath}`,
    );
  }

  public stop() {
    if (this._docPublishHandler) {
      this.swarm.heliaNode.libp2p.services.pubsub.unsubscribe(
        this.config.pubsubDocumentPublishPath,
      );
      // Cast required: see addEventListener comment above
      this.swarm.heliaNode.libp2p.services.pubsub.removeEventListener(
        'message',
        this._docPublishHandler as EventListener,
      );
    }
    if (this._subscriptions) {
      for (const [id, ref] of this._subscriptions) {
        ref.unsubscribe('pinning-handler');
      }
    }
  }
}
