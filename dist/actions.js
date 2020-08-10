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
Object.defineProperty(exports, "__esModule", { value: true });
exports.peerDisconnect = exports.PEER_DISCONNECT = exports.peerConnect = exports.PEER_CONNECT = exports.changeDocument = exports.CHANGE_DOCUMENT = exports.changeDocumentAsync = exports.syncDocument = exports.SYNC_DOCUMENT = exports.closeDocument = exports.CLOSE_DOCUMENT = exports.closeDocumentAsync = exports.openDocument = exports.OPEN_DOCUMENT = exports.openDocumentAsync = exports.connect = exports.CONNECT = exports.connectAsync = exports.initialize = exports.INITIALIZE = exports.initializeAsync = void 0;
const collabswarm_automerge_1 = require("@robotoer/collabswarm-automerge");
// TODO: Add an optional trace option that records the async call-site in the action for debugging purposes.
function initializeAsync(config = collabswarm_automerge_1.DEFAULT_CONFIG, selectAutomergeSwarmState = s => s) {
    return (dispatch, getState) => __awaiter(this, void 0, void 0, function* () {
        const { node } = selectAutomergeSwarmState(getState());
        node.subscribeToPeerConnect('peer-connect', (address) => {
            dispatch(peerConnect(address));
        });
        node.subscribeToPeerDisconnect('peer-disconnect', (address) => {
            dispatch(peerDisconnect(address));
        });
        yield node.initialize(config);
        dispatch(initialize(node));
        console.log('Node information:', node);
        return node;
    });
}
exports.initializeAsync = initializeAsync;
exports.INITIALIZE = 'AUTOMERGE_SWARM_INITIALIZE';
function initialize(node) {
    return { type: exports.INITIALIZE, node };
}
exports.initialize = initialize;
function connectAsync(addresses, selectAutomergeSwarmState = s => s) {
    return (dispatch, getState) => __awaiter(this, void 0, void 0, function* () {
        const { node } = selectAutomergeSwarmState(getState());
        if (!node) {
            console.warn('Node not initialized yet! Unable to connect to:', addresses);
            return;
        }
        yield node.connect(addresses);
        dispatch(connect(addresses));
        console.log('Node information:', node);
        console.log('Connected to:', addresses);
    });
}
exports.connectAsync = connectAsync;
exports.CONNECT = 'AUTOMERGE_SWARM_CONNECT';
function connect(addresses) {
    return { type: exports.CONNECT, addresses };
}
exports.connect = connect;
function openDocumentAsync(documentId, selectAutomergeSwarmState = s => s) {
    return (dispatch, getState) => __awaiter(this, void 0, void 0, function* () {
        const { node } = selectAutomergeSwarmState(getState());
        if (!node) {
            console.warn('Node not initialized yet! Unable to open document:', documentId);
            return null;
        }
        const documentRef = node.doc(documentId);
        // TODO: Close previous document (if any).
        if (documentRef) {
            documentRef.subscribe(documentId, document => {
                dispatch(syncDocument(documentId, document));
            }, 'remote');
            const loaded = yield documentRef.open();
            if (!loaded) {
                // Assume this is a new document.
                console.log('Failed to load document from peers, assuming this is a new document...', documentRef);
                yield documentRef.pin();
            }
            dispatch(openDocument(documentId, documentRef));
            return documentRef;
        }
        else {
            console.warn('Unable to find document:', documentId);
            return null;
        }
    });
}
exports.openDocumentAsync = openDocumentAsync;
exports.OPEN_DOCUMENT = 'AUTOMERGE_SWARM_OPEN_DOCUMENT';
function openDocument(documentId, documentRef) {
    return { type: exports.OPEN_DOCUMENT, documentId, documentRef };
}
exports.openDocument = openDocument;
function closeDocumentAsync(documentId, selectAutomergeSwarmState = s => s) {
    return (dispatch, getState) => __awaiter(this, void 0, void 0, function* () {
        const { documents } = selectAutomergeSwarmState(getState());
        if (documents[documentId] && documents[documentId].documentRef) {
            const documentRef = documents[documentId].documentRef;
            documentRef.unsubscribe(documentId);
            yield documentRef.close();
            dispatch(closeDocument(documentId));
        }
        else {
            console.warn('Closing a document that was not opened:', documentId);
        }
    });
}
exports.closeDocumentAsync = closeDocumentAsync;
exports.CLOSE_DOCUMENT = 'AUTOMERGE_SWARM_CLOSE_DOCUMENT';
function closeDocument(documentId) {
    return { type: exports.CLOSE_DOCUMENT, documentId };
}
exports.closeDocument = closeDocument;
exports.SYNC_DOCUMENT = 'AUTOMERGE_SWARM_SYNC_DOCUMENT';
function syncDocument(documentId, document) {
    return { type: exports.SYNC_DOCUMENT, documentId, document };
}
exports.syncDocument = syncDocument;
function changeDocumentAsync(documentId, changeFn, message, selectAutomergeSwarmState = s => s) {
    return (dispatch, getState) => __awaiter(this, void 0, void 0, function* () {
        const { documents } = selectAutomergeSwarmState(getState());
        if (documents[documentId] && documents[documentId].documentRef) {
            const documentRef = documents[documentId].documentRef;
            const changePromise = documentRef.change(changeFn, message);
            dispatch(changeDocument(documentId, documentRef.document));
            yield changePromise;
            return documentRef.document;
        }
        else {
            throw new Error(`Trying to edit a document that is not opened: ${documentId}`);
        }
    });
}
exports.changeDocumentAsync = changeDocumentAsync;
exports.CHANGE_DOCUMENT = 'AUTOMERGE_SWARM_CHANGE_DOCUMENT';
function changeDocument(documentId, document) {
    return { type: exports.CHANGE_DOCUMENT, documentId, document };
}
exports.changeDocument = changeDocument;
exports.PEER_CONNECT = 'AUTOMERGE_SWARM_PEER_CONNECT';
function peerConnect(peerAddress) {
    return { type: exports.PEER_CONNECT, peerAddress };
}
exports.peerConnect = peerConnect;
exports.PEER_DISCONNECT = 'AUTOMERGE_SWARM_PEER_DISCONNECT';
function peerDisconnect(peerAddress) {
    return { type: exports.PEER_DISCONNECT, peerAddress };
}
exports.peerDisconnect = peerDisconnect;
//# sourceMappingURL=actions.js.map