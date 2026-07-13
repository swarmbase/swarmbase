import { describe, expect, test } from '@jest/globals';
import { hasBootstrapPeers } from './bootstrap-config';

describe('bootstrap configuration', () => {
  test('omits bootstrap discovery for a valid standalone swarm', () => {
    expect(hasBootstrapPeers({ list: [] })).toBe(false);
  });

  test('enables bootstrap discovery when an address is configured', () => {
    expect(hasBootstrapPeers({ list: ['/ip4/127.0.0.1/tcp/9001/ws'] })).toBe(true);
  });
});
