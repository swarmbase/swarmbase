"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DEFAULT_CONFIG = void 0;
exports.DEFAULT_CONFIG = {
    ipfs: {
        relay: {
            enabled: true,
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
//# sourceMappingURL=collabswarm-automerge-config.js.map