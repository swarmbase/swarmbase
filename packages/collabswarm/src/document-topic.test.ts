import { describe, expect, test } from '@jest/globals';
import { documentTopic } from './document-topic';

describe('documentTopic', () => {
  test('prepends default /document/ prefix to a path without leading slash', () => {
    expect(documentTopic('my-doc')).toBe('/document/my-doc');
  });

  test('avoids double slash when path starts with /', () => {
    expect(documentTopic('/my-doc')).toBe('/document/my-doc');
  });

  test('handles nested paths', () => {
    expect(documentTopic('/org/team/doc')).toBe('/document/org/team/doc');
  });

  test('handles nested paths without leading slash', () => {
    expect(documentTopic('org/team/doc')).toBe('/document/org/team/doc');
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

  test('handles empty document path with default prefix', () => {
    expect(documentTopic('')).toBe('/document/');
  });
});
