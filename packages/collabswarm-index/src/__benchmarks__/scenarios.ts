import { BenchmarkRunner } from './benchmark-runner';
import { BenchmarkResult } from '../types';
import { MemoryIndexStorage } from '../memory-index-storage';
import { IndexManager } from '../index-manager';
import { BloomFilterCRDT } from '../bloom-filter-crdt';
import { generateDocuments } from './mock-data';

/**
 * Run all benchmark scenarios at a given document count.
 */
export async function runAllScenarios(count: number): Promise<BenchmarkResult[]> {
  const runner = new BenchmarkRunner();
  const results: BenchmarkResult[] = [];

  // Setup: build index
  const storage = new MemoryIndexStorage();
  const manager = new IndexManager<Record<string, unknown>>(storage, (doc) => doc);
  await manager.defineIndex({
    name: 'articles',
    collectionPrefix: '/articles/',
    fields: [
      { path: 'title', type: 'string' },
      { path: 'author', type: 'string' },
      { path: 'category', type: 'string' },
      { path: 'createdOn', type: 'date' },
      { path: 'viewCount', type: 'number' },
    ],
  });

  const docs = generateDocuments('wiki', count);
  for (const [path, doc] of docs) {
    await manager.updateIndex(path, doc);
  }

  // Benchmark: exact match query
  results.push(await runner.run(`exact-match-${count}`, async () => {
    await manager.query({
      indexName: 'articles',
      filters: [{ path: 'author', operator: 'eq', value: 'Alice' }],
    });
  }));

  // Benchmark: range query
  results.push(await runner.run(`range-query-${count}`, async () => {
    await manager.query({
      indexName: 'articles',
      filters: [{ path: 'viewCount', operator: 'gte', value: 500 }],
    });
  }));

  // Benchmark: prefix query
  results.push(await runner.run(`prefix-query-${count}`, async () => {
    await manager.query({
      indexName: 'articles',
      filters: [{ path: 'title', operator: 'prefix', value: 'Article 1' }],
    });
  }));

  // Benchmark: sorted query
  results.push(await runner.run(`sorted-query-${count}`, async () => {
    await manager.query({
      indexName: 'articles',
      filters: [],
      sort: [{ path: 'createdOn', direction: 'desc' }],
      limit: 20,
    });
  }));

  // Benchmark: index update (single doc)
  let updateId = 0;
  results.push(await runner.run(`index-update-${count}`, async () => {
    await manager.updateIndex(`/articles/${updateId++ % count}`, {
      title: `Updated ${updateId}`,
      author: 'Updater',
      category: 'Updated',
      createdOn: new Date().toISOString(),
      viewCount: updateId,
      content: 'updated',
      tags: ['updated'],
    });
  }));

  // Benchmark: bulk insert (fresh index)
  results.push(await runner.run(`bulk-insert-${count}`, async () => {
    const freshStorage = new MemoryIndexStorage();
    const freshManager = new IndexManager<Record<string, unknown>>(freshStorage, (doc) => doc);
    await freshManager.defineIndex({
      name: 'articles',
      collectionPrefix: '/articles/',
      fields: [
        { path: 'title', type: 'string' },
        { path: 'author', type: 'string' },
      ],
    });
    for (const [path, doc] of docs) {
      await freshManager.updateIndex(path, doc);
    }
  }, 10)); // fewer iterations for bulk ops

  // Benchmark: bloom filter operations
  results.push(await runner.run(`bloom-add-${count}`, () => {
    const filter = new BloomFilterCRDT(65536, 7);
    for (let i = 0; i < count; i++) {
      filter.add(`term_${i}`);
    }
  }, 10));

  results.push(await runner.run(`bloom-query-${count}`, () => {
    const filter = new BloomFilterCRDT(65536, 7);
    for (let i = 0; i < count; i++) {
      filter.add(`term_${i}`);
    }
    for (let i = 0; i < 100; i++) {
      filter.has(`term_${i}`);
      filter.has(`missing_${i}`);
    }
  }, 10));

  // Benchmark: full scan baseline (no index)
  const docsArray = Array.from(docs.entries());
  results.push(await runner.run(`full-scan-baseline-${count}`, () => {
    const matches = docsArray.filter(([, doc]) => doc.author === 'Alice');
    void matches.length; // prevent optimization
  }));

  return results;
}
