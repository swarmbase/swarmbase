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
    ipfs: {
      blockstore: new IDBBlockstore('/collabswarm-blocks'),
      datastore: new IDBDatastore('/collabswarm-data'),
      blockBrokers: [bitswap()],
      libp2p: {
        // https://github.com/ipfs/helia/blob/main/packages/helia/src/utils/libp2p-defaults.browser.ts#L27
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

  private _docPublishHandler: EventHandler<CustomEvent<Message>> | null = null;

  constructor(
    private readonly nodeKey: PrivateKey,
    private readonly nodePublicKey: PublicKey,
    public readonly provider: CRDTProvider<DocType, ChangesType, ChangeFnType>,
    public readonly changesSerializer: ChangesSerializer<ChangesType>,
    public readonly syncMessageSerializer: SyncMessageSerializer<ChangesType>,
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

  private async _pinNewCIDs(cid: string, node: CRDTChangeNode<ChangesType>) {
    if (!this._seenCids.has(cid)) {
      // TODO: Handle this operation failing (retry).
      // TODO: Does this need to be converted to a `CID` from a string first?
      const cidParsed = CID.parse(cid);
      this.swarm.ipfsNode.pins.add(cidParsed);
      this._seenCids.add(cid);
    }

    if (node.children === crdtChangeNodeDeferred) {
      throw new Error('Currently IPLD deferred nodes are not supported!');
    }

    const tasks: Promise<void>[] = [];
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
    // // TODO: Make this automatically generated by webrtc-star-signal (and integrate that into this).
    // const starSignalAddress = '/ip4/127.0.0.1/tcp/9090/wss/p2p-webrtc-star';
    // if (starSignalAddress) {
    //   clientConfig = addSwarmAddr(clientConfig, starSignalAddress.toString());
    // }
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
    // TODO: Add a '/document/<id>' prefix to all "normal" document paths.
    this._docPublishHandler = (rawMessage) => {
      try {
        const thisNodeId = this.swarm.ipfsInfo.toString();
        // const senderNodeId = rawMessage.from;
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
                  if (!this._seenCids.has(cid)) {
                    // TODO: Handle this operation failing (retry).
                    const parsedCid = CID.parse(cid);
                    this.swarm.ipfsNode.pins.add(parsedCid);
                    this._seenCids.add(cid);
                  }
                }
              },
            );

            // Listen to the file.
            docRef.open();

            // Pin all of the files that were received.
            if (message.changeId && message.changes) {
              this._pinNewCIDs(message.changeId, message.changes);
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
    this.swarm.ipfsNode.libp2p.services.pubsub.addEventListener(
      'message',
      this._docPublishHandler as EventListener,
    );
    this.swarm.ipfsNode.libp2p.services.pubsub.subscribe(
      this.config.pubsubDocumentPublishPath,
    );
    console.log(
      `Listening for pinning requests on: ${this.config.pubsubDocumentPublishPath}`,
    );
  }

  public stop() {
    if (this._docPublishHandler) {
      this.swarm.ipfsNode.libp2p.services.pubsub.unsubscribe(
        this.config.pubsubDocumentPublishPath,
      );
      this.swarm.ipfsNode.libp2p.services.pubsub.removeEventListener(
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
