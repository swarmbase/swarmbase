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

/**
 * Default collabswarm config to use if none is provided.
 *
 * Note: This default configuration does not contain any other bootstrap nodes
 *       so upon startup this node will be in a swarm of one.
 */
export const defaultConfig = (bootstrapConfig: BootstrapInit) =>
  ({
    // NEW (ref: https://gist.github.com/bellbind/23ad8d6e3a1509335253ff074fcd3cb6)
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
    // OLD
    // relay: {
    //   enabled: true, // enable circuit relay dialer and listener
    //   // TODO: Is this necessary for browser nodes? I don't think they can actually function as a relay...
    //   hop: {
    //     enabled: true, // enable circuit relay HOP (make this node a relay)
    //   },
    // },
    // config: {
    //   Addresses: {
    //     Swarm: [],
    //   },
    //   Bootstrap: [],
    // },
    // /OLD
    // EVEN OLDER
    // libp2p: {
    //   config: {
    //     transport: {
    //       // This is added for local demo!
    //       // In a production environment the default filter should be used
    //       // where only DNS + WSS addresses will be dialed by websockets in the browser.
    //       [transportKey]: {
    //         filter: filters.all
    //       }
    //     }
    //   }
    // }
    // /EVEN OLDER
    // },

    pubsubDocumentPrefix: '/document/',
    pubsubDocumentPublishPath: '/documents',
  } as unknown as CollabswarmConfig);

/**
 * CollabswarmConfig is a settings object for collabswarm.
 */
export interface CollabswarmConfig {
  /**
   * Configuration for IPFS/libp2p.
   */
  ipfs?: HeliaInit;

  /**
   * Prefix to apply to newly created documents.
   */
  pubsubDocumentPrefix: string;

  /**
   * Prefix to apply to Libp2p PubSub topics for documents.
   */
  pubsubDocumentPublishPath: string;
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

// /**
//  * Creates a new collabswarm config with an added `.ipfs.config.Bootstrap` entry.
//  *
//  * @param clientConfig The config object to start with.
//  * @param address Entry to add to `.ipfs.config.Bootstrap`.
//  * @returns A new collabswarm config with the added bootstrap address.
//  */
// export function addBootstrapAddr(
//   clientConfig: CollabswarmConfig,
//   address: string,
// ): CollabswarmConfig {
//   return {
//     ...clientConfig,
//     ipfs: {
//       ...(clientConfig.ipfs || {}),
//       config: {
//         ...((clientConfig.ipfs && clientConfig.ipfs.config) || {}),
//         Bootstrap: [
//           ...((clientConfig.ipfs &&
//             clientConfig.ipfs.config &&
//             clientConfig.ipfs.config.Bootstrap) ||
//             []),
//           address,
//         ],
//       },
//     },
//   };
// }

// /**
//  * Creates a new collabswarm config with an added `.ipfs.config.Addresses.Swarm` entry.
//  *
//  * @param clientConfig The config object to start with.
//  * @param address Entry to add to `.ipfs.config.Addresses.Swarm`.
//  * @returns A new collabswarm config with the added swarm address.
//  */
// export function addSwarmAddr(
//   clientConfig: CollabswarmConfig,
//   address: string,
// ): CollabswarmConfig {
//   return {
//     ...clientConfig,
//     ipfs: {
//       ...(clientConfig.ipfs || {}),
//       config: {
//         ...((clientConfig.ipfs && clientConfig.ipfs.config) || {}),
//         Addresses: {
//           ...((clientConfig.ipfs &&
//             clientConfig.ipfs.config &&
//             clientConfig.ipfs.config.Addresses) ||
//             {}),
//           Swarm: [
//             ...((clientConfig.ipfs &&
//               clientConfig.ipfs.config &&
//               clientConfig.ipfs.config.Addresses &&
//               clientConfig.ipfs.config.Addresses.Swarm) ||
//               []),
//             address,
//           ],
//         },
//       },
//     },
//   };
// }
