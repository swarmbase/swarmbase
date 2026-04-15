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
      // Iterate via length/item() because DOMStringList is not iterable under
      // this project's tsconfig (lib includes "DOM" but not "DOM.Iterable").
      const existingFieldSet = new Set<string>();
      const indexNames = store.indexNames;
      for (let i = 0; i < indexNames.length; i++) {
        const idxName = indexNames.item(i);
        if (idxName !== null) existingFieldSet.add(idxName);
      }
      // Await the readonly transaction before returning. We issued no requests,
      // but some IDB implementations hold locks until the transaction completes
      // so awaiting here avoids keeping it alive past this function.
      await tx.done;
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

      // IDB key ranges compare filter.value against the raw stored field value,
      // while the JS-side _matchesFilter path normalizes values via
      // _normalizeForComparison (e.g., Date -> timestamp, ISO-8601 string ->
      // timestamp). Using the IDB strategy for values that require normalization
      // would produce different results from the JS path, so we restrict the
      // IDB-accelerated path to filter values that are primitive strings/numbers
      // for which normalization is a no-op.
      if (!this._isIDBAcceleratable(filter.operator, filter.value)) continue;

      // `eq` and `prefix` are "exact" ranges (IDBKeyRange.only / bounded
      // string range) whose IDB cursor only yields keys that already satisfy
      // the filter, so they can be removed from `remainingFilters`.
      //
      // Range operators (`gt`/`gte`/`lt`/`lte`) cannot: IDB's total key order
      // is `number < string < Date < Array`, so e.g. a numeric `lowerBound(5)`
      // cursor will also iterate over every string/Date/Array key in the
      // index. To prevent those cross-type false positives from reaching the
      // caller, keep the range filter in `remainingFilters` so the JS-side
      // `_matchesFilter` re-checks the type and bound on each candidate.
      let dropAcceleratedFilter = false;
      switch (filter.operator) {
        case 'eq':
          keyRange = IDBKeyRange.only(filter.value);
          dropAcceleratedFilter = true;
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
          keyRange = IDBKeyRange.bound(filter.value as string, (filter.value as string) + '\uffff', false, false);
          dropAcceleratedFilter = true;
          break;
        }
        default:
          continue;
      }

      const remainingFilters = dropAcceleratedFilter
        ? filters.filter((_, idx) => idx !== i)
        : filters.slice();
      return { indexFieldPath: filter.path, keyRange, remainingFilters };
    }

    return null;
  }

  /**
   * Determine whether a filter value is safe to use directly in an IDBKeyRange
   * without diverging from the JS-side `_matchesFilter` / `_normalizeForComparison`
   * semantics.
   *
   * - `eq`: safe for both strings and numbers. `IDBKeyRange.only` does an
   *   exact-type equality match, and the JS-side `eq` path uses `===` (no
   *   normalization), so ISO-8601-like date strings are acceptable here -- they
   *   are only problematic when the two sides disagree about normalization.
   * - `prefix`: safe only for strings (bounded string range).
   * - `gt`/`gte`/`lt`/`lte`: accelerated only for finite numeric filter values.
   *   JS comparison coerces cross-type operands (e.g. `10 > '2'` is true) while
   *   `IDBKeyRange` treats each key type as distinct, so allowing strings for
   *   a range operator would silently change the result set when stored keys
   *   are numeric. Date objects and ISO-8601-like date strings are excluded
   *   because they are normalized to numeric timestamps in JS-side comparisons
   *   but stored/compared as their raw types by IDB.
   */
  private _isIDBAcceleratable(operator: FieldFilter['operator'], value: unknown): boolean {
    if (operator === 'prefix') {
      return typeof value === 'string';
    }
    // Range operators: restrict to finite numbers only to avoid cross-type
    // mismatch with stored numeric keys (JS coerces, IDB does not).
    if (operator === 'gt' || operator === 'gte' || operator === 'lt' || operator === 'lte') {
      return typeof value === 'number' && Number.isFinite(value);
    }
    // `eq`: strict-equality on both sides — safe for numbers and strings,
    // including ISO date strings. (Date objects still excluded because they
    // are not valid IDB keys and would fail strict equality anyway.)
    if (operator === 'eq') {
      if (typeof value === 'number') return Number.isFinite(value);
      if (typeof value === 'string') return true;
      return false;
    }
    // Any other operators (neq / in / contains) are not accelerated.
    return false;
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
