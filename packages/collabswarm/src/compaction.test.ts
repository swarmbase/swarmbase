import { describe, expect, test } from '@jest/globals';
import {
  CompactionConfig,
  defaultCompactionConfig,
} from './compaction-config';
import { CRDTSnapshotNode } from './snapshot-node';

describe('CompactionConfig', () => {
  test('default config has compaction disabled', () => {
    expect(defaultCompactionConfig.enabled).toBe(false);
  });

  test('default config has reasonable defaults', () => {
    expect(defaultCompactionConfig.snapshotInterval).toBe(500);
    expect(defaultCompactionConfig.minChangesBeforeSnapshot).toBe(100);
    expect(defaultCompactionConfig.pruneAfterSnapshot).toBe(true);
    expect(defaultCompactionConfig.keepRecentNodes).toBe(50);
  });

  test('default config has gcAfterPrune disabled', () => {
    expect(defaultCompactionConfig.gcAfterPrune).toBe(false);
  });

  test('custom config overrides defaults', () => {
    const custom: CompactionConfig = {
      enabled: true,
      snapshotInterval: 100,
      minChangesBeforeSnapshot: 50,
      pruneAfterSnapshot: false,
      gcAfterPrune: true,
      keepRecentNodes: 10,
    };

    expect(custom.enabled).toBe(true);
    expect(custom.snapshotInterval).toBe(100);
    expect(custom.minChangesBeforeSnapshot).toBe(50);
    expect(custom.pruneAfterSnapshot).toBe(false);
    expect(custom.gcAfterPrune).toBe(true);
    expect(custom.keepRecentNodes).toBe(10);
  });
});

describe('Compaction trigger logic', () => {
  /**
   * Simulates the _maybeCompact() logic without needing the full
   * CollabswarmDocument infrastructure. Tests the decision logic only.
   */
  function shouldCompact(
    config: CompactionConfig,
    documentChangeCount: number,
    changesSinceSnapshot: number,
  ): boolean {
    if (!config.enabled) return false;
    if (documentChangeCount < config.minChangesBeforeSnapshot) return false;
    if (changesSinceSnapshot < config.snapshotInterval) return false;
    return true;
  }

  test('does not compact when disabled', () => {
    expect(
      shouldCompact(
        { ...defaultCompactionConfig, enabled: false },
        1000,
        600,
      ),
    ).toBe(false);
  });

  test('does not compact below minimum threshold', () => {
    expect(
      shouldCompact(
        { ...defaultCompactionConfig, enabled: true, minChangesBeforeSnapshot: 100 },
        50,
        500,
      ),
    ).toBe(false);
  });

  test('does not compact before interval reached', () => {
    expect(
      shouldCompact(
        { ...defaultCompactionConfig, enabled: true, snapshotInterval: 500 },
        200,
        499,
      ),
    ).toBe(false);
  });

  test('compacts when all conditions are met', () => {
    expect(
      shouldCompact(
        { ...defaultCompactionConfig, enabled: true, snapshotInterval: 500, minChangesBeforeSnapshot: 100 },
        500,
        500,
      ),
    ).toBe(true);
  });

  test('compacts when well past interval', () => {
    expect(
      shouldCompact(
        { ...defaultCompactionConfig, enabled: true, snapshotInterval: 100, minChangesBeforeSnapshot: 50 },
        1000,
        300,
      ),
    ).toBe(true);
  });

  test('resets counter after compaction', () => {
    // Simulate: after compaction, changesSinceSnapshot resets to 0.
    const config: CompactionConfig = {
      ...defaultCompactionConfig,
      enabled: true,
      snapshotInterval: 100,
      minChangesBeforeSnapshot: 50,
    };

    // Before compaction - should trigger.
    expect(shouldCompact(config, 200, 100)).toBe(true);

    // After compaction - counter resets, should not trigger again.
    expect(shouldCompact(config, 200, 0)).toBe(false);

    // After more changes accumulate past the interval again.
    expect(shouldCompact(config, 300, 100)).toBe(true);
  });
});

describe('Snapshot sign payload construction', () => {
  /**
   * Mirrors CollabswarmDocument._buildSnapshotSignPayload() so we can
   * test the deterministic binary layout and input validation independently.
   */
  function buildSnapshotSignPayload(
    stateBytes: Uint8Array,
    lastChangeNodeCID: string,
    timestamp: number,
    compactedCount: number,
  ): Uint8Array {
    if (!Number.isSafeInteger(timestamp) || timestamp < 0) {
      throw new Error(`Invalid snapshot timestamp: ${timestamp}`);
    }
    if (!Number.isInteger(compactedCount) || compactedCount < 0 || compactedCount > 0xFFFFFFFF) {
      throw new Error(`Invalid snapshot compactedCount: ${compactedCount}`);
    }
    const encoder = new TextEncoder();
    const cidBytes = encoder.encode(lastChangeNodeCID);
    if (cidBytes.length > 0xFFFFFFFF) {
      throw new Error(`lastChangeNodeCID too large: ${cidBytes.length} bytes`);
    }
    if (stateBytes.length > 0xFFFFFFFF) {
      throw new Error(`Snapshot state too large: ${stateBytes.length} bytes`);
    }
    const totalLen = 1 + 8 + 4 + 4 + cidBytes.length + 4 + stateBytes.length;
    const buf = new ArrayBuffer(totalLen);
    const view = new DataView(buf);
    const out = new Uint8Array(buf);
    let offset = 0;
    view.setUint8(offset, 1);
    offset += 1;
    view.setBigUint64(offset, BigInt(timestamp), false);
    offset += 8;
    view.setUint32(offset, compactedCount, false);
    offset += 4;
    view.setUint32(offset, cidBytes.length, false);
    offset += 4;
    out.set(cidBytes, offset);
    offset += cidBytes.length;
    view.setUint32(offset, stateBytes.length, false);
    offset += 4;
    out.set(stateBytes, offset);
    return out;
  }

  test('produces deterministic output for same inputs', () => {
    const state = new Uint8Array([1, 2, 3]);
    const cid = 'bafytest123';
    const ts = 1700000000000;
    const count = 100;

    const a = buildSnapshotSignPayload(state, cid, ts, count);
    const b = buildSnapshotSignPayload(state, cid, ts, count);
    expect(a).toEqual(b);
  });

  test('different inputs produce different payloads', () => {
    const state = new Uint8Array([1, 2, 3]);
    const a = buildSnapshotSignPayload(state, 'cid-a', 1700000000000, 100);
    const b = buildSnapshotSignPayload(state, 'cid-b', 1700000000000, 100);
    expect(a).not.toEqual(b);
  });

  test('payload starts with version byte 1', () => {
    const payload = buildSnapshotSignPayload(
      new Uint8Array([42]), 'cid', 1700000000000, 50,
    );
    expect(payload[0]).toBe(1);
  });

  test('rejects non-integer timestamp', () => {
    expect(() => buildSnapshotSignPayload(
      new Uint8Array([1]), 'cid', 1.5, 10,
    )).toThrow('Invalid snapshot timestamp');
  });

  test('rejects negative timestamp', () => {
    expect(() => buildSnapshotSignPayload(
      new Uint8Array([1]), 'cid', -1, 10,
    )).toThrow('Invalid snapshot timestamp');
  });

  test('rejects NaN timestamp', () => {
    expect(() => buildSnapshotSignPayload(
      new Uint8Array([1]), 'cid', NaN, 10,
    )).toThrow('Invalid snapshot timestamp');
  });

  test('rejects non-integer compactedCount', () => {
    expect(() => buildSnapshotSignPayload(
      new Uint8Array([1]), 'cid', 1000, 1.5,
    )).toThrow('Invalid snapshot compactedCount');
  });

  test('rejects compactedCount exceeding uint32 max', () => {
    expect(() => buildSnapshotSignPayload(
      new Uint8Array([1]), 'cid', 1000, 0x100000000,
    )).toThrow('Invalid snapshot compactedCount');
  });

  test('accepts compactedCount at uint32 max', () => {
    expect(() => buildSnapshotSignPayload(
      new Uint8Array([1]), 'cid', 1000, 0xFFFFFFFF,
    )).not.toThrow();
  });
});

describe('Snapshot tie-breaking', () => {
  /**
   * Mirrors the snapshot selection logic in CollabswarmDocument.sync().
   * Returns true if `incoming` should replace `current`.
   */
  function shouldReplace(
    current: CRDTSnapshotNode<Uint8Array, string> | undefined,
    incoming: CRDTSnapshotNode<Uint8Array, string>,
  ): boolean {
    if (!current) return true;
    if (incoming.compactedCount > current.compactedCount) return true;
    if (
      incoming.compactedCount === current.compactedCount &&
      String(incoming.lastChangeNodeCID ?? '') >
        String(current.lastChangeNodeCID ?? '')
    ) {
      return true;
    }
    return false;
  }

  function makeSnapshot(
    compactedCount: number,
    lastChangeNodeCID: string,
  ): CRDTSnapshotNode<Uint8Array, string> {
    return {
      state: new Uint8Array([1]),
      lastChangeNodeCID,
      compactedCount,
      signature: new Uint8Array([1]),
      publicKey: 'key',
      timestamp: 1700000000000,
    };
  }

  test('replaces when no existing snapshot', () => {
    expect(shouldReplace(undefined, makeSnapshot(100, 'cid-a'))).toBe(true);
  });

  test('replaces when incoming has higher compactedCount', () => {
    expect(shouldReplace(
      makeSnapshot(100, 'cid-z'),
      makeSnapshot(200, 'cid-a'),
    )).toBe(true);
  });

  test('does not replace when incoming has lower compactedCount', () => {
    expect(shouldReplace(
      makeSnapshot(200, 'cid-a'),
      makeSnapshot(100, 'cid-z'),
    )).toBe(false);
  });

  test('tie-breaks on lastChangeNodeCID when compactedCount is equal', () => {
    expect(shouldReplace(
      makeSnapshot(100, 'cid-a'),
      makeSnapshot(100, 'cid-b'),
    )).toBe(true);

    expect(shouldReplace(
      makeSnapshot(100, 'cid-b'),
      makeSnapshot(100, 'cid-a'),
    )).toBe(false);
  });

  test('does not replace when both fields are equal', () => {
    expect(shouldReplace(
      makeSnapshot(100, 'cid-a'),
      makeSnapshot(100, 'cid-a'),
    )).toBe(false);
  });
});

describe('Lazy load decision logic', () => {
  /**
   * Mirrors the decision tree inside CollabswarmDocument.loadChangeBlock().
   * Returns either 'unknown' (CID not in hashes), 'invalid' (CID parse error
   * thrown), 'ok' (block returned), or 'missing' (block not available).
   *
   * The `getBlock` callback can throw (simulating blockstore.get failure)
   * or return undefined (simulating "found nothing"). Either outcome should
   * surface as 'missing'.
   */
  async function loadChangeBlockDecision(
    hashes: Set<string>,
    cid: string,
    parseCID: (c: string) => unknown,
    getBlock: (parsed: unknown) => Promise<Uint8Array | undefined>,
  ): Promise<'unknown' | 'invalid' | 'ok' | 'missing'> {
    if (!hashes.has(cid)) return 'unknown';
    let parsed: unknown;
    try {
      parsed = parseCID(cid);
    } catch {
      return 'invalid';
    }
    try {
      const result = await getBlock(parsed);
      return result === undefined ? 'missing' : 'ok';
    } catch {
      return 'missing';
    }
  }

  const validParse = (c: string) => ({ cid: c });
  const okGet = async () => new Uint8Array([1, 2, 3]);
  const throwGet = async () => { throw new Error('blockstore.get failed'); };
  const undefGet = async () => undefined;

  type Case = {
    name: string;
    hashes: string[];
    cid: string;
    parseCID: (c: string) => unknown;
    getBlock: (parsed: unknown) => Promise<Uint8Array | undefined>;
    expected: 'unknown' | 'invalid' | 'ok' | 'missing';
  };

  const cases: Case[] = [
    {
      name: 'unknown CID is rejected without touching blockstore',
      hashes: ['cid-1'],
      cid: 'cid-2',
      parseCID: validParse,
      getBlock: okGet,
      expected: 'unknown',
    },
    {
      name: 'known CID with successful blockstore.get returns ok',
      hashes: ['cid-1'],
      cid: 'cid-1',
      parseCID: validParse,
      getBlock: okGet,
      expected: 'ok',
    },
    {
      name: 'known CID with throwing blockstore.get returns missing',
      hashes: ['cid-1'],
      cid: 'cid-1',
      parseCID: validParse,
      getBlock: throwGet,
      expected: 'missing',
    },
    {
      name: 'known CID with undefined blockstore.get result returns missing',
      hashes: ['cid-1'],
      cid: 'cid-1',
      parseCID: validParse,
      getBlock: undefGet,
      expected: 'missing',
    },
    {
      name: 'malformed CID throws invalid',
      hashes: ['cid-bad'],
      cid: 'cid-bad',
      parseCID: () => { throw new Error('parse error'); },
      getBlock: okGet,
      expected: 'invalid',
    },
    {
      name: 'empty hashes set always reports unknown',
      hashes: [],
      cid: 'cid-1',
      parseCID: validParse,
      getBlock: okGet,
      expected: 'unknown',
    },
  ];

  for (const c of cases) {
    test(c.name, async () => {
      const result = await loadChangeBlockDecision(
        new Set(c.hashes),
        c.cid,
        c.parseCID,
        c.getBlock,
      );
      expect(result).toBe(c.expected);
    });
  }

  test('blockstore is not touched when CID is unknown', async () => {
    let getBlockCalls = 0;
    const spyGet = async () => {
      getBlockCalls++;
      return new Uint8Array([1]);
    };
    const result = await loadChangeBlockDecision(
      new Set(['cid-1']),
      'cid-unknown',
      validParse,
      spyGet,
    );
    expect(result).toBe('unknown');
    expect(getBlockCalls).toBe(0);
  });
});

describe('GC gating logic', () => {
  /**
   * Mirrors the boolean expression in CollabswarmDocument.snapshot() that
   * decides whether to invoke `_gcPrunedBlocks` after a snapshot is created.
   */
  function shouldGC(
    pruneAfterSnapshot: boolean,
    gcAfterPrune: boolean,
    prunedCount: number,
    haveSyncTree: boolean,
  ): boolean {
    if (!pruneAfterSnapshot) return false;
    if (!gcAfterPrune) return false;
    if (prunedCount === 0) return false;
    if (!haveSyncTree) return false;
    return true;
  }

  type Case = {
    name: string;
    pruneAfterSnapshot: boolean;
    gcAfterPrune: boolean;
    prunedCount: number;
    haveSyncTree: boolean;
    expected: boolean;
  };

  const cases: Case[] = [
    {
      name: 'GC runs when all gates are open',
      pruneAfterSnapshot: true,
      gcAfterPrune: true,
      prunedCount: 5,
      haveSyncTree: true,
      expected: true,
    },
    {
      name: 'GC skipped when pruneAfterSnapshot is false',
      pruneAfterSnapshot: false,
      gcAfterPrune: true,
      prunedCount: 5,
      haveSyncTree: true,
      expected: false,
    },
    {
      name: 'GC skipped when gcAfterPrune is false (default)',
      pruneAfterSnapshot: true,
      gcAfterPrune: false,
      prunedCount: 5,
      haveSyncTree: true,
      expected: false,
    },
    {
      name: 'GC skipped when nothing was pruned',
      pruneAfterSnapshot: true,
      gcAfterPrune: true,
      prunedCount: 0,
      haveSyncTree: true,
      expected: false,
    },
    {
      name: 'GC skipped when no sync tree exists',
      pruneAfterSnapshot: true,
      gcAfterPrune: true,
      prunedCount: 5,
      haveSyncTree: false,
      expected: false,
    },
  ];

  for (const c of cases) {
    test(c.name, () => {
      expect(
        shouldGC(c.pruneAfterSnapshot, c.gcAfterPrune, c.prunedCount, c.haveSyncTree),
      ).toBe(c.expected);
    });
  }
});
