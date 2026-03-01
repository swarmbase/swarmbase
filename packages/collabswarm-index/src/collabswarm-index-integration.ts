import { IndexManager } from './index-manager';

/**
 * Minimal document interface matching CollabswarmDocument's subscribe API.
 * Avoids coupling to the full generic CollabswarmDocument class.
 */
export interface SubscribableDocument<DocType> {
  readonly documentPath: string;
  readonly document: DocType;
  subscribe(
    id: string,
    handler: (current: DocType, ...args: unknown[]) => void,
    originFilter?: 'all' | 'remote' | 'local',
  ): void;
  unsubscribe(id: string): void;
}

const INDEX_HANDLER_PREFIX = '__collabswarm_index_';

/**
 * Wires an IndexManager to CollabswarmDocument instances via their subscribe() API.
 * Tracks multiple documents and automatically updates the index on every change.
 *
 * @typeParam DocType The CRDT document type (e.g., Y.Doc).
 */
export class CollabswarmIndexIntegration<DocType> {
  private _manager: IndexManager<DocType>;
  private _trackedDocuments: Map<string, SubscribableDocument<DocType>> = new Map();

  constructor(manager: IndexManager<DocType>) {
    this._manager = manager;
  }

  /** The underlying IndexManager. */
  get manager(): IndexManager<DocType> {
    return this._manager;
  }

  /**
   * Begin tracking a document. Subscribes to all changes and indexes the current state.
   */
  trackDocument(doc: SubscribableDocument<DocType>): void {
    if (this._trackedDocuments.has(doc.documentPath)) {
      return;
    }

    this._trackedDocuments.set(doc.documentPath, doc);

    const handlerId = INDEX_HANDLER_PREFIX + doc.documentPath;

    doc.subscribe(
      handlerId,
      (current: DocType) => {
        this._manager.updateIndex(doc.documentPath, current).catch((err) => {
          console.warn(`CollabswarmIndexIntegration: failed to update index for ${doc.documentPath}`, err);
        });
      },
      'all',
    );

    // Index current state immediately
    this._manager.updateIndex(doc.documentPath, doc.document).catch((err) => {
      console.warn(`CollabswarmIndexIntegration: failed to index initial state of ${doc.documentPath}`, err);
    });
  }

  /**
   * Stop tracking a document. Unsubscribes from changes and removes from index.
   */
  untrackDocument(documentPath: string): void;
  untrackDocument(doc: SubscribableDocument<DocType>): void;
  untrackDocument(docOrPath: SubscribableDocument<DocType> | string): void {
    const path = typeof docOrPath === 'string' ? docOrPath : docOrPath.documentPath;
    const tracked = this._trackedDocuments.get(path);
    if (!tracked) return;
    const handlerId = INDEX_HANDLER_PREFIX + path;
    tracked.unsubscribe(handlerId);
    this._trackedDocuments.delete(path);
    this._manager.removeFromIndex(path).catch((err) => {
      console.warn(`CollabswarmIndexIntegration: failed to remove ${path} from index`, err);
    });
  }

  /**
   * Get the set of currently tracked document paths.
   */
  getTrackedPaths(): string[] {
    return Array.from(this._trackedDocuments.keys());
  }

  /**
   * Stop tracking all documents and unsubscribe handlers.
   * Does not close the index manager's storage.
   */
  async dispose(): Promise<void> {
    for (const [, doc] of this._trackedDocuments) {
      const handlerId = INDEX_HANDLER_PREFIX + doc.documentPath;
      doc.unsubscribe(handlerId);
    }
    this._trackedDocuments.clear();
  }
}
