import { CollabswarmDocument } from "./collabswarm-document";
import { CRDTChangeBlock, CRDTSyncMessage } from "./collabswarm-message";

// export interface AuthProvider<DocType, ChangesType, ChangeFnType, MessageType extends CRDTSyncMessage<ChangesType>, DocRef extends CollabswarmDocument<DocType, ChangesType, ChangeFnType, MessageType>, PrivateKey, DocumentKey=string> {
//   signChanges(changes: ChangesType, privateKey: PrivateKey): CRDTChangeBlock<ChangesType>;
//   verifyChanges(changes: CRDTChangeBlock<ChangesType>): boolean;
//   encryptChangeBlock(changes: CRDTChangeBlock<ChangesType>, key: DocumentKey): Uint8Array;
//   decryptChangeBlock(changes: Uint8Array, key: DocumentKey): CRDTChangeBlock<ChangesType>;

//   signMessages(message: MessageType): MessageType;
//   verifyMessages(message: MessageType): MessageType;
//   encryptMessages(messages: MessageType): Uint8Array;
//   decryptMessages(messages: Uint8Array): MessageType;

//   addReader(doc: DocRef, peerId: string): DocRef;
//   removeReader(doc: DocRef, peerId: string): DocRef;
//   getReaders(doc: DocRef): string[];

//   addWriter(doc: DocRef, peerId: string): DocRef;
//   removeWriter(doc: DocRef, peerId: string): DocRef;
//   getWriters(doc: DocRef): string[];
// }

export interface AuthProvider<PrivateKey, PublicKey, DocumentKey=string> {
  sign(data: Uint8Array, privateKey: PrivateKey): Promise<Uint8Array>;
  verify(data: Uint8Array, publicKey: PublicKey, signature: string): Promise<boolean>;
  encrypt(data: Uint8Array, key: DocumentKey): Promise<Uint8Array>;
  decrypt(data: Uint8Array, key: DocumentKey): Promise<Uint8Array>;
}
