import { describe, expect, test, afterEach } from '@jest/globals';
import { openTasks, openTaskResults, subscriberCounts } from './hooks-cache';

function resetCaches() {
  openTasks.clear();
  openTaskResults.clear();
  subscriberCounts.clear();
}

afterEach(() => {
  resetCaches();
});

describe('hooks-cache module-level maps', () => {
  test('openTasks starts empty', () => {
    expect(openTasks.size).toBe(0);
  });

  test('openTaskResults starts empty', () => {
    expect(openTaskResults.size).toBe(0);
  });

  test('subscriberCounts starts empty', () => {
    expect(subscriberCounts.size).toBe(0);
  });

  test('openTasks stores and retrieves promises by document path', async () => {
    const mockResult = { docRef: { document: 'test' } as any, readers: ['r1'], writers: ['w1'] };
    const promise = Promise.resolve(mockResult);
    openTasks.set('/doc/a', promise);

    expect(openTasks.has('/doc/a')).toBe(true);
    expect(openTasks.has('/doc/b')).toBe(false);

    const retrieved = await openTasks.get('/doc/a');
    expect(retrieved).toBe(mockResult);
  });

  test('openTaskResults stores and retrieves results by document path', () => {
    const result = { docRef: { document: 'hello' } as any, readers: ['r'], writers: ['w'] };
    openTaskResults.set('/my-doc', result);

    expect(openTaskResults.get('/my-doc')).toBe(result);
    expect(openTaskResults.size).toBe(1);
  });

  test('subscriberCounts increments and decrements correctly', () => {
    subscriberCounts.set('/doc', 1);
    expect(subscriberCounts.get('/doc')).toBe(1);

    subscriberCounts.set('/doc', (subscriberCounts.get('/doc') || 0) + 1);
    expect(subscriberCounts.get('/doc')).toBe(2);

    const count = (subscriberCounts.get('/doc') || 1) - 1;
    subscriberCounts.set('/doc', count);
    expect(subscriberCounts.get('/doc')).toBe(1);
  });

  test('multiple document paths are independent', () => {
    subscriberCounts.set('/doc/a', 3);
    subscriberCounts.set('/doc/b', 1);
    openTaskResults.set('/doc/a', { docRef: {} as any });
    openTaskResults.set('/doc/b', { docRef: {} as any });

    subscriberCounts.delete('/doc/b');
    openTaskResults.delete('/doc/b');

    expect(subscriberCounts.has('/doc/a')).toBe(true);
    expect(subscriberCounts.has('/doc/b')).toBe(false);
    expect(openTaskResults.has('/doc/a')).toBe(true);
    expect(openTaskResults.has('/doc/b')).toBe(false);
  });

  test('clear removes all entries from all caches', () => {
    openTasks.set('/a', Promise.resolve({}));
    openTasks.set('/b', Promise.resolve({}));
    openTaskResults.set('/a', { docRef: {} as any });
    subscriberCounts.set('/a', 2);

    resetCaches();

    expect(openTasks.size).toBe(0);
    expect(openTaskResults.size).toBe(0);
    expect(subscriberCounts.size).toBe(0);
  });
});
