import {
  ACLProvider,
  AuthProvider,
  ChangesSerializer,
  Collabswarm,
  CRDTProvider,
  SyncMessageSerializer,
  KeychainProvider,
  LoadMessageSerializer,
  CollabswarmDocument,
  CollabswarmConfig,
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
  privateKey: PrivateKey | undefined,
  publicKey: PublicKey | undefined,
  provider: CRDTProvider<DocType, ChangesType, ChangeFnType>,
  changesSerializer: ChangesSerializer<ChangesType>,
  syncMessageSerializer: SyncMessageSerializer<ChangesType>,
  loadMessageSerializer: LoadMessageSerializer,
  authProvider: AuthProvider<PrivateKey, PublicKey, DocumentKey>,
  aclProvider: ACLProvider<ChangesType, PublicKey>,
  keychainProvider: KeychainProvider<ChangesType, DocumentKey>,
  config?: CollabswarmConfig,
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
    (async () => {
      console.log(`Calling useCollabswarm(...) init effect`);
      if (privateKey && publicKey) {
        const collabswarm = new Collabswarm(
          privateKey,
          publicKey,
          provider,
          changesSerializer,
          syncMessageSerializer,
          loadMessageSerializer,
          authProvider,
          aclProvider,
          keychainProvider,
        );
        await collabswarm.initialize(config);
        setCollabswarm(collabswarm);
      }
    })();
  }, [privateKey, publicKey]);

  return collabswarm;
}

export function useCollabswarmDocumentState<
  DocType,
  ChangesType,
  ChangeFnType,
  PrivateKey,
  PublicKey,
  DocumentKey
>(
  collabswarm: Collabswarm<
    DocType,
    ChangesType,
    ChangeFnType,
    PrivateKey,
    PublicKey,
    DocumentKey
  >,
  documentPath: string,
  originFilter: 'all' | 'remote' | 'local' = 'all',
): [DocType | undefined, (fn: ChangeFnType, message?: string) => void] {
  const [docCache, setDocCache] = useState<{
    [docPath: string]: CollabswarmDocument<
      DocType,
      ChangesType,
      ChangeFnType,
      PrivateKey,
      PublicKey,
      DocumentKey
    >;
  }>({});
  const [docDataCache, setDocDataCache] = useState<{
    [docPath: string]: DocType;
  }>({});

  useEffect(() => {
    (async () => {
      console.log(
        `Calling useCollabswarmDocumentState(${JSON.stringify(
          documentPath,
        )}, ${JSON.stringify(originFilter)}) init effect`,
      );
      let newDocCache = docCache;
      let newDocDataCache = docDataCache;
      let docRef: CollabswarmDocument<
        DocType,
        ChangesType,
        ChangeFnType,
        PrivateKey,
        PublicKey,
        DocumentKey
      > | null = docCache[documentPath];
      if (!docRef) {
        docRef = collabswarm.doc(documentPath);
        if (docRef) {
          await docRef.open();
          newDocCache = { ...docCache };
          newDocDataCache = { ...docDataCache };
          newDocCache[documentPath] = docRef;
          newDocDataCache[documentPath] = docRef.document;
        }
      }

      if (!docRef) {
        console.warn(`Failed to open/find document: ${documentPath}`);
        return;
      }

      // Subscribe to document changes.
      docRef.subscribe(
        'useCollabswarmDocumentState',
        (current: DocType) => {
          console.log("Received a document update!", current);
          const newDocDataCache = { ...docDataCache };
          newDocDataCache[documentPath] = current;
          setDocDataCache(newDocDataCache);
        },
        originFilter,
      );

      if (docCache !== newDocCache) {
        setDocCache(newDocCache);
      }
      if (docDataCache !== newDocDataCache) {
        setDocDataCache(newDocDataCache);
      }
    })();
  }, [documentPath]);

  return [
    docDataCache[documentPath],
    (fn: ChangeFnType, message?: string) => {
      const docRef = docCache[documentPath];
      docRef && docRef.change(fn, message);
    },
  ];
}
