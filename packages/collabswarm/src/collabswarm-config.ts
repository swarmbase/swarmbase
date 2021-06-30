import { Options } from "ipfs-core";

/**
 * Default collabswarm config to use if none is provided.
 *
 * Note: This default configuration does not contain any other bootstrap nodes
 *       so upon startup this node will be in a swarm of one.
 */
export const DEFAULT_CONFIG: CollabswarmConfig = {
  ipfs: {
    relay: {
      enabled: true, // enable circuit relay dialer and listener
      // TODO: Is this necessary for browser nodes? I don't think they can actually function as a relay...
      hop: {
        enabled: true, // enable circuit relay HOP (make this node a relay)
      },
    },
    config: {
      Addresses: {
        Swarm: [],
      },
      Bootstrap: [],
    },
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
  },

  pubsubDocumentPrefix: "/document/",
  pubsubDocumentPublishPath: "/documents",
};

/**
 * CollabswarmConfig is a settings object for collabswarm.
 */
export interface CollabswarmConfig {
  /**
   * Configuration for IPFS/libp2p.
   */
  ipfs?: Options;

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
 * Creates a new collabswarm config with an added `.ipfs.config.Bootstrap` entry.
 *
 * @param clientConfig The config object to start with.
 * @param address Entry to add to `.ipfs.config.Bootstrap`.
 * @returns A new collabswarm config with the added bootstrap address.
 */
export function addBootstrapAddr(
  clientConfig: CollabswarmConfig,
  address: string
): CollabswarmConfig {
  return {
    ...clientConfig,
    ipfs: {
      ...(clientConfig.ipfs || {}),
      config: {
        ...((clientConfig.ipfs && clientConfig.ipfs.config) || {}),
        Bootstrap: [
          ...((clientConfig.ipfs &&
            clientConfig.ipfs.config &&
            clientConfig.ipfs.config.Bootstrap) ||
            []),
          address,
        ],
      },
    },
  };
}

/**
 * Creates a new collabswarm config with an added `.ipfs.config.Addresses.Swarm` entry.
 *
 * @param clientConfig The config object to start with.
 * @param address Entry to add to `.ipfs.config.Addresses.Swarm`.
 * @returns A new collabswarm config with the added swarm address.
 */
export function addSwarmAddr(
  clientConfig: CollabswarmConfig,
  address: string
): CollabswarmConfig {
  return {
    ...clientConfig,
    ipfs: {
      ...(clientConfig.ipfs || {}),
      config: {
        ...((clientConfig.ipfs && clientConfig.ipfs.config) || {}),
        Addresses: {
          ...((clientConfig.ipfs &&
            clientConfig.ipfs.config &&
            clientConfig.ipfs.config.Addresses) ||
            {}),
          Swarm: [
            ...((clientConfig.ipfs &&
              clientConfig.ipfs.config &&
              clientConfig.ipfs.config.Addresses &&
              clientConfig.ipfs.config.Addresses.Swarm) ||
              []),
            address,
          ],
        },
      },
    },
  };
}
