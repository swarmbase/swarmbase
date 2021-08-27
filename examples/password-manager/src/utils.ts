import { Collabswarm, CollabswarmDocument } from '@collabswarm/collabswarm';
import * as Y from 'yjs';

export type YjsCollabswarm = Collabswarm<
  Y.Doc,
  Uint8Array,
  (doc: Y.Doc) => void,
  CryptoKey,
  CryptoKey,
  CryptoKey
>;
export type YjsCollabswarmDocument = CollabswarmDocument<
  Y.Doc,
  Uint8Array,
  (doc: Y.Doc) => void,
  CryptoKey,
  CryptoKey,
  CryptoKey
>;

export async function exportKey(key: CryptoKey): Promise<string> {
  const jwk = await crypto.subtle.exportKey('jwk', key);
  return JSON.stringify(jwk);
}

export async function importKey(
  keyData: string,
  keyUsage: KeyUsage[],
): Promise<CryptoKey> {
  const jwk = JSON.parse(keyData) as JsonWebKey;
  return await crypto.subtle.importKey(
    'jwk',
    jwk,
    {
      name: 'ECDSA',
      namedCurve: 'P-384',
    },
    true,
    keyUsage,
  );
}
