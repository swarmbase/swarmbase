import { describe, expect, test, beforeEach } from '@jest/globals';
import { CollabswarmIndexIntegration, SubscribableDocument } from './collabswarm-index-integration';
import { IndexManager } from './index-manager';
import { MemoryIndexStorage } from './memory-index-storage';

interface MockDoc {
  title: string;
  author: string;
}

async function waitFor(condition: () => Promise<boolean>, timeoutMs: number = 2000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await condition()) return;
    await new Promise(r => setTimeout(r, 10));
  }
  throw new Error('waitFor timed out');
}

class MockSubscribableDocument implements SubscribableDocument<MockDoc> {
  documentPath: string;
  document: MockDoc;
  private _handlers: Map<string, (current: MockDoc, ...args: unknown[]) => void> = new Map();

  constructor(path: string, doc: MockDoc) {
    this.documentPath = path;
    this.document = doc;
  }

  subscribe(
    id: string,
    handler: (current: MockDoc, ...args: unknown[]) => void,
    _originFilter?: 'all' | 'remote' | 'local',
  ): void {
    this._handlers.set(id, handler);
  }

  unsubscribe(id: string): void {
    this._handlers.delete(id);
  }

  /** Simulate a CRDT change event. */
  simulateChange(newDoc: MockDoc): void {
    this.document = newDoc;
    for (const handler of this._handlers.values()) {
      handler(newDoc);
    }
  }

  get handlerCount(): number {
    return this._handlers.size;
  }
}

describe('CollabswarmIndexIntegration', () => {
  let storage: MemoryIndexStorage;
  let manager: IndexManager<MockDoc>;
  let integration: CollabswarmIndexIntegration<MockDoc>;

  beforeEach(async () => {
    storage = new MemoryIndexStorage();
    manager = new IndexManager(storage, (doc: MockDoc) => doc as unknown as Record<string, unknown>);
    await manager.defineIndex({
      name: 'docs',
      collectionPrefix: '/docs/',
      fields: [
        { path: 'title', type: 'string' },
        { path: 'author', type: 'string' },
      ],
    });
    integration = new CollabswarmIndexIntegration(manager);
  });

  describe('trackDocument', () => {
    test('should index the document immediately', async () => {
      const doc = new MockSubscribableDocument('/docs/1', { title: 'Hello', author: 'Alice' });
      integration.trackDocument(doc);

      await waitFor(async () => {
        const result = await manager.query({
          indexName: 'docs',
          filters: [{ path: 'title', operator: 'eq', value: 'Hello' }],
        });
        return result.documents.length === 1;
      });
    });

    test('should subscribe to document changes', async () => {
      const doc = new MockSubscribableDocument('/docs/1', { title: 'v1', author: 'Alice' });
      integration.trackDocument(doc);
      expect(doc.handlerCount).toBe(1);
    });

    test('should update index on document change', async () => {
      const doc = new MockSubscribableDocument('/docs/1', { title: 'v1', author: 'Alice' });
      integration.trackDocument(doc);

      await waitFor(async () => {
        const result = await manager.query({
          indexName: 'docs',
          filters: [{ path: 'title', operator: 'eq', value: 'v1' }],
        });
        return result.documents.length === 1;
      });

      doc.simulateChange({ title: 'v2', author: 'Alice' });

      await waitFor(async () => {
        const result = await manager.query({
          indexName: 'docs',
          filters: [{ path: 'title', operator: 'eq', value: 'v2' }],
        });
        return result.documents.length === 1;
      });
    });

    test('should not double-track the same document', () => {
      const doc = new MockSubscribableDocument('/docs/1', { title: 'v1', author: 'Alice' });
      integration.trackDocument(doc);
      integration.trackDocument(doc);
      expect(doc.handlerCount).toBe(1);
    });
  });

  describe('untrackDocument', () => {
    test('should unsubscribe from document', () => {
      const doc = new MockSubscribableDocument('/docs/1', { title: 'Hello', author: 'Alice' });
      integration.trackDocument(doc);
      integration.untrackDocument(doc);
      expect(doc.handlerCount).toBe(0);
    });

    test('should remove document from index', async () => {
      const doc = new MockSubscribableDocument('/docs/1', { title: 'Hello', author: 'Alice' });
      integration.trackDocument(doc);

      await waitFor(async () => {
        const result = await manager.query({ indexName: 'docs', filters: [] });
        return result.documents.length === 1;
      });

      integration.untrackDocument(doc);

      await waitFor(async () => {
        const result = await manager.query({ indexName: 'docs', filters: [] });
        return result.documents.length === 0;
      });
    });
  });

  describe('getTrackedPaths', () => {
    test('should return tracked document paths', () => {
      integration.trackDocument(new MockSubscribableDocument('/docs/1', { title: 'A', author: 'X' }));
      integration.trackDocument(new MockSubscribableDocument('/docs/2', { title: 'B', author: 'Y' }));
      const paths = integration.getTrackedPaths();
      expect(paths.sort()).toEqual(['/docs/1', '/docs/2']);
    });
  });

  describe('dispose', () => {
    test('should unsubscribe all documents', async () => {
      const doc1 = new MockSubscribableDocument('/docs/1', { title: 'A', author: 'X' });
      const doc2 = new MockSubscribableDocument('/docs/2', { title: 'B', author: 'Y' });
      integration.trackDocument(doc1);
      integration.trackDocument(doc2);

      await integration.dispose();

      expect(doc1.handlerCount).toBe(0);
      expect(doc2.handlerCount).toBe(0);
      expect(integration.getTrackedPaths()).toHaveLength(0);
    });
  });
});
