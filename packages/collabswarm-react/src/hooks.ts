import {
  ACLProvider,
  AuthProvider,
  ChangesSerializer,
  Collabswarm,
  CRDTProvider,
  CRDTSyncMessage,
  KeychainProvider,
  MessageSerializer,
} from '@collabswarm/collabswarm';
import { useEffect, useState } from 'react';

export function useCollabswarm<
  DocType,
  ChangesType,
  ChangeFnType,
  PrivateKey,
  PublicKey,
  DocumentKey
>(
  provider: CRDTProvider<DocType, ChangesType, ChangeFnType>,
  changesSerializer: ChangesSerializer<ChangesType>,
  messageSerializer: MessageSerializer<ChangesType>,
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
        provider,
        changesSerializer,
        messageSerializer,
        authProvider,
        aclProvider,
        keychainProvider,
      ),
    );
  });

  return collabswarm;
}
