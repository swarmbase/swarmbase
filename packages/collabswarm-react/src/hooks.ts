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
import { useEffect, useState, useContext, useRef, createContext } from 'react';

export type CollabswarmContextOpenResult<
  DocType,
  ChangesType,
  ChangeFnType,
  PrivateKey,
  PublicKey,
  DocumentKey
> = {
  docRef?: CollabswarmDocument<
    DocType,
    ChangesType,
    ChangeFnType,
    PrivateKey,
    PublicKey,
    DocumentKey
  >;
  readers?: PublicKey[];
  writers?: PublicKey[];
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- Module-level singletons must use `any` because
// they store results from multiple generic instantiations of useCollabswarmDocumentState.
const openTasks = new Map<
  string,
  Promise<CollabswarmContextOpenResult<any, any, any, any, any, any>>
>();
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- See above.
const openTaskResults = new Map<
  string,
  CollabswarmContextOpenResult<any, any, any, any, any, any>
>();

// Reference count per documentPath -- only evict shared caches when the last subscriber unmounts.
const subscriberCounts = new Map<string, number>();

/**
 * Reset module-level caches. Intended for use in tests only.
 * @internal
 */
export function _resetCaches() {
  openTasks.clear();
  openTaskResults.clear();
  subscriberCounts.clear();
}

/**
 * Read-only access to module-level cache sizes. Intended for use in tests only.
 * @internal
 */
export function _getCacheSizes() {
  return {
    openTasks: openTasks.size,
    openTaskResults: openTaskResults.size,
    subscriberCounts: subscriberCounts.size,
  };
}

export const CollabswarmContext = createContext<{
  // Caches are evicted when the last subscriber for a document path unmounts (see cleanup below).
  docCache: {
    [docPath: string]: CollabswarmDocument<any, any, any, any, any, any>;
  };
  docDataCache: { [docPath: string]: any };
  docReadersCache: { [docPath: string]: any[] };
  docWritersCache: { [docPath: string]: any[] };
  setDocCache: (docCache: {
    [docPath: string]: CollabswarmDocument<any, any, any, any, any, any>;
  }) => void;
  setDocDataCache: (docDataCache: { [docPath: string]: any }) => void;
  setDocReadersCache: (docReadersCache: { [docPath: string]: any[] }) => void;
  setDocWritersCache: (docWritersCache: { [docPath: string]: any[] }) => void;
}>({
  // Default no-op setters; real implementations are provided by the context provider component.
  docCache: {},
  docDataCache: {},
  docReadersCache: {},
  docWritersCache: {},
  setDocCache: (docCache: {
    [docPath: string]: CollabswarmDocument<any, any, any, any, any, any>;
  }) => {},
  setDocDataCache: (docDataCache: { [docPath: string]: any }) => {},
  setDocReadersCache: (docReadersCache: { [docPath: string]: any[] }) => {},
  setDocWritersCache: (docWritersCache: { [docPath: string]: any[] }) => {},
});

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
  syncMessageSerializer: SyncMessageSerializer<ChangesType, PublicKey>,
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

  // Unique subscription ID per hook instance to avoid collisions when
  // multiple components subscribe to the same or different documents.
  const subscriptionIdRef = useRef(`useCollabswarmDocumentState-${Math.random().toString(36).slice(2)}`);

  useEffect(() => {
    // Track whether this effect is still active (not unmounted/dep-changed).
    // The async IIFE checks this after each await to avoid operating on stale state.
    let active = true;
    let subscribedDocPath: string | null = null;

    // Increment subscriber count for this documentPath.
    subscriberCounts.set(documentPath, (subscriberCounts.get(documentPath) || 0) + 1);

    (async () => {
      let newDocCache: {
        [docPath: string]: CollabswarmDocument<
          DocType,
          ChangesType,
          ChangeFnType,
          PrivateKey,
          PublicKey,
          DocumentKey
        >;
      } = docCache;
      let newDocDataCache: { [docPath: string]: DocType } = docDataCache;
      let newDocReadersCache: {
        [docPath: string]: PublicKey[];
      } = docReadersCache;
      let newDocWritersCache: {
        [docPath: string]: PublicKey[];
      } = docWritersCache;
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
        if (taskExists) {
          // Another hook instance is already opening this document.
          // Await its completion and subscribe this instance.
          const existingTask = openTasks.get(documentPath);
          if (existingTask) {
            const result = await existingTask;
            if (!active) return;
            if (result.docRef) {
              docRef = result.docRef as CollabswarmDocument<
                DocType, ChangesType, ChangeFnType, PrivateKey, PublicKey, DocumentKey
              >;
              // If the opener unmounted before populating caches, do it here.
              if (!openTaskResults.has(documentPath)) {
                openTaskResults.set(documentPath, result);
              }
              // Rebuild all caches (doc, data, readers, writers) from openTaskResults.
              const freshDocCache: { [p: string]: any } = {};
              const freshDataCache: { [p: string]: any } = {};
              const freshReadersCache: { [p: string]: any[] } = {};
              const freshWritersCache: { [p: string]: any[] } = {};
              openTaskResults.forEach((r, p) => {
                if (r.docRef) { freshDocCache[p] = r.docRef; freshDataCache[p] = r.docRef.document; }
                if (r.readers) freshReadersCache[p] = r.readers;
                if (r.writers) freshWritersCache[p] = r.writers;
              });
              setDocCache(freshDocCache);
              setDocDataCache(freshDataCache);
              setDocReadersCache(freshReadersCache);
              setDocWritersCache(freshWritersCache);
              // Subscribe this late-arriving instance.
              docRef.subscribe(
                subscriptionIdRef.current,
                (current, readers, writers) => {
                  const currentResults = openTaskResults.get(documentPath);
                  if (currentResults) {
                    openTaskResults.set(documentPath, { ...currentResults, readers, writers });
                  }
                  const newDataCache: { [p: string]: DocType } = {};
                  const newReadersCache: { [p: string]: PublicKey[] } = {};
                  const newWritersCache: { [p: string]: PublicKey[] } = {};
                  openTaskResults.forEach((r, p) => {
                    if (r.docRef) newDataCache[p] = p === documentPath ? current : r.docRef.document;
                    if (r.readers) newReadersCache[p] = r.readers;
                    if (r.writers) newWritersCache[p] = r.writers;
                  });
                  // Always set current path explicitly in case openTaskResults is missing it.
                  newDataCache[documentPath] = current;
                  newReadersCache[documentPath] = readers;
                  newWritersCache[documentPath] = writers;
                  setDocDataCache(newDataCache);
                  setDocReadersCache(newReadersCache);
                  setDocWritersCache(newWritersCache);
                },
                originFilter,
              );
              subscribedDocPath = documentPath;
            }
          }
        } else {
          docRef = collabswarm.doc(documentPath);
          const openPromise: Promise<
            CollabswarmContextOpenResult<any, any, any, any, any, any>
          > = (async () => {
            if (docRef) {
              await docRef.open();
              const readers = await docRef.getReaders();
              const writers = await docRef.getWriters();
              return { docRef, readers, writers };
            }
            return {};
          })();
          openTasks.set(documentPath, openPromise);
          const openTaskResult: CollabswarmContextOpenResult<
            DocType,
            ChangesType,
            ChangeFnType,
            PrivateKey,
            PublicKey,
            DocumentKey
          > = await openPromise;
          if (!active) return;
          openTaskResults.set(documentPath, openTaskResult);
          const { docRef: currentDocRef, readers, writers } = openTaskResult;
          if (currentDocRef) {
            // We can't use the values from the CollabswarmContext created above as those may be "stale"/out of date.
            // Instead we use a global cache (ew, global state) for now to rebuild these caches as they should be.
            newDocCache = {};
            newDocDataCache = {};
            newDocReadersCache = {};
            newDocWritersCache = {};
            openTaskResults.forEach(
              (
                openTaskResult: CollabswarmContextOpenResult<
                  DocType,
                  ChangesType,
                  ChangeFnType,
                  PrivateKey,
                  PublicKey,
                  DocumentKey
                >,
                path,
              ) => {
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
              },
            );

            // Subscribe to document changes (skip if effect was cancelled during open).
            if (!active) return;
            currentDocRef.subscribe(
              subscriptionIdRef.current,
              (current, readers, writers) => {
                // We can't use the values from the CollabswarmContext created above as those may be "stale"/out of date.
                // Instead we use a global cache (ew, global state) for now to rebuild these caches as they should be.
                const currentResults = openTaskResults.get(documentPath);
                const newResults = { ...currentResults, readers, writers };
                openTaskResults.set(documentPath, newResults);
                const newDocDataCache: { [docPath: string]: DocType } = {};
                const newDocReadersCache: {
                  [docPath: string]: PublicKey[];
                } = {};
                const newDocWritersCache: {
                  [docPath: string]: PublicKey[];
                } = {};
                openTaskResults.forEach(
                  (
                    openTaskResult: CollabswarmContextOpenResult<
                      DocType,
                      ChangesType,
                      ChangeFnType,
                      PrivateKey,
                      PublicKey,
                      DocumentKey
                    >,
                    path,
                  ) => {
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
                  },
                );
                setDocDataCache(newDocDataCache);
                setDocReadersCache(newDocReadersCache);
                setDocWritersCache(newDocWritersCache);
              },
              originFilter,
            );

            // Mark that we subscribed so the cleanup function can unsubscribe.
            subscribedDocPath = documentPath;
          }
        }
      } else {
        // Doc is already cached -- subscribe this instance so it receives updates.
        // Each hook instance uses a unique subscription ID so they don't collide.
        if (!active) return;
        docRef.subscribe(
          subscriptionIdRef.current,
          (current, readers, writers) => {
            const newDocDataCache: { [docPath: string]: DocType } = {};
            const newDocReadersCache: { [docPath: string]: PublicKey[] } = {};
            const newDocWritersCache: { [docPath: string]: PublicKey[] } = {};
            openTaskResults.forEach((r, path) => {
              if (r.docRef) {
                newDocDataCache[path] = path === documentPath ? current : r.docRef.document;
              }
              if (r.readers) newDocReadersCache[path] = r.readers;
              if (r.writers) newDocWritersCache[path] = r.writers;
            });
            // Always set current path explicitly in case openTaskResults is missing it.
            newDocDataCache[documentPath] = current;
            const currentResults = openTaskResults.get(documentPath);
            if (currentResults) {
              openTaskResults.set(documentPath, { ...currentResults, readers, writers });
            }
            newDocReadersCache[documentPath] = readers;
            newDocWritersCache[documentPath] = writers;
            setDocDataCache(newDocDataCache);
            setDocReadersCache(newDocReadersCache);
            setDocWritersCache(newDocWritersCache);
          },
          originFilter,
        );
        subscribedDocPath = documentPath;
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

    // Cleanup: cancel async work, unsubscribe this instance's handler.
    return () => {
      active = false;
      if (subscribedDocPath) {
        const taskResult = openTaskResults.get(subscribedDocPath);
        if (taskResult?.docRef) {
          taskResult.docRef.unsubscribe(subscriptionIdRef.current);
        }
      }

      // Decrement subscriber count -- only evict shared caches when the last subscriber unmounts.
      const count = (subscriberCounts.get(documentPath) || 1) - 1;
      if (count <= 0) {
        subscriberCounts.delete(documentPath);
        // Only delete openTasks once the promise has settled to prevent a
        // rapid remount (e.g. React strict-mode) from calling open() again
        // on an already-opened document. openTaskResults is safe to delete
        // immediately since it's only populated after the promise resolves.
        const pendingTask = openTasks.get(documentPath);
        if (pendingTask) {
          pendingTask.then((result) => {
            // Re-check: if a new subscriber appeared while we waited, don't evict.
            if ((subscriberCounts.get(documentPath) || 0) === 0) {
              openTasks.delete(documentPath);
              // Close orphaned document to free network/pubsub resources.
              if (result?.docRef && typeof result.docRef.close === 'function') {
                result.docRef.close().catch(() => {});
              }
            }
          }).catch(() => {
            openTasks.delete(documentPath);
          });
        }
        openTaskResults.delete(documentPath);
        // Rebuild context caches from openTaskResults (the source of truth) rather than
        // using stale captured values, which could clobber entries from other documents.
        const freshDocCache: typeof docCache = {};
        const freshDocDataCache: typeof docDataCache = {};
        const freshDocReadersCache: typeof docReadersCache = {};
        const freshDocWritersCache: typeof docWritersCache = {};
        openTaskResults.forEach((result, path) => {
          if (result.docRef) {
            freshDocCache[path] = result.docRef;
            freshDocDataCache[path] = result.docRef.document;
          }
          if (result.readers) freshDocReadersCache[path] = result.readers;
          if (result.writers) freshDocWritersCache[path] = result.writers;
        });
        setDocCache(freshDocCache);
        setDocDataCache(freshDocDataCache);
        setDocReadersCache(freshDocReadersCache);
        setDocWritersCache(freshDocWritersCache);
      } else {
        subscriberCounts.set(documentPath, count);
      }
    };
  }, [documentPath, collabswarm, originFilter]);

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
