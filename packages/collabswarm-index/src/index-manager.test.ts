import { describe, expect, test, beforeEach } from '@jest/globals';
import { IndexManager } from './index-manager';
import { MemoryIndexStorage } from './memory-index-storage';
import { IndexDefinition } from './types';

async function waitFor(condition: () => Promise<boolean>, timeoutMs: number = 2000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await condition()) return;
    await new Promise(r => setTimeout(r, 10));
  }
  throw new Error('waitFor timed out');
}

interface WikiArticle {
  title: string;
  content: string;
  author: string;
  createdOn: string;
  tags: string[];
}

describe('IndexManager', () => {
  let storage: MemoryIndexStorage;
  let manager: IndexManager<WikiArticle>;
  const articleIndex: IndexDefinition = {
    name: 'articles-by-title',
    collectionPrefix: '/articles/',
    fields: [
      { path: 'title', type: 'string' },
      { path: 'author', type: 'string' },
      { path: 'createdOn', type: 'date' },
    ],
  };

  beforeEach(async () => {
    storage = new MemoryIndexStorage();
    manager = new IndexManager(storage, (doc: WikiArticle) => doc as unknown as Record<string, unknown>);
    await manager.defineIndex(articleIndex);
  });

  describe('defineIndex / removeIndex / getDefinitions', () => {
    test('should register an index definition', () => {
      const defs = manager.getDefinitions();
      expect(defs).toHaveLength(1);
      expect(defs[0].name).toBe('articles-by-title');
    });

    test('should support multiple indexes', async () => {
      await manager.defineIndex({
        name: 'articles-by-author',
        collectionPrefix: '/articles/',
        fields: [{ path: 'author', type: 'string' }],
      });
      expect(manager.getDefinitions()).toHaveLength(2);
    });

    test('should remove an index', async () => {
      await manager.removeIndex('articles-by-title');
      expect(manager.getDefinitions()).toHaveLength(0);
    });
  });

  describe('updateIndex', () => {
    test('should index a matching document', async () => {
      await manager.updateIndex('/articles/1', {
        title: 'Hello World',
        content: 'body',
        author: 'Alice',
        createdOn: '2024-01-01',
        tags: ['intro'],
      });

      const result = await manager.query({
        indexName: 'articles-by-title',
        filters: [{ path: 'title', operator: 'eq', value: 'Hello World' }],
      });
      expect(result.documents).toHaveLength(1);
      expect(result.documents[0].documentPath).toBe('/articles/1');
    });

    test('should skip documents not matching collectionPrefix', async () => {
      await manager.updateIndex('/users/1', {
        title: 'Profile',
        content: '',
        author: 'Bob',
        createdOn: '2024-01-01',
        tags: [],
      });

      const result = await manager.query({
        indexName: 'articles-by-title',
        filters: [],
      });
      expect(result.documents).toHaveLength(0);
    });

    test('should skip write if fields unchanged', async () => {
      const doc: WikiArticle = {
        title: 'Same',
        content: 'changing content',
        author: 'Alice',
        createdOn: '2024-01-01',
        tags: [],
      };
      await manager.updateIndex('/articles/1', doc);

      // Update with same indexed fields (content changes but is not indexed)
      doc.content = 'different content';
      await manager.updateIndex('/articles/1', doc);

      const result = await manager.query({
        indexName: 'articles-by-title',
        filters: [],
      });
      expect(result.documents).toHaveLength(1);
      expect(result.documents[0].snapshot.title).toBe('Same');
    });

    test('should update when indexed fields change', async () => {
      await manager.updateIndex('/articles/1', {
        title: 'v1',
        content: '',
        author: 'Alice',
        createdOn: '2024-01-01',
        tags: [],
      });

      await manager.updateIndex('/articles/1', {
        title: 'v2',
        content: '',
        author: 'Alice',
        createdOn: '2024-01-01',
        tags: [],
      });

      const result = await manager.query({
        indexName: 'articles-by-title',
        filters: [{ path: 'title', operator: 'eq', value: 'v2' }],
      });
      expect(result.documents).toHaveLength(1);
    });
  });

  describe('removeFromIndex', () => {
    test('should remove a document from all indexes', async () => {
      await manager.updateIndex('/articles/1', {
        title: 'Hello',
        content: '',
        author: 'Alice',
        createdOn: '2024-01-01',
        tags: [],
      });

      await manager.removeFromIndex('/articles/1');

      const result = await manager.query({
        indexName: 'articles-by-title',
        filters: [],
      });
      expect(result.documents).toHaveLength(0);
    });
  });

  describe('query', () => {
    beforeEach(async () => {
      const articles: [string, WikiArticle][] = [
        ['/articles/1', { title: 'Alpha', content: '', author: 'Alice', createdOn: '2024-01-01', tags: [] }],
        ['/articles/2', { title: 'Beta', content: '', author: 'Bob', createdOn: '2024-02-01', tags: [] }],
        ['/articles/3', { title: 'Alpha Plus', content: '', author: 'Alice', createdOn: '2024-03-01', tags: [] }],
        ['/articles/4', { title: 'Gamma', content: '', author: 'Charlie', createdOn: '2024-04-01', tags: [] }],
      ];
      for (const [path, doc] of articles) {
        await manager.updateIndex(path, doc);
      }
    });

    test('exact match', async () => {
      const result = await manager.query({
        indexName: 'articles-by-title',
        filters: [{ path: 'title', operator: 'eq', value: 'Beta' }],
      });
      expect(result.documents).toHaveLength(1);
      expect(result.totalCount).toBe(1);
      expect(result.documents[0].documentPath).toBe('/articles/2');
    });

    test('prefix match', async () => {
      const result = await manager.query({
        indexName: 'articles-by-title',
        filters: [{ path: 'title', operator: 'prefix', value: 'Alpha' }],
      });
      expect(result.documents).toHaveLength(2);
    });

    test('sorted results', async () => {
      const result = await manager.query({
        indexName: 'articles-by-title',
        filters: [],
        sort: [{ path: 'createdOn', direction: 'desc' }],
      });
      expect(result.documents.map(d => d.documentPath)).toEqual([
        '/articles/4', '/articles/3', '/articles/2', '/articles/1',
      ]);
    });

    test('pagination with limit and offset', async () => {
      const result = await manager.query({
        indexName: 'articles-by-title',
        filters: [],
        sort: [{ path: 'title', direction: 'asc' }],
        limit: 2,
        offset: 1,
      });
      expect(result.documents).toHaveLength(2);
      expect(result.totalCount).toBe(4);
    });

    test('query by collectionPrefix instead of indexName', async () => {
      const result = await manager.query({
        collectionPrefix: '/articles/',
        filters: [{ path: 'author', operator: 'eq', value: 'Alice' }],
      });
      expect(result.documents).toHaveLength(2);
    });

    test('returns empty for nonexistent index', async () => {
      const result = await manager.query({
        indexName: 'nonexistent',
        filters: [],
      });
      expect(result.documents).toHaveLength(0);
    });
  });

  describe('subscribe', () => {
    test('should fire callback with initial results', async () => {
      await manager.updateIndex('/articles/1', {
        title: 'Hello',
        content: '',
        author: 'Alice',
        createdOn: '2024-01-01',
        tags: [],
      });

      const results: number[] = [];
      const unsub = manager.subscribe(
        { indexName: 'articles-by-title', filters: [] },
        (result) => { results.push(result.totalCount); },
      );

      await waitFor(async () => results.length >= 1);
      expect(results[0]).toBe(1);

      unsub();
    });

    test('should fire callback on updates', async () => {
      const results: number[] = [];
      const unsub = manager.subscribe(
        { indexName: 'articles-by-title', filters: [] },
        (result) => { results.push(result.totalCount); },
      );

      await waitFor(async () => results.length >= 1);

      await manager.updateIndex('/articles/1', {
        title: 'New',
        content: '',
        author: 'Alice',
        createdOn: '2024-01-01',
        tags: [],
      });

      await waitFor(async () => results.includes(1));

      // Should have initial (0) and updated (1) results
      expect(results).toContain(0);
      expect(results).toContain(1);

      unsub();
    });

    test('should stop firing after unsubscribe', async () => {
      const results: number[] = [];
      const unsub = manager.subscribe(
        { indexName: 'articles-by-title', filters: [] },
        (result) => { results.push(result.totalCount); },
      );

      await waitFor(async () => results.length >= 1);
      unsub();
      const countAfterUnsub = results.length;

      await manager.updateIndex('/articles/1', {
        title: 'New',
        content: '',
        author: 'Alice',
        createdOn: '2024-01-01',
        tags: [],
      });
      // Wait a tick and verify no additional callbacks fired
      await waitFor(async () => true, 100);

      expect(results.length).toBe(countAfterUnsub);
    });
  });

  describe('rebuildIndex', () => {
    test('should rebuild from provided documents', async () => {
      await manager.updateIndex('/articles/1', {
        title: 'Stale',
        content: '',
        author: 'Alice',
        createdOn: '2024-01-01',
        tags: [],
      });

      const docs = new Map<string, WikiArticle>();
      docs.set('/articles/2', {
        title: 'Fresh',
        content: '',
        author: 'Bob',
        createdOn: '2024-02-01',
        tags: [],
      });
      docs.set('/articles/3', {
        title: 'New',
        content: '',
        author: 'Charlie',
        createdOn: '2024-03-01',
        tags: [],
      });

      await manager.rebuildIndex('articles-by-title', docs);

      const result = await manager.query({
        indexName: 'articles-by-title',
        filters: [],
      });
      // Should only have the rebuilt docs, not the stale one
      expect(result.totalCount).toBe(2);
      expect(result.documents.map(d => d.snapshot.title).sort()).toEqual(['Fresh', 'New']);
    });

    test('should skip documents not matching collectionPrefix', async () => {
      const docs = new Map<string, WikiArticle>();
      docs.set('/articles/1', { title: 'Match', content: '', author: 'A', createdOn: '2024-01-01', tags: [] });
      docs.set('/users/1', { title: 'NoMatch', content: '', author: 'B', createdOn: '2024-01-01', tags: [] });

      await manager.rebuildIndex('articles-by-title', docs);

      const result = await manager.query({ indexName: 'articles-by-title', filters: [] });
      expect(result.totalCount).toBe(1);
    });
  });
});
