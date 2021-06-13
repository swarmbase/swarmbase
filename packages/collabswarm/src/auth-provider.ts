// Restrict access to those on ACL

import { CollabswarmDocument } from "./collabswarm-document";
import { CRDTSyncMessage } from "./collabswarm-message";

export interface AuthProvider<PrivateKey, PublicKey, DocumentKey=string> {
  sign(data: Uint8Array, privateKey: PrivateKey): Promise<Uint8Array>;
  verify(data: Uint8Array, publicKey: PublicKey, signature: string): Promise<boolean>;
  encrypt(data: Uint8Array, signature:Uint8Array, documentKey: DocumentKey): Promise<Uint8Array>;
  decrypt(data: Uint8Array, documentKey: DocumentKey): Promise<Uint8Array>;
}
