import {
  IndexDefinition,
  QueryOptions,
  QueryResult,
  DocumentSnapshotExtractor,
} from './types';
import { IndexStorage } from './index-storage';
import { extractField } from './field-extractor';

/**
 * Manages index definitions, incremental updates, and queries over a local materialized index.
 *
 * Designed to be fed by CRDT change events via `CollabswarmDocument.subscribe()`.
 * Queries execute locally against the storage backend with <1ms reads for exact match.
 *
 * @typeParam DocType The CRDT document type (e.g., Y.Doc).
 */
export class IndexManager<DocType> {
  private _storage: IndexStorage;
  private _extractor: DocumentSnapshotExtractor<DocType>;
  private _definitions: Map<string, IndexDefinition> = new Map();
  private _subscriptions: Map<
    number,
    { options: QueryOptions; callback: (result: QueryResult<Record<string, unknown>>) => void }
  > = new Map();
  private _nextSubscriptionId = 1;

  constructor(storage: IndexStorage, extractor: DocumentSnapshotExtractor<DocType>) {
    this._storage = storage;
    this._extractor = extractor;
  }

  /**
   * Register a new index definition. Initializes the storage backend for this index.
   */
  async defineIndex(definition: IndexDefinition): Promise<void> {
    this._definitions.set(definition.name, definition);
    await this._storage.initialize(definition.name, definition.fields);
  }

  /**
   * Remove an index definition and clear its stored data.
   */
  async removeIndex(indexName: string): Promise<void> {
    this._definitions.delete(indexName);
    await this._storage.clear(indexName);
  }

  /**
   * Get all currently registered index definitions.
   */
  getDefinitions(): IndexDefinition[] {
    return Array.from(this._definitions.values());
  }

  /**
   * Update the index entries for a document.
   * Extracts a snapshot, determines which indexes match the document path,
   * extracts indexed fields, and writes to storage.
   * Skips the write if the extracted fields are unchanged from the previous entry.
   */
  async updateIndex(documentPath: string, document: DocType): Promise<void> {
    const snapshot = this._extractor(document);

    for (const [indexName, definition] of this._definitions) {
      if (!documentPath.startsWith(definition.collectionPrefix)) {
        continue;
      }

      const fields: Record<string, unknown> = {};
      for (const fieldDef of definition.fields) {
        fields[fieldDef.path] = extractField(snapshot, fieldDef.path);
      }

      // Diff against previous entry — skip write if unchanged
      const existing = await this._storage.get(indexName, documentPath);
      if (existing && this._fieldsEqual(existing, fields)) {
        continue;
      }

      await this._storage.put(indexName, documentPath, fields);
    }

    this._notifySubscribers();
  }

  /**
   * Remove a document from all indexes.
   */
  async removeFromIndex(documentPath: string): Promise<void> {
    for (const indexName of this._definitions.keys()) {
      await this._storage.delete(indexName, documentPath);
    }
    this._notifySubscribers();
  }

  /**
   * Query the local index.
   */
  async query(options: QueryOptions): Promise<QueryResult<Record<string, unknown>>> {
    const indexName = this._resolveIndexName(options);
    if (!indexName) {
      return { documents: [], totalCount: 0 };
    }

    const entries = await this._storage.query(
      indexName,
      options.filters,
      options.sort,
    );

    const totalCount = entries.length;
    const start = options.offset ?? 0;
    const sliced = options.limit !== undefined
      ? entries.slice(start, start + options.limit)
      : entries.slice(start);

    return {
      documents: sliced.map(entry => ({
        documentPath: entry.documentPath,
        snapshot: entry.fields,
      })),
      totalCount,
    };
  }

  /**
   * Subscribe to live query results. The callback fires when the result set may have changed.
   * Returns an unsubscribe function.
   */
  subscribe(
    options: QueryOptions,
    callback: (result: QueryResult<Record<string, unknown>>) => void,
  ): () => void {
    const id = this._nextSubscriptionId++;
    this._subscriptions.set(id, { options, callback });

    // Fire initial query
    this.query(options).then(callback).catch((err) => {
      console.warn('IndexManager: initial subscription query failed', err);
    });

    return () => {
      this._subscriptions.delete(id);
    };
  }

  /**
   * Rebuild an index from scratch using all provided documents.
   */
  async rebuildIndex(indexName: string, documents: Map<string, DocType>): Promise<void> {
    const definition = this._definitions.get(indexName);
    if (!definition) return;

    await this._storage.clear(indexName);

    for (const [documentPath, document] of documents) {
      if (!documentPath.startsWith(definition.collectionPrefix)) {
        continue;
      }

      const snapshot = this._extractor(document);
      const fields: Record<string, unknown> = {};
      for (const fieldDef of definition.fields) {
        fields[fieldDef.path] = extractField(snapshot, fieldDef.path);
      }

      await this._storage.put(indexName, documentPath, fields);
    }

    this._notifySubscribers();
  }

  /**
   * Resolve which index to query based on options.
   * If indexName is specified, use it directly. Otherwise find an index
   * matching the collectionPrefix.
   */
  private _resolveIndexName(options: QueryOptions): string | undefined {
    if (options.indexName) {
      return this._definitions.has(options.indexName) ? options.indexName : undefined;
    }
    if (options.collectionPrefix) {
      for (const [name, def] of this._definitions) {
        if (def.collectionPrefix === options.collectionPrefix) {
          return name;
        }
      }
    }
    // Return the first defined index as fallback
    const first = this._definitions.keys().next();
    return first.done ? undefined : first.value;
  }

  private _fieldsEqual(a: Record<string, unknown>, b: Record<string, unknown>): boolean {
    const keysA = Object.keys(a);
    const keysB = Object.keys(b);
    if (keysA.length !== keysB.length) return false;
    for (const key of keysA) {
      if (a[key] !== b[key]) return false;
    }
    return true;
  }

  private _notifySubscribers(): void {
    for (const [, sub] of this._subscriptions) {
      this.query(sub.options).then(sub.callback).catch((err) => {
        console.warn('IndexManager: subscription notification query failed', err);
      });
    }
  }
}
