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
        this._manager.updateIndex(doc.documentPath, current).catch(() => {});
      },
      'all',
    );

    // Index current state immediately
    this._manager.updateIndex(doc.documentPath, doc.document).catch(() => {});
  }

  /**
   * Stop tracking a document. Unsubscribes from changes and removes from index.
   */
  untrackDocument(doc: SubscribableDocument<DocType>): void {
    const handlerId = INDEX_HANDLER_PREFIX + doc.documentPath;
    doc.unsubscribe(handlerId);
    this._trackedDocuments.delete(doc.documentPath);
    this._manager.removeFromIndex(doc.documentPath).catch(() => {});
  }

  /**
   * Get the set of currently tracked document paths.
   */
  getTrackedPaths(): string[] {
    return Array.from(this._trackedDocuments.keys());
  }

  /**
   * Stop tracking all documents and close the index manager's storage.
   */
  async dispose(): Promise<void> {
    for (const [, doc] of this._trackedDocuments) {
      const handlerId = INDEX_HANDLER_PREFIX + doc.documentPath;
      doc.unsubscribe(handlerId);
    }
    this._trackedDocuments.clear();
  }
}
