import { describe, expect, test } from '@jest/globals';

describe('React hooks', () => {
  test('useIndexQuery should be exported as a function', async () => {
    const mod = await import('./react');
    expect(typeof mod.useIndexQuery).toBe('function');
  });

  test('useDefineIndexes should be exported as a function', async () => {
    const mod = await import('./react');
    expect(typeof mod.useDefineIndexes).toBe('function');
  });
});
