import {
  ACLProvider,
  AuthProvider,
  ChangesSerializer,
  Collabswarm,
  CRDTProvider,
  SyncMessageSerializer,
  KeychainProvider,
  LoadMessageSerializer,
} from '@collabswarm/collabswarm';
import {  } from '@collabswarm/collabswarm/src/load-request-serializer';
import { useEffect, useState } from 'react';

export function useCollabswarm<
  DocType,
  ChangesType,
  ChangeFnType,
  PrivateKey,
  PublicKey,
  DocumentKey
>(
  privateKey: PrivateKey,
  provider: CRDTProvider<DocType, ChangesType, ChangeFnType>,
  changesSerializer: ChangesSerializer<ChangesType>,
  syncMessageSerializer: SyncMessageSerializer<ChangesType>,
  loadMessageSerializer: LoadMessageSerializer,
  authProvider: AuthProvider<PrivateKey, PublicKey, DocumentKey>,
  aclProvider: ACLProvider<ChangesType, PublicKey>,
  keychainProvider: KeychainProvider<ChangesType, DocumentKey>,
) {
  const [collabswarm, setCollabswarm] = useState<
    | Collabswarm<
        DocType,
        ChangesType,
        ChangeFnType,
        PrivateKey,
        PublicKey,
        DocumentKey
      >
    | undefined
  >();

  useEffect(() => {
    setCollabswarm(
      new Collabswarm(
        privateKey,
        provider,
        changesSerializer,
        syncMessageSerializer,
        loadMessageSerializer,
        authProvider,
        aclProvider,
        keychainProvider,
      ),
    );
  });

  return collabswarm;
}
