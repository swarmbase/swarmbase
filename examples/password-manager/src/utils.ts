import { Collabswarm, CollabswarmDocument } from '@collabswarm/collabswarm';
import * as Y from 'yjs';

export type YjsCollabswarm = Collabswarm<Y.Doc, Uint8Array, (doc: Y.Doc) => void, CryptoKey, CryptoKey, CryptoKey>;
export type YjsCollabswarmDocument = CollabswarmDocument<Y.Doc, Uint8Array, (doc: Y.Doc) => void, CryptoKey, CryptoKey, CryptoKey>;
