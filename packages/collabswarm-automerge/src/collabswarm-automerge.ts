// TODO: use ES6 import statement
const { subtle, getRandomValues } = require('crypto').webcrypto;

import { Doc, Change, init, change, getChanges, applyChanges, getHistory } from "automerge";

import { AuthProvider, Collabswarm, CollabswarmDocument, CollabswarmDocumentChangeHandler, CRDTProvider, CRDTSyncMessage } from "@collabswarm/collabswarm";

export type AutomergeSwarmDocumentChangeHandler<T = any> = CollabswarmDocumentChangeHandler<Doc<T>>;

export type AutomergeSwarm<T = any> = Collabswarm<Doc<T>, Change[], (doc: T) => void, AutomergeSwarmSyncMessage>;

export type AutomergeSwarmDocument<T = any> = CollabswarmDocument<Doc<T>, Change[], (doc: T) => void, AutomergeSwarmSyncMessage>;

export interface AutomergeSwarmSyncMessage extends CRDTSyncMessage<Change[]> { }

export class AutomergeProvider<T = any> implements CRDTProvider<Doc<T>, Change[], (doc: T) => void, AutomergeSwarmSyncMessage> {
  newDocument(): Doc<T> {
    return init();
  }
  newMessage(documentId: string): AutomergeSwarmSyncMessage {
    return { documentId, changes: {} };
  }
  localChange(document: Doc<T>, message: string, changeFn: (doc: T) => void): [Doc<T>, Change[]] {
    const newDocument = message ? change(document, message, changeFn) : change(document, changeFn);
    const changes = getChanges(document, newDocument);
    return [newDocument, changes];
  }
  remoteChange(document: Doc<T>, changes: Change[]): Doc<T> {
    return applyChanges(document, changes);
  }
  serializeChanges(changes: Change[]): string {
    return JSON.stringify(changes);
  }
  deserializeChanges(changes: string): Change[] {
    return JSON.parse(changes);
  }
  // also - ask Robert how to test!
  // Used with every change message
  // documentKey: symmetric key unique to document, changed when ACL changes
  // algorithm is an object specifying the algorithm to be used and any extra parameters if required
  // async encryptMessage(message: AutomergeSwarmSyncMessage, documentKey: string, algorithm: any = 'AES-GCM'): Promise<Uint8Array> {
  //   let encoded = this.serializeMessage(message);
  //   let iv = getRandomValues(new Uint8Array(12));
  //   let cipherText = await subtle.encrypt(
  //     { name: algorithm, iv: iv },
  //     documentKey,
  //     encoded
  //   );
  //   let cipherMessage = Uint8Array.from([iv, cipherText]);

  //   // TODO: Eric sign

  //   return cipherMessage;
  // }
  serializeMessage(message: AutomergeSwarmSyncMessage): Uint8Array {
    const encoder = new TextEncoder();
    return encoder.encode(JSON.stringify(message));
  }
  // string documentKey: provided locally; shared initially if on ACL list
  // async decryptMessage(documentKey: string, cipherMessage: Uint8Array, algorithm: any = 'AES-GCM'): Promise<AutomergeSwarmSyncMessage> {
    
  //   // TODO: verify before expense of decrypt

  //   let iv = cipherMessage.subarray(0,12);  // length set and joined in encrypt function
  //   let cipherText = cipherMessage.subarray(12,);
  //   let encoded = await subtle.decrypt(
  //     { name: algorithm, iv: iv },
  //     documentKey,
  //     cipherText
  //   )
  //   let decoded = this.deserializeMessage(encoded);
  //   return decoded;
  // }
  deserializeMessage(message: Uint8Array): AutomergeSwarmSyncMessage {
    const decoder = new TextDecoder();
    const rawMessage = decoder.decode(message);
    try {
      return JSON.parse(rawMessage);
    } catch (err) {
      console.error("Failed to parse message:", rawMessage, message);
      throw err;
    }
  }
  getHistory(document: Doc<T>): Change[] {
    return getHistory(document).map(state => state.change);
  }
}

export class AutomergeAuthProvider implements AuthProvider<> {
}
