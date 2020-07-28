export const DEFAULT_CONFIG: AutomergeSwarmConfig = {
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
    }
  },

  pubsubDocumentPrefix: '/document/',
  pubsubDocumentPublishPath: '/documents'
};

export interface AutomergeSwarmConfig {
  ipfs: any;
  
  pubsubDocumentPrefix: string;
  pubsubDocumentPublishPath: string;
}
