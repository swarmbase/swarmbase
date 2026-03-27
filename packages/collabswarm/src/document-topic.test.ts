import { describe, expect, test } from '@jest/globals';
import { documentTopic } from './document-topic';

describe('documentTopic', () => {
  test('returns bare path when using default empty prefix', () => {
    expect(documentTopic('my-doc')).toBe('my-doc');
  });

  test('preserves leading slash with default empty prefix', () => {
    expect(documentTopic('/my-doc')).toBe('/my-doc');
  });

  test('preserves nested paths with default empty prefix', () => {
    expect(documentTopic('/org/team/doc')).toBe('/org/team/doc');
  });

  test('preserves nested paths without leading slash with default empty prefix', () => {
    expect(documentTopic('org/team/doc')).toBe('org/team/doc');
  });

  test('returns empty string for empty path with default empty prefix', () => {
    expect(documentTopic('')).toBe('');
  });

  test('uses a custom prefix', () => {
    expect(documentTopic('my-doc', '/docs/')).toBe('/docs/my-doc');
  });

  test('avoids double slash with custom prefix ending in / and path starting with /', () => {
    expect(documentTopic('/my-doc', '/docs/')).toBe('/docs/my-doc');
  });

  test('inserts slash when prefix does not end with / and path does not start with /', () => {
    expect(documentTopic('my-doc', '/docs')).toBe('/docs/my-doc');
  });

  test('works when prefix does not end with / but path starts with /', () => {
    expect(documentTopic('/my-doc', '/docs')).toBe('/docs/my-doc');
  });

  test('applies /document/ prefix when explicitly provided', () => {
    expect(documentTopic('my-doc', '/document/')).toBe('/document/my-doc');
  });

  test('applies /document/ prefix and avoids double slash', () => {
    expect(documentTopic('/my-doc', '/document/')).toBe('/document/my-doc');
  });
});
