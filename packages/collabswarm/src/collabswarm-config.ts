import { HeliaInit } from 'helia';
import { yamux } from '@chainsafe/libp2p-yamux';
import { bootstrap, BootstrapInit } from '@libp2p/bootstrap';
import { pubsubPeerDiscovery } from '@libp2p/pubsub-peer-discovery';
import { circuitRelayTransport } from '@libp2p/circuit-relay-v2';
import { webRTC, webRTCDirect } from '@libp2p/webrtc';
import { webTransport } from '@libp2p/webtransport';
import { webSockets } from '@libp2p/websockets';
import { all } from '@libp2p/websockets/filters';
import { identify } from '@libp2p/identify';
import { autoNAT } from '@libp2p/autonat';
import { gossipsub } from '@chainsafe/libp2p-gossipsub';
import { kadDHT } from '@libp2p/kad-dht';
import { ipnsSelector } from 'ipns/selector';
import { ipnsValidator } from 'ipns/validator';
import { bitswap } from '@helia/block-brokers';
import { IDBDatastore } from 'datastore-idb';
import { IDBBlockstore } from 'blockstore-idb';
import { CompactionConfig } from './compaction-config';

/**
 * Default collabswarm config to use if none is provided.
 *
 * Note: This default configuration does not contain any other bootstrap nodes
 *       so upon startup this node will be in a swarm of one.
 */
export const defaultConfig = (bootstrapConfig: BootstrapInit) =>
  ({
    // Helia configuration (ref: https://gist.github.com/bellbind/23ad8d6e3a1509335253ff074fcd3cb6)
    helia: {
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

    pubsubDocumentPrefix: '/document/',
    pubsubDocumentPublishPath: '/documents',
  // Cast required: libp2p sub-dependency types have version mismatches that prevent structural compatibility
  } as unknown as CollabswarmConfig);

/**
 * CollabswarmConfig is a settings object for collabswarm.
 */
export interface CollabswarmConfig {
  /**
   * Configuration for Helia/libp2p.
   */
  helia?: HeliaInit;

  /**
   * Prefix to apply to newly created documents.
   */
  pubsubDocumentPrefix: string;

  /**
   * Prefix to apply to Libp2p PubSub topics for documents.
   */
  pubsubDocumentPublishPath: string;

  /**
   * Enable GossipSub topic validators for authorization enforcement.
   * When enabled, messages from unauthorized peers are rejected at the
   * transport layer (P4 penalty in peer scoring).
   *
   * Default: false (for backward compatibility).
   */
  enableTopicValidators?: boolean;

  /**
   * Enable cryptographic signing and verification of all messages.
   * When false, all signing paths are bypassed: sync message signatures,
   * load request signatures, topic validator signature checks, and
   * key update verification. Topic validators are not registered at all
   * when signing is disabled to avoid unnecessary per-message overhead.
   *
   * **WARNING: Disabling signing removes all authentication and authorization
   * checks. Any peer that can decrypt traffic (e.g., possesses a previous
   * document key) can forge sync, key-update, and load messages. Peers with
   * `enableSigning: false` will NOT interoperate with peers that have signing
   * enabled (they will reject empty/missing signatures). Only use in trusted
   * development/testing environments.**
   *
   * Default: true (signatures are computed and verified).
   */
  enableSigning?: boolean;

  /**
   * Configuration for history compaction.
   * When provided with `enabled: true`, the document will periodically
   * create snapshot nodes to compact the Merkle-DAG change history.
   */
  compaction?: Partial<CompactionConfig>;

  /**
   * Enable network statistics tracking.
   * When true, a `NetworkStats` counter container is created and accessible
   * via `collabswarm.networkStats`. Callers must invoke `record*()` methods
   * explicitly; automatic event wiring will be added in a follow-up.
   *
   * Default: false.
   */
  enableNetworkStats?: boolean;
}

/**
 * Default bootstrap configuration to use if none is provided.
 *
 * @param clientAddresses The list of bootstrap addresses to use.
 * @returns A BootstrapInit object with the provided addresses.
 */
export const defaultBootstrapConfig = (clientAddresses: string[]) =>
  ({
    list: clientAddresses,
  } as BootstrapInit);

/**
 * Returns a fresh default config with no bootstrap peers.
 *
 * Use this as a starting point for browser applications. Connect to peers
 * after initialization via `collabswarm.connect([relayMultiaddr])`.
 *
 * For configs with bootstrap peers baked in, use
 * `defaultConfig(defaultBootstrapConfig(['/ip4/.../ws/p2p/...']))` instead.
 *
 * Each call creates new IDB-backed blockstore/datastore instances so callers
 * can safely mutate the returned config without leaking state across
 * consumers. For shared/reused configs, store the result in a variable.
 *
 * **Note:** Lazily instantiated — safe to import in Node.js test environments
 * that lack IndexedDB as long as the function is not called.
 */
export function getDefaultConfig(): CollabswarmConfig {
  return defaultConfig(defaultBootstrapConfig([]));
}
