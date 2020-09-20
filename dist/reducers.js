"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.automergeSwarmReducer = exports.initialState = void 0;
const collabswarm_automerge_1 = require("@collabswarm/collabswarm-automerge");
const actions_1 = require("./actions");
exports.initialState = {
    node: new collabswarm_automerge_1.AutomergeSwarm(),
    documents: {},
    peers: []
};
function automergeSwarmReducer(state = exports.initialState, action) {
    switch (action.type) {
        // Initialization
        case actions_1.INITIALIZE: {
            // Changes happen within the node, force a change to redux by creating a new object.
            return Object.assign({}, state);
        }
        // Connection
        case actions_1.CONNECT: {
            // Changes happen within the node, force a change to redux by creating a new object.
            return Object.assign({}, state);
        }
        // Open Document (two options: 1. Overwrite the "current" document, 2. ???)
        case actions_1.OPEN_DOCUMENT: {
            if (state.documents[action.documentId]) {
                console.warn('Overwriting already open document:', action.documentId);
                console.warn('Action:', action);
                console.warn('State:', state);
            }
            const documents = Object.assign({}, state.documents);
            documents[action.documentId] = {
                documentRef: action.documentRef,
                document: action.documentRef.document
            };
            return Object.assign(Object.assign({}, state), { documents });
        }
        case actions_1.CLOSE_DOCUMENT: {
            if (!state.documents[action.documentId]) {
                console.warn('Trying to close a document that is not currently open:', action.documentId);
                console.warn('Action:', action);
                console.warn('State:', state);
                return state;
            }
            const documents = Object.assign({}, state.documents);
            delete documents[action.documentId];
            return Object.assign(Object.assign({}, state), { documents });
        }
        // Document Sync
        case actions_1.CHANGE_DOCUMENT:
        case actions_1.SYNC_DOCUMENT: {
            if (!state.documents[action.documentId]) {
                console.warn('Trying to sync document that is not open', action, state);
                return state;
            }
            const documents = Object.assign({}, state.documents);
            const documentState = Object.assign({}, documents[action.documentId]);
            documentState.document = action.document;
            documents[action.documentId] = documentState;
            return Object.assign(Object.assign({}, state), { documents });
        }
        case actions_1.PEER_CONNECT: {
            const currentPeers = new Set(state.peers);
            if (currentPeers.has(action.peerAddress)) {
                return state;
            }
            currentPeers.add(action.peerAddress);
            const peers = [...currentPeers];
            return Object.assign(Object.assign({}, state), { peers });
        }
        case actions_1.PEER_DISCONNECT: {
            const peers = state.peers.filter(addr => addr !== action.peerAddress);
            if (state.peers.length === peers.length) {
                return state;
            }
            return Object.assign(Object.assign({}, state), { peers });
        }
        default: {
            console.warn('Unrecognized action:', action);
            console.warn('Unrecognized action (state):', state);
            return state;
        }
    }
}
exports.automergeSwarmReducer = automergeSwarmReducer;
//# sourceMappingURL=reducers.js.map