export const DEFAULT_CONFIG: CollabswarmConfig = {
  ipfs: {
    relay: {
      enabled: true, // enable circuit relay dialer and listener
      // TODO: Is this necessary for browser nodes? I don't think they can actually function as a relay...
      hop: {
        enabled: true // enable circuit relay HOP (make this node a relay)
      }
    },
    config: {
      Addresses: {
        Swarm: []
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

  pubsubDocumentPrefix: '/document/',
  pubsubDocumentPublishPath: '/documents',
  identity: new CryptoKeyPair
};

// TODO: Add user identity here (CryptoKey: https://developer.mozilla.org/en-US/docs/Web/API/CryptoKey)
export interface CollabswarmConfig {
  ipfs: any;
  
  pubsubDocumentPrefix: string;
  pubsubDocumentPublishPath: string;
  identity: CryptoKeyPair;
}
