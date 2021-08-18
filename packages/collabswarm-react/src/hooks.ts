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
  DocumentKey,
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
  DocumentKey,
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
): [
  DocType | undefined,
  (fn: ChangeFnType, message?: string) => void,
  {
    readers: PublicKey[];
    addReader: (user: PublicKey) => Promise<void>;
    removeReader: (user: PublicKey) => Promise<void>;
    writers: PublicKey[];
    addWriter: (user: PublicKey) => Promise<void>;
    removeWriter: (user: PublicKey) => Promise<void>;
  },
] {
  // TODO: These caches grow infinitely.
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
  const [docReadersCache, setDocReadersCache] = useState<{
    [docPath: string]: PublicKey[];
  }>({});
  const [docWritersCache, setDocWritersCache] = useState<{
    [docPath: string]: PublicKey[];
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
      let newDocReadersCache = docReadersCache;
      let newDocWritersCache = docWritersCache;
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
          newDocReadersCache = { ...docReadersCache };
          newDocWritersCache = { ...docWritersCache };
          newDocCache[documentPath] = docRef;
          newDocDataCache[documentPath] = docRef.document;
          newDocReadersCache[documentPath] = await docRef.getReaders();
          newDocWritersCache[documentPath] = await docRef.getWriters();
        }
      }

      if (!docRef) {
        console.warn(`Failed to open/find document: ${documentPath}`);
        return;
      }

      // Subscribe to document changes.
      docRef.subscribe(
        'useCollabswarmDocumentState',
        (current, readers, writers) => {
          console.log('Received a document update!', current);
          const newDocDataCache = { ...docDataCache };
          const newDocReadersCache = { ...docReadersCache };
          const newDocWritersCache = { ...docWritersCache };
          newDocDataCache[documentPath] = current;
          newDocReadersCache[documentPath] = readers;
          newDocWritersCache[documentPath] = writers;
          setDocDataCache(newDocDataCache);
          setDocReadersCache(newDocReadersCache);
          setDocWritersCache(newDocWritersCache);
        },
        originFilter,
      );

      if (docCache !== newDocCache) {
        setDocCache(newDocCache);
      }
      if (docDataCache !== newDocDataCache) {
        setDocDataCache(newDocDataCache);
      }
      if (docReadersCache !== newDocReadersCache) {
        setDocReadersCache(newDocReadersCache);
      }
      if (docWritersCache !== newDocWritersCache) {
        setDocWritersCache(newDocWritersCache);
      }
    })();
  }, [documentPath]);

  return [
    docDataCache[documentPath],
    (fn: ChangeFnType, message?: string) => {
      const docRef = docCache[documentPath];
      docRef && docRef.change(fn, message);
    },
    {
      readers: docReadersCache[documentPath],
      addReader: async (user: PublicKey) => {
        const docRef = docCache[documentPath];
        await docRef.addReader(user);
      },
      removeReader: async (user: PublicKey) => {
        const docRef = docCache[documentPath];
        await docRef.removeReader(user);
      },
      writers: docWritersCache[documentPath],
      addWriter: async (user: PublicKey) => {
        const docRef = docCache[documentPath];
        await docRef.addWriter(user);
      },
      removeWriter: async (user: PublicKey) => {
        const docRef = docCache[documentPath];
        await docRef.removeWriter(user);
      },
    },
  ];
}
