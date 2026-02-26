import { describe, expect, test } from '@jest/globals';
import { useIndexQuery, useDefineIndexes } from './react';

describe('React hooks', () => {
  test('useIndexQuery should be a function', () => {
    expect(typeof useIndexQuery).toBe('function');
  });

  test('useDefineIndexes should be a function', () => {
    expect(typeof useDefineIndexes).toBe('function');
  });
});
