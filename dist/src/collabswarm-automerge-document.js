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
var __asyncValues = (this && this.__asyncValues) || function (o) {
    if (!Symbol.asyncIterator) throw new TypeError("Symbol.asyncIterator is not defined.");
    var m = o[Symbol.asyncIterator], i;
    return m ? m.call(o) : (o = typeof __values === "function" ? __values(o) : o[Symbol.iterator](), i = {}, verb("next"), verb("throw"), verb("return"), i[Symbol.asyncIterator] = function () { return this; }, i);
    function verb(n) { i[n] = o[n] && function (v) { return new Promise(function (resolve, reject) { v = o[n](v), settle(resolve, reject, v.done, v.value); }); }; }
    function settle(resolve, reject, d, v) { Promise.resolve(v).then(function(v) { resolve({ value: v, done: d }); }, reject); }
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.AutomergeSwarmDocument = void 0;
const ipfs_1 = __importDefault(require("ipfs"));
const it_pipe_1 = __importDefault(require("it-pipe"));
const automerge_1 = require("automerge");
const utils_1 = require("./utils");
class AutomergeSwarmDocument {
    constructor(swarm, documentPath) {
        this.swarm = swarm;
        this.documentPath = documentPath;
        // Only store/cache the full automerge document.
        this._document = automerge_1.init();
        this._hashes = new Set();
        this._remoteHandlers = {};
        this._localHandlers = {};
    }
    get document() {
        return this._document;
    }
    // https://gist.github.com/alanshaw/591dc7dd54e4f99338a347ef568d6ee9#duplex-it
    load() {
        return __awaiter(this, void 0, void 0, function* () {
            // Pick a peer.
            // TODO: In the future, try to re-use connections that already are open.
            const peers = yield this.swarm.ipfsNode.swarm.peers();
            if (peers.length === 0) {
                return false;
            }
            // Shuffle peer array.
            const shuffledPeers = [...peers];
            utils_1.shuffleArray(shuffledPeers);
            let stream;
            for (const peer of shuffledPeers) {
                try {
                    console.log('Selected peer addresses:', peer.addr.toString());
                    const docLoadConnection = yield this.swarm.ipfsNode.libp2p.dialProtocol(peer.addr.toString(), ['/collabswarm-automerge/doc-load/1.0.0']);
                    stream = docLoadConnection.stream;
                    break;
                }
                catch (err) {
                    console.warn('Failed to load document from:', peer.addr.toString(), err);
                }
            }
            // TODO: Close connection upon receipt of data.
            if (stream) {
                console.log('Opening stream for /collabswarm-automerge/doc-load/1.0.0', stream);
                yield it_pipe_1.default(stream, (source) => { var source_1, source_1_1; return __awaiter(this, void 0, void 0, function* () {
                    var e_1, _a;
                    let rawMessage = "";
                    try {
                        // For each chunk of data
                        for (source_1 = __asyncValues(source); source_1_1 = yield source_1.next(), !source_1_1.done;) {
                            const chunk = source_1_1.value;
                            // TODO: Is this a full message or is a marker value needed?
                            rawMessage += chunk.toString();
                        }
                    }
                    catch (e_1_1) { e_1 = { error: e_1_1 }; }
                    finally {
                        try {
                            if (source_1_1 && !source_1_1.done && (_a = source_1.return)) yield _a.call(source_1);
                        }
                        finally { if (e_1) throw e_1.error; }
                    }
                    console.log('received /collabswarm-automerge/doc-load/1.0.0 response:', rawMessage);
                    const message = JSON.parse(rawMessage);
                    if (message.documentId === this.documentPath) {
                        yield this.sync(message);
                    }
                    // Return an ACK.
                    return [];
                }); });
                return true;
            }
            else {
                console.log('Failed to open document on any nodes.', this);
                return false;
            }
        });
    }
    pin() {
        var e_2, _a;
        return __awaiter(this, void 0, void 0, function* () {
            // Apply local change w/ automerge.
            const changes = automerge_1.getHistory(this.document).map(state => state.change);
            // Store changes in ipfs.
            const newFileResult = this.swarm.ipfsNode.add(JSON.stringify(changes));
            let newFile = null;
            try {
                for (var newFileResult_1 = __asyncValues(newFileResult), newFileResult_1_1; newFileResult_1_1 = yield newFileResult_1.next(), !newFileResult_1_1.done;) {
                    newFile = newFileResult_1_1.value;
                }
            }
            catch (e_2_1) { e_2 = { error: e_2_1 }; }
            finally {
                try {
                    if (newFileResult_1_1 && !newFileResult_1_1.done && (_a = newFileResult_1.return)) yield _a.call(newFileResult_1);
                }
                finally { if (e_2) throw e_2.error; }
            }
            const hash = newFile.cid.toString();
            this._hashes.add(hash);
            // Send new message.
            const updateMessage = { documentId: this.documentPath, changes: {} };
            for (const oldHash of this._hashes) {
                updateMessage.changes[oldHash] = null;
            }
            updateMessage.changes[hash] = changes;
            if (!this.swarm.config) {
                throw 'Can not pin a file when the node has not been initialized';
            }
            this.swarm.ipfsNode.pubsub.publish(this.swarm.config.pubsubDocumentPublishPath, ipfs_1.default.Buffer.from(JSON.stringify(updateMessage)));
        });
    }
    open() {
        return __awaiter(this, void 0, void 0, function* () {
            // Open pubsub connection.
            // await this.swarm.ipfsNode.pubsub.subscribe(this.documentPath, this.sync.bind(this));
            yield this.swarm.ipfsNode.pubsub.subscribe(this.documentPath, (rawMessage) => {
                const message = JSON.parse(rawMessage.data.toString());
                this.sync(message);
            });
            // TODO: Make the messages on this specific to a document.
            yield this.swarm.ipfsNode.libp2p.handle('/collabswarm-automerge/doc-load/1.0.0', ({ stream }) => {
                console.log('received /collabswarm-automerge/doc-load/1.0.0 dial');
                const loadMessage = {
                    documentId: this.documentPath,
                    changes: {},
                };
                for (const hash of this._hashes) {
                    loadMessage.changes[hash] = null;
                }
                // Immediately send the connecting peer either the automerge.save'd document or a list of
                // hashes with the changes that are cached locally.
                it_pipe_1.default([JSON.stringify(loadMessage)], stream, (source) => { var source_2, source_2_1; return __awaiter(this, void 0, void 0, function* () {
                    var e_3, _a;
                    try {
                        // Ignores responses.
                        for (source_2 = __asyncValues(source); source_2_1 = yield source_2.next(), !source_2_1.done;) {
                            const _ = source_2_1.value;
                        }
                    }
                    catch (e_3_1) { e_3 = { error: e_3_1 }; }
                    finally {
                        try {
                            if (source_2_1 && !source_2_1.done && (_a = source_2.return)) yield _a.call(source_2);
                        }
                        finally { if (e_3) throw e_3.error; }
                    }
                }); });
            });
            // TODO ===================================================================
            // Load initial document from peers.
            // /TODO ==================================================================
            return yield this.load();
        });
    }
    close() {
        return __awaiter(this, void 0, void 0, function* () {
            yield this.swarm.ipfsNode.pubsub.unsubscribe(this.documentPath);
        });
    }
    getFile(hash) {
        var e_4, _a, e_5, _b;
        return __awaiter(this, void 0, void 0, function* () {
            try {
                for (var _c = __asyncValues(this.swarm.ipfsNode.get(hash)), _d; _d = yield _c.next(), !_d.done;) {
                    const file = _d.value;
                    if (file.content) {
                        const blocks = [];
                        try {
                            for (var _e = (e_5 = void 0, __asyncValues(file.content)), _f; _f = yield _e.next(), !_f.done;) {
                                const block = _f.value;
                                blocks.push(block);
                            }
                        }
                        catch (e_5_1) { e_5 = { error: e_5_1 }; }
                        finally {
                            try {
                                if (_f && !_f.done && (_b = _e.return)) yield _b.call(_e);
                            }
                            finally { if (e_5) throw e_5.error; }
                        }
                        const content = ipfs_1.default.Buffer.concat(blocks);
                        // TODO(r.chu): Should this store multiple changes per file?
                        return JSON.parse(content);
                    }
                }
            }
            catch (e_4_1) { e_4 = { error: e_4_1 }; }
            finally {
                try {
                    if (_d && !_d.done && (_a = _c.return)) yield _a.call(_c);
                }
                finally { if (e_4) throw e_4.error; }
            }
            return null;
        });
    }
    _fireRemoteUpdateHandlers(hashes) {
        for (const handler of Object.values(this._remoteHandlers)) {
            handler(this.document, hashes);
        }
    }
    _fireLocalUpdateHandlers(hashes) {
        for (const handler of Object.values(this._localHandlers)) {
            handler(this.document, hashes);
        }
    }
    // Given a list of hashes, fetch missing update messages.
    sync(message) {
        return __awaiter(this, void 0, void 0, function* () {
            // Only process hashes that we haven't seen yet.
            const newChangeEntries = Object.entries(message.changes).filter(([sentHash]) => sentHash && !this._hashes.has(sentHash));
            // First apply changes that were sent directly.
            let newDocument = this.document;
            const newDocumentHashes = [];
            const missingDocumentHashes = [];
            for (const [sentHash, sentChanges] of newChangeEntries) {
                if (sentChanges) {
                    // Apply the changes that were sent directly.
                    newDocument = automerge_1.applyChanges(newDocument, sentChanges);
                    newDocumentHashes.push(sentHash);
                }
                else {
                    missingDocumentHashes.push(sentHash);
                }
            }
            if (newDocumentHashes.length) {
                this._document = newDocument;
                for (const newHash of newDocumentHashes) {
                    this._hashes.add(newHash);
                }
                this._fireRemoteUpdateHandlers(newDocumentHashes);
            }
            // Then apply missing hashes by fetching them via IPFS.
            for (const missingHash of missingDocumentHashes) {
                // Fetch missing hashes using IPFS.
                this.getFile(missingHash)
                    .then(missingChanges => {
                    if (missingChanges) {
                        this._document = automerge_1.applyChanges(this._document, missingChanges);
                        this._hashes.add(missingHash);
                        this._fireRemoteUpdateHandlers([missingHash]);
                    }
                    else {
                        console.error(`'/ipfs/${missingHash}' returned nothing`, missingChanges);
                    }
                })
                    .catch(err => {
                    console.error('Failed to fetch missing change from ipfs:', missingHash, err);
                });
            }
        });
    }
    subscribe(id, handler, originFilter = 'all') {
        switch (originFilter) {
            case 'all': {
                this._remoteHandlers[id] = handler;
                this._localHandlers[id] = handler;
                break;
            }
            case 'remote': {
                this._remoteHandlers[id] = handler;
                break;
            }
            case 'local': {
                this._localHandlers[id] = handler;
                break;
            }
        }
    }
    unsubscribe(id) {
        if (this._remoteHandlers[id]) {
            delete this._remoteHandlers[id];
        }
        if (this._localHandlers[id]) {
            delete this._localHandlers[id];
        }
    }
    change(changeFn, message) {
        var e_6, _a;
        return __awaiter(this, void 0, void 0, function* () {
            // Apply local change w/ automerge.
            const newDocument = message ? automerge_1.change(this.document, message, changeFn) : automerge_1.change(this.document, changeFn);
            const changes = automerge_1.getChanges(this.document, newDocument);
            this._document = newDocument;
            // Store changes in ipfs.
            const newFileResult = this.swarm.ipfsNode.add(JSON.stringify(changes));
            let newFile = null;
            try {
                for (var newFileResult_2 = __asyncValues(newFileResult), newFileResult_2_1; newFileResult_2_1 = yield newFileResult_2.next(), !newFileResult_2_1.done;) {
                    newFile = newFileResult_2_1.value;
                }
            }
            catch (e_6_1) { e_6 = { error: e_6_1 }; }
            finally {
                try {
                    if (newFileResult_2_1 && !newFileResult_2_1.done && (_a = newFileResult_2.return)) yield _a.call(newFileResult_2);
                }
                finally { if (e_6) throw e_6.error; }
            }
            const hash = newFile.cid.toString();
            this._hashes.add(hash);
            // Send new message.
            const updateMessage = { documentId: this.documentPath, changes: {} };
            for (const oldHash of this._hashes) {
                updateMessage.changes[oldHash] = null;
            }
            updateMessage.changes[hash] = changes;
            yield this.swarm.ipfsNode.pubsub.publish(this.documentPath, ipfs_1.default.Buffer.from(JSON.stringify(updateMessage)));
            // Fire change handlers.
            this._fireLocalUpdateHandlers([hash]);
        });
    }
}
exports.AutomergeSwarmDocument = AutomergeSwarmDocument;
//# sourceMappingURL=collabswarm-automerge-document.js.map