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
  private _version: number = 0;
  private _initializedStores: Set<string> = new Set();

  constructor(dbName: string = 'collabswarm-index') {
    this._dbName = dbName;
  }

  async initialize(indexName: string, fields: IndexFieldDefinition[]): Promise<void> {
    if (this._initializedStores.has(indexName)) return;

    // Close existing connection before upgrading
    if (this._db) {
      this._db.close();
      this._db = null;
    }

    this._version++;
    const version = this._version;
    const allStores = new Set(this._initializedStores);
    allStores.add(indexName);

    this._db = await openDB(this._dbName, version, {
      upgrade(db) {
        if (!db.objectStoreNames.contains(indexName)) {
          const store = db.createObjectStore(indexName, { keyPath: 'documentPath' });
          for (const field of fields) {
            store.createIndex(field.path, `fields.${field.path}`, { unique: false });
          }
        }
      },
    });

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

    if (!db.objectStoreNames.contains(indexName)) return [];

    const tx = db.transaction(indexName, 'readonly');
    const store = tx.objectStore(indexName);

    let results: IndexEntry[] = [];

    // Scan all entries and apply filters in JS
    let cursor = await store.openCursor();
    while (cursor) {
      const record = cursor.value as { documentPath: string; fields: Record<string, unknown> };
      if (this._matchesFilters(record.fields, filters)) {
        results.push({ documentPath: record.documentPath, fields: { ...record.fields } });
      }
      cursor = await cursor.continue();
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
    this._initializedStores.clear();
    this._version = 0;
  }

  private _getDB(): IDBPDatabase {
    if (!this._db) {
      throw new Error('IDBIndexStorage: database not initialized. Call initialize() first.');
    }
    return this._db;
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

      case 'gt':
        return value !== undefined && value !== null && (value as number | string | Date) > (filter.value as number | string | Date);

      case 'gte':
        return value !== undefined && value !== null && (value as number | string | Date) >= (filter.value as number | string | Date);

      case 'lt':
        return value !== undefined && value !== null && (value as number | string | Date) < (filter.value as number | string | Date);

      case 'lte':
        return value !== undefined && value !== null && (value as number | string | Date) <= (filter.value as number | string | Date);

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

  private _compareValues(a: unknown, b: unknown): number {
    if (a === b) return 0;
    if (a === undefined || a === null) return -1;
    if (b === undefined || b === null) return 1;
    if (typeof a === 'number' && typeof b === 'number') return a - b;
    if (typeof a === 'string' && typeof b === 'string') return a.localeCompare(b);
    if (typeof a === 'boolean' && typeof b === 'boolean') return (a ? 1 : 0) - (b ? 1 : 0);
    return String(a).localeCompare(String(b));
  }
}
