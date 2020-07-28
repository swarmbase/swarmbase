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
        Swarm: [
          // '/ip4/127.0.0.1/tcp/9090/wss/p2p-webrtc-star',
          // '/dns4/star-signal.cloud.ipfs.team/tcp/443/wss/p2p-webrtc-star'
        ]
      },
      Bootstrap: [
        // '/ip4/127.0.0.1/tcp/4003/ws/p2p/Qmd9UZjcronq51wdeRWpNqH4K4dHpTwvaxVKuNtyd4nNa2'
      ],
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
