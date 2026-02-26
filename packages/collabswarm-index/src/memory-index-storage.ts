import { IndexFieldDefinition, FieldFilter, SortClause } from './types';
import { IndexStorage, IndexEntry } from './index-storage';

/**
 * In-memory implementation of IndexStorage backed by nested Maps.
 * Suitable for tests and Node.js environments where IndexedDB is unavailable.
 */
export class MemoryIndexStorage implements IndexStorage {
  /** indexName → (documentPath → fields) */
  private _stores: Map<string, Map<string, Record<string, unknown>>> = new Map();

  async initialize(_indexName: string, _fields: IndexFieldDefinition[]): Promise<void> {
    if (!this._stores.has(_indexName)) {
      this._stores.set(_indexName, new Map());
    }
  }

  async put(indexName: string, documentPath: string, fields: Record<string, unknown>): Promise<void> {
    const store = this._getStore(indexName);
    store.set(documentPath, { ...fields });
  }

  async delete(indexName: string, documentPath: string): Promise<void> {
    const store = this._stores.get(indexName);
    if (store) {
      store.delete(documentPath);
    }
  }

  async query(
    indexName: string,
    filters: FieldFilter[],
    sort?: SortClause[],
    limit?: number,
    offset?: number,
  ): Promise<IndexEntry[]> {
    const store = this._stores.get(indexName);
    if (!store) return [];

    let results: IndexEntry[] = [];

    for (const [documentPath, fields] of store) {
      if (this._matchesFilters(fields, filters)) {
        results.push({ documentPath, fields: { ...fields } });
      }
    }

    if (sort && sort.length > 0) {
      results.sort((a, b) => this._compareEntries(a.fields, b.fields, sort));
    }

    const start = offset ?? 0;
    if (limit !== undefined) {
      results = results.slice(start, start + limit);
    } else if (start > 0) {
      results = results.slice(start);
    }

    return results;
  }

  async get(indexName: string, documentPath: string): Promise<Record<string, unknown> | undefined> {
    const store = this._stores.get(indexName);
    if (!store) return undefined;
    const fields = store.get(documentPath);
    return fields ? { ...fields } : undefined;
  }

  async clear(indexName: string): Promise<void> {
    const store = this._stores.get(indexName);
    if (store) {
      store.clear();
    }
  }

  async close(): Promise<void> {
    this._stores.clear();
  }

  private _getStore(indexName: string): Map<string, Record<string, unknown>> {
    let store = this._stores.get(indexName);
    if (!store) {
      store = new Map();
      this._stores.set(indexName, store);
    }
    return store;
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
