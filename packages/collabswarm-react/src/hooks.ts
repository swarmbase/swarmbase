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
import { useEffect, useState, useContext, createContext } from 'react';

export type CollabswarmContextOpenResult<
  DocType,
  ChangesType,
  ChangeFnType,
  PrivateKey,
  PublicKey,
  DocumentKey,
  > = {
    docRef?: CollabswarmDocument<DocType, ChangesType, ChangeFnType, PrivateKey, PublicKey, DocumentKey>;
    readers?: PublicKey[];
    writers?: PublicKey[];
  };

const openTasks = new Map<string, Promise<CollabswarmContextOpenResult<any, any, any, any, any, any>>>();
const openTaskResults = new Map<string, CollabswarmContextOpenResult<any, any, any, any, any, any>>();

export const CollabswarmContext = createContext<{
  // TODO: These caches grow infinitely.
  docCache: { [docPath: string]: CollabswarmDocument<any, any, any, any, any, any> };
  docDataCache: { [docPath: string]: any };
  docReadersCache: { [docPath: string]: any[] };
  docWritersCache: { [docPath: string]: any[] };
  setDocCache: (docCache: { [docPath: string]: CollabswarmDocument<any, any, any, any, any, any> }) => void;
  setDocDataCache: (docDataCache: { [docPath: string]: any }) => void;
  setDocReadersCache: (docReadersCache: { [docPath: string]: any[] }) => void;
  setDocWritersCache: (docWritersCache: { [docPath: string]: any[] }) => void;
}>({
  // TODO: These defaults are ineffective. Is there a better way to populate these (such returning this context from a hook?)
  docCache: {},
  docDataCache: {},
  docReadersCache: {},
  docWritersCache: {},
  setDocCache: (docCache: { [docPath: string]: CollabswarmDocument<any, any, any, any, any, any> }) => { },
  setDocDataCache: (docDataCache: { [docPath: string]: any }) => { },
  setDocReadersCache: (docReadersCache: { [docPath: string]: any[] }) => { },
  setDocWritersCache: (docWritersCache: { [docPath: string]: any[] }) => { },
});

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

  const {
    docCache,
    docDataCache,
    docReadersCache,
    docWritersCache,
    setDocCache,
    setDocDataCache,
    setDocReadersCache,
    setDocWritersCache,
  } = useContext(CollabswarmContext);

  useEffect(() => {
    (async () => {
      let newDocCache: { [docPath: string]: CollabswarmDocument<DocType, ChangesType, ChangeFnType, PrivateKey, PublicKey, DocumentKey> } = docCache;
      let newDocDataCache: { [docPath: string]: DocType } = docDataCache;
      let newDocReadersCache: { [docPath: string]: PublicKey[] } = docReadersCache;
      let newDocWritersCache: { [docPath: string]: PublicKey[] } = docWritersCache;
      let docRef: CollabswarmDocument<
        DocType,
        ChangesType,
        ChangeFnType,
        PrivateKey,
        PublicKey,
        DocumentKey
      > | null = docCache[documentPath] || null;
      const taskExists = openTasks.has(documentPath);
      if (!docRef) {
        if (!taskExists) {
          docRef = collabswarm.doc(documentPath);
          const openPromise: Promise<CollabswarmContextOpenResult<any, any, any, any, any, any>> = (async () => {
            if (docRef) {
              await docRef.open();
              const readers = await docRef.getReaders();
              const writers = await docRef.getWriters();
              return { docRef, readers, writers };
            }
            return {};
          })();
          openTasks.set(documentPath, openPromise);
          const openTaskResult: CollabswarmContextOpenResult<DocType, ChangesType, ChangeFnType, PrivateKey, PublicKey, DocumentKey> = await openPromise;
          openTaskResults.set(documentPath, openTaskResult);
          const { docRef: currentDocRef, readers, writers } = openTaskResult;
          if (currentDocRef) {
            // We can't use the values from the CollabswarmContext created above as those may be "stale"/out of date.
            // Instead we use a global cache (ew, global state) for now to rebuild these caches as they should be.
            newDocCache = {};
            newDocDataCache = {};
            newDocReadersCache = {};
            newDocWritersCache = {};
            openTaskResults.forEach((openTaskResult: CollabswarmContextOpenResult<DocType, ChangesType, ChangeFnType, PrivateKey, PublicKey, DocumentKey>, path) => {
              if (openTaskResult.docRef) {
                newDocCache[path] = openTaskResult.docRef;
                newDocDataCache[path] = openTaskResult.docRef.document;
              }
              if (openTaskResult.readers) {
                newDocReadersCache[path] = openTaskResult.readers;
              }
              if (openTaskResult.writers) {
                newDocWritersCache[path] = openTaskResult.writers;
              }
            });

            // Subscribe to document changes.
            currentDocRef.subscribe(
              'useCollabswarmDocumentState',
              (current, readers, writers) => {
                // We can't use the values from the CollabswarmContext created above as those may be "stale"/out of date.
                // Instead we use a global cache (ew, global state) for now to rebuild these caches as they should be.
                const currentResults = openTaskResults.get(documentPath);
                const newResults = { ...currentResults, readers, writers };
                openTaskResults.set(documentPath, newResults);
                const newDocDataCache: { [docPath: string]: DocType } = {};
                const newDocReadersCache: { [docPath: string]: PublicKey[] } = {};
                const newDocWritersCache: { [docPath: string]: PublicKey[] } = {};
                openTaskResults.forEach((openTaskResult: CollabswarmContextOpenResult<DocType, ChangesType, ChangeFnType, PrivateKey, PublicKey, DocumentKey>, path) => {
                  if (openTaskResult.docRef) {
                    newDocCache[path] = openTaskResult.docRef;
                    if (path === documentPath) {
                      newDocDataCache[path] = current;
                    } else {
                      newDocDataCache[path] = openTaskResult.docRef.document;
                    }
                  }
                  if (openTaskResult.readers) {
                    newDocReadersCache[path] = openTaskResult.readers;
                  }
                  if (openTaskResult.writers) {
                    newDocWritersCache[path] = openTaskResult.writers;
                  }
                });
                setDocDataCache(newDocDataCache);
                setDocReadersCache(newDocReadersCache);
                setDocWritersCache(newDocWritersCache);
              },
              originFilter,
            );

            // TODO: Return an unsubscribe function for react to call during cleanup.
          }
        }
      }

      if (!docRef) {
        if (!taskExists) {
          console.warn(`Failed to open/find document: ${documentPath}`);
        }
        return;
      }

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
