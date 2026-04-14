import { openDB, IDBPDatabase } from 'idb';
import { IndexFieldDefinition, FieldFilter, SortClause } from './types';
import { IndexStorage, IndexEntry } from './index-storage';

/**
 * IndexedDB-backed implementation of IndexStorage using the `idb` library.
 * Each index is stored as a separate IDB object store with `documentPath` as key path.
 */
export class IDBIndexStorage implements IndexStorage {
  private _dbName: string;
  private _db: IDBPDatabase | null = null;
  private _initializedStores: Set<string> = new Set();
  /** Tracks which IDB indexes exist per store, so query() can use them for fast lookups. */
  private _indexedFields: Map<string, Set<string>> = new Map();

  constructor(dbName: string = 'collabswarm-index') {
    this._dbName = dbName;
  }

  async initialize(indexName: string, fields: IndexFieldDefinition[]): Promise<void> {
    if (this._initializedStores.has(indexName) && this._db) return;

    // Close existing connection before upgrading
    if (this._db) {
      this._db.close();
      this._db = null;
    }

    // Read current version from existing DB
    const existingDb = await openDB(this._dbName);
    const currentVersion = existingDb.version;
    const storeAlreadyExists = existingDb.objectStoreNames.contains(indexName);
    existingDb.close();

    if (storeAlreadyExists) {
      // Store already exists -- just reopen at current version
      this._db = await openDB(this._dbName, currentVersion);
      // Read actual indexes from the existing store instead of trusting the requested fields
      const tx = this._db.transaction(indexName, 'readonly');
      const store = tx.objectStore(indexName);
      const existingFieldSet = new Set<string>();
      for (const idxName of store.indexNames) {
        existingFieldSet.add(idxName);
      }
      this._indexedFields.set(indexName, existingFieldSet);
      this._initializedStores.add(indexName);
      return;
    } else {
      // Need to create a new object store -- requires version upgrade
      const newVersion = currentVersion + 1;
      this._db = await openDB(this._dbName, newVersion, {
        upgrade(db) {
          if (!db.objectStoreNames.contains(indexName)) {
            const store = db.createObjectStore(indexName, { keyPath: 'documentPath' });
            for (const field of fields) {
              store.createIndex(field.path, `fields.${field.path}`, { unique: false });
            }
          }
        },
      });
    }

    // Track which fields have IDB indexes for this store
    const fieldSet = new Set<string>();
    for (const field of fields) {
      fieldSet.add(field.path);
    }
    this._indexedFields.set(indexName, fieldSet);

    this._initializedStores.add(indexName);
  }

  async put(indexName: string, documentPath: string, fields: Record<string, unknown>): Promise<void> {
    const db = this._getDB();
    await db.put(indexName, { documentPath, fields: { ...fields } });
  }

  async delete(indexName: string, documentPath: string): Promise<void> {
    const db = this._getDB();
    await db.delete(indexName, documentPath);
  }

  async query(
    indexName: string,
    filters: FieldFilter[],
    sort?: SortClause[],
    limit?: number,
    offset?: number,
  ): Promise<IndexEntry[]> {
    const db = this._getDB();

    if (offset !== undefined && offset < 0) {
      throw new RangeError(`offset must be non-negative, got ${offset}`);
    }
    if (limit !== undefined && limit < 0) {
      throw new RangeError(`limit must be non-negative, got ${limit}`);
    }

    if (!db.objectStoreNames.contains(indexName)) return [];

    const tx = db.transaction(indexName, 'readonly');
    const store = tx.objectStore(indexName);

    let results: IndexEntry[] = [];

    // Optimization: leverage IDB indexes for single-field equality or range queries
    // on indexed fields instead of always doing a full JS scan.
    const idbStrategy = this._pickIDBStrategy(indexName, filters);

    if (idbStrategy) {
      const { indexFieldPath, keyRange, remainingFilters } = idbStrategy;
      const idbIndex = store.index(indexFieldPath);
      let cursor = await idbIndex.openCursor(keyRange);
      while (cursor) {
        const record = cursor.value as { documentPath: string; fields: Record<string, unknown> };
        if (this._matchesFilters(record.fields, remainingFilters)) {
          results.push({ documentPath: record.documentPath, fields: { ...record.fields } });
        }
        cursor = await cursor.continue();
      }
    } else {
      // Fallback: full scan with JS-side filtering
      let cursor = await store.openCursor();
      while (cursor) {
        const record = cursor.value as { documentPath: string; fields: Record<string, unknown> };
        if (this._matchesFilters(record.fields, filters)) {
          results.push({ documentPath: record.documentPath, fields: { ...record.fields } });
        }
        cursor = await cursor.continue();
      }
    }

    await tx.done;

    // Sort in JavaScript
    if (sort && sort.length > 0) {
      results.sort((a, b) => this._compareEntries(a.fields, b.fields, sort));
    }

    // Apply pagination
    const start = offset ?? 0;
    if (limit !== undefined) {
      results = results.slice(start, start + limit);
    } else if (start > 0) {
      results = results.slice(start);
    }

    return results;
  }

  async get(indexName: string, documentPath: string): Promise<Record<string, unknown> | undefined> {
    const db = this._getDB();

    if (!db.objectStoreNames.contains(indexName)) return undefined;

    const record = await db.get(indexName, documentPath) as { documentPath: string; fields: Record<string, unknown> } | undefined;
    return record ? { ...record.fields } : undefined;
  }

  async clear(indexName: string): Promise<void> {
    const db = this._getDB();
    if (db.objectStoreNames.contains(indexName)) {
      await db.clear(indexName);
    }
  }

  async close(): Promise<void> {
    if (this._db) {
      this._db.close();
      this._db = null;
    }
    // After close(), initialize() will reopen the database; this set just tracks which stores exist.
  }

  private _getDB(): IDBPDatabase {
    if (!this._db) {
      throw new Error('IDBIndexStorage: database not initialized. Call initialize() first.');
    }
    return this._db;
  }

  /**
   * Determine whether an IDB index can accelerate the query.
   *
   * Eligible cases (the first matching filter wins):
   *   - A single-field `eq` filter on an indexed field uses `IDBKeyRange.only(value)`.
   *   - A single-field `gt`/`gte`/`lt`/`lte` filter on an indexed field uses
   *     the corresponding open/closed bound.
   *   - A `prefix` filter on an indexed string field uses a lower/upper bound range.
   *
   * Any remaining filters that cannot be served by the IDB index are returned
   * as `remainingFilters` and applied in JavaScript after the cursor scan.
   */
  private _pickIDBStrategy(
    indexName: string,
    filters: FieldFilter[],
  ): { indexFieldPath: string; keyRange: IDBKeyRange | null; remainingFilters: FieldFilter[] } | null {
    if (filters.length === 0) return null;

    const indexedFields = this._indexedFields.get(indexName);
    if (!indexedFields) return null;

    for (let i = 0; i < filters.length; i++) {
      const filter = filters[i];
      // Only use IDB-accelerated lookup when an IDB index exists for this field
      if (!indexedFields.has(filter.path)) continue;

      let keyRange: IDBKeyRange | null = null;

      // Note: IDB key ranges use filter.value as-is (no normalization).
      // The JS-side _matchesFilter path normalizes values (e.g., Date → timestamp,
      // ISO-8601 string → timestamp) via _normalizeForComparison, but IDB indexes
      // store raw field values. Therefore IDB-accelerated queries only produce
      // correct results when filter.value is a primitive that matches the stored
      // type exactly (string or number). Date objects or values requiring
      // normalization will not match and should fall through to the JS scan path.
      switch (filter.operator) {
        case 'eq':
          keyRange = IDBKeyRange.only(filter.value);
          break;
        case 'gt':
          keyRange = IDBKeyRange.lowerBound(filter.value, true);
          break;
        case 'gte':
          keyRange = IDBKeyRange.lowerBound(filter.value, false);
          break;
        case 'lt':
          keyRange = IDBKeyRange.upperBound(filter.value, true);
          break;
        case 'lte':
          keyRange = IDBKeyRange.upperBound(filter.value, false);
          break;
        case 'prefix': {
          if (typeof filter.value !== 'string') continue;
          keyRange = IDBKeyRange.bound(filter.value, filter.value + '\uffff', false, false);
          break;
        }
        default:
          continue;
      }

      // Remove the accelerated filter; the rest still need JS-side evaluation
      const remainingFilters = filters.filter((_, idx) => idx !== i);
      return { indexFieldPath: filter.path, keyRange, remainingFilters };
    }

    return null;
  }

  private _matchesFilters(fields: Record<string, unknown>, filters: FieldFilter[]): boolean {
    return filters.every(filter => this._matchesFilter(fields, filter));
  }

  private _matchesFilter(fields: Record<string, unknown>, filter: FieldFilter): boolean {
    const value = this._resolveFieldPath(fields, filter.path);

    switch (filter.operator) {
      case 'eq':
        return value === filter.value;

      case 'neq':
        return value !== filter.value;

      case 'gt': {
        const [nv, nfv] = [this._normalizeForComparison(value), this._normalizeForComparison(filter.value)];
        return nv !== undefined && nv !== null && nfv !== undefined && nfv !== null && nv > nfv;
      }

      case 'gte': {
        const [nv, nfv] = [this._normalizeForComparison(value), this._normalizeForComparison(filter.value)];
        return nv !== undefined && nv !== null && nfv !== undefined && nfv !== null && nv >= nfv;
      }

      case 'lt': {
        const [nv, nfv] = [this._normalizeForComparison(value), this._normalizeForComparison(filter.value)];
        return nv !== undefined && nv !== null && nfv !== undefined && nfv !== null && nv < nfv;
      }

      case 'lte': {
        const [nv, nfv] = [this._normalizeForComparison(value), this._normalizeForComparison(filter.value)];
        return nv !== undefined && nv !== null && nfv !== undefined && nfv !== null && nv <= nfv;
      }

      case 'prefix':
        return typeof value === 'string' && typeof filter.value === 'string' && value.startsWith(filter.value);

      case 'in':
        return Array.isArray(filter.value) && filter.value.includes(value);

      case 'contains':
        return typeof value === 'string' && typeof filter.value === 'string' && value.includes(filter.value);

      default:
        return false;
    }
  }

  private _resolveFieldPath(obj: Record<string, unknown>, path: string): unknown {
    const segments = path.split('.');
    let current: unknown = obj;
    for (const segment of segments) {
      if (current === null || current === undefined || typeof current !== 'object') {
        return undefined;
      }
      current = (current as Record<string, unknown>)[segment];
    }
    return current;
  }

  private _compareEntries(
    a: Record<string, unknown>,
    b: Record<string, unknown>,
    sort: SortClause[],
  ): number {
    for (const clause of sort) {
      const va = this._resolveFieldPath(a, clause.path);
      const vb = this._resolveFieldPath(b, clause.path);
      const cmp = this._compareValues(va, vb);
      if (cmp !== 0) {
        return clause.direction === 'desc' ? -cmp : cmp;
      }
    }
    return 0;
  }

  private _normalizeForComparison(value: unknown): number | string | boolean | null | undefined {
    if (value instanceof Date) return value.getTime();
    if (typeof value === 'string') {
      const timestamp = Date.parse(value);
      if (!isNaN(timestamp) && /^\d{4}-\d{2}-\d{2}/.test(value)) {
        return timestamp;
      }
    }
    return value as number | string | boolean | null | undefined;
  }

  private _compareValues(a: unknown, b: unknown): number {
    const na = this._normalizeForComparison(a);
    const nb = this._normalizeForComparison(b);
    if (na === nb) return 0;
    if (na === undefined || na === null) return -1;
    if (nb === undefined || nb === null) return 1;
    if (typeof na === 'number' && typeof nb === 'number') return na - nb;
    if (typeof na === 'string' && typeof nb === 'string') return na.localeCompare(nb);
    if (typeof na === 'boolean' && typeof nb === 'boolean') return (na ? 1 : 0) - (nb ? 1 : 0);
    return String(na).localeCompare(String(nb));
  }
}
