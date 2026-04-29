import { describe, expect, test, beforeEach } from '@jest/globals';
import { IndexManager } from './index-manager';
import { MemoryIndexStorage } from './memory-index-storage';
import { QueryResult } from './types';

// We test the hooks' backing logic by directly exercising IndexManager's
// subscribe()/defineIndex()/removeIndex() — the same primitives the hooks
// wrap. This keeps the tests focused on observable behavior without the
// overhead of standing up a React renderer and jsdom.

describe('React hooks (module surface)', () => {
  test('useIndexQuery should be exported as a function', async () => {
    const mod = await import('./react');
    expect(typeof mod.useIndexQuery).toBe('function');
  });

  test('useDefineIndexes should be exported as a function', async () => {
    const mod = await import('./react');
    expect(typeof mod.useDefineIndexes).toBe('function');
  });
});

describe('React hook backing logic (subscribe + defineIndex)', () => {
  let storage: MemoryIndexStorage;
  let manager: IndexManager<Record<string, unknown>>;

  beforeEach(async () => {
    storage = new MemoryIndexStorage();
    manager = new IndexManager(storage, (doc) => doc);
    await manager.defineIndex({
      name: 'items',
      collectionPrefix: '/items/',
      fields: [
        { path: 'name', type: 'string' },
        { path: 'priority', type: 'number' },
      ],
    });
  });

  test('subscribe delivers initial empty result (useIndexQuery lifecycle)', async () => {
    const results: QueryResult<Record<string, unknown>>[] = [];
    const unsub = manager.subscribe(
      { indexName: 'items', filters: [] },
      (r) => results.push(r),
    );

    // Wait for async initial delivery
    await new Promise((r) => setTimeout(r, 50));

    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results[0].totalCount).toBe(0);
    expect(results[0].documents).toEqual([]);

    unsub();
  });

  test('subscribe delivers updated results after index change', async () => {
    const results: QueryResult<Record<string, unknown>>[] = [];
    const unsub = manager.subscribe(
      { indexName: 'items', filters: [] },
      (r) => results.push(r),
    );

    await new Promise((r) => setTimeout(r, 50));

    await manager.updateIndex('/items/1', { name: 'Task A', priority: 1 });

    await new Promise((r) => setTimeout(r, 50));

    // Should have received at least 2 results: initial (0) and after insert (1)
    expect(results.some((r) => r.totalCount === 0)).toBe(true);
    expect(results.some((r) => r.totalCount === 1)).toBe(true);

    unsub();
  });

  test('subscribe with filters only delivers matching documents', async () => {
    await manager.updateIndex('/items/1', { name: 'Low', priority: 1 });
    await manager.updateIndex('/items/2', { name: 'High', priority: 10 });

    const results: QueryResult<Record<string, unknown>>[] = [];
    const unsub = manager.subscribe(
      {
        indexName: 'items',
        filters: [{ path: 'priority', operator: 'gte', value: 5 }],
      },
      (r) => results.push(r),
    );

    await new Promise((r) => setTimeout(r, 50));

    expect(results.length).toBeGreaterThanOrEqual(1);
    const latest = results[results.length - 1];
    expect(latest.totalCount).toBe(1);
    expect(latest.documents[0].snapshot.name).toBe('High');

    unsub();
  });

  test('unsubscribe prevents further callbacks (useIndexQuery teardown)', async () => {
    const results: QueryResult<Record<string, unknown>>[] = [];
    const unsub = manager.subscribe(
      { indexName: 'items', filters: [] },
      (r) => results.push(r),
    );

    await new Promise((r) => setTimeout(r, 50));
    unsub();
    const countAfter = results.length;

    await manager.updateIndex('/items/1', { name: 'X', priority: 1 });
    await new Promise((r) => setTimeout(r, 50));

    expect(results.length).toBe(countAfter);
  });

  test('defineIndex + removeIndex lifecycle (useDefineIndexes mount/unmount)', async () => {
    const newDef = {
      name: 'tags',
      collectionPrefix: '/tags/',
      fields: [{ path: 'label', type: 'string' as const }],
    };

    await manager.defineIndex(newDef);
    expect(manager.getDefinitions().map((d) => d.name)).toContain('tags');

    await manager.removeIndex('tags');
    expect(manager.getDefinitions().map((d) => d.name)).not.toContain('tags');
  });

  test('subscribe with sort and pagination', async () => {
    await manager.updateIndex('/items/a', { name: 'C', priority: 3 });
    await manager.updateIndex('/items/b', { name: 'A', priority: 1 });
    await manager.updateIndex('/items/c', { name: 'B', priority: 2 });

    const results: QueryResult<Record<string, unknown>>[] = [];
    const unsub = manager.subscribe(
      {
        indexName: 'items',
        filters: [],
        sort: [{ path: 'priority', direction: 'asc' }],
        limit: 2,
        offset: 0,
      },
      (r) => results.push(r),
    );

    await new Promise((r) => setTimeout(r, 50));

    const latest = results[results.length - 1];
    expect(latest.totalCount).toBe(3);
    expect(latest.documents).toHaveLength(2);
    expect(latest.documents[0].snapshot.name).toBe('A');
    expect(latest.documents[1].snapshot.name).toBe('B');

    unsub();
  });
});
