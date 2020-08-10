"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.AutomergeSwarm = void 0;
const ipfs_1 = __importDefault(require("ipfs"));
const collabswarm_automerge_document_1 = require("./collabswarm-automerge-document");
const collabswarm_automerge_config_1 = require("./collabswarm-automerge-config");
class AutomergeSwarm {
    constructor() {
        this._config = null;
        this._peerAddrs = [];
        this._peerConnectHandlers = new Map();
        this._peerDisconnectHandlers = new Map();
    }
    get ipfsNode() {
        return this._ipfsNode;
    }
    get ipfsInfo() {
        return this._ipfsInfo;
    }
    get peerAddrs() {
        return this._peerAddrs;
    }
    get config() {
        return this._config;
    }
    initialize(config = collabswarm_automerge_config_1.DEFAULT_CONFIG) {
        return __awaiter(this, void 0, void 0, function* () {
            this._config = config;
            // Setup IPFS node.
            this._ipfsNode = yield ipfs_1.default.create(config.ipfs);
            this._ipfsNode.libp2p.connectionManager.on('peer:connect', (connection) => {
                const peerAddress = connection.remotePeer.toB58String();
                this._peerAddrs.push(peerAddress);
                for (const [handlerId, handler] of this._peerConnectHandlers) {
                    handler(peerAddress, connection);
                }
            });
            this._ipfsNode.libp2p.connectionManager.on('peer:disconnect', (connection) => {
                const peerAddress = connection.remotePeer.toB58String();
                const peerIndex = this._peerAddrs.indexOf(peerAddress);
                if (peerIndex > 0) {
                    this._peerAddrs.splice(peerIndex, 1);
                }
                for (const [handlerId, handler] of this._peerDisconnectHandlers) {
                    handler(peerAddress, connection);
                }
            });
            this._ipfsInfo = yield this._ipfsNode.id();
            console.log('IPFS node initialized:', this._ipfsInfo);
        });
    }
    // Initialize
    connect(addresses) {
        return __awaiter(this, void 0, void 0, function* () {
            // TODO ===================================================================
            // Listen for sync requests on libp2p channel:
            // https://stackoverflow.com/questions/53467489/ipfs-how-to-send-message-from-a-peer-to-another
            //   Respond with full document or just hashes (compare speed?)
            // /TODO ==================================================================
            // Connect to bootstrapping node(s).
            const connectionPromises = [];
            for (const address of addresses) {
                connectionPromises.push(this._ipfsNode.swarm.connect(address));
            }
            yield Promise.all(connectionPromises);
        });
    }
    // Open
    doc(documentPath) {
        // Return new document reference.
        return new collabswarm_automerge_document_1.AutomergeSwarmDocument(this, documentPath);
    }
    subscribeToPeerConnect(handlerId, handler) {
        this._peerConnectHandlers.set(handlerId, handler);
    }
    unsubscribeFromPeerConnect(handlerId) {
        this._peerConnectHandlers.delete(handlerId);
    }
    subscribeToPeerDisconnect(handlerId, handler) {
        this._peerDisconnectHandlers.set(handlerId, handler);
    }
    unsubscribeFromPeerDisconnect(handlerId) {
        this._peerDisconnectHandlers.delete(handlerId);
    }
}
exports.AutomergeSwarm = AutomergeSwarm;
//# sourceMappingURL=collabswarm-automerge.js.map