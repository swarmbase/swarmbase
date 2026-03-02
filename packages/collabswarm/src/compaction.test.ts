import { describe, expect, test } from '@jest/globals';
import {
  CompactionConfig,
  defaultCompactionConfig,
} from './compaction-config';

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

  test('custom config overrides defaults', () => {
    const custom: CompactionConfig = {
      enabled: true,
      snapshotInterval: 100,
      minChangesBeforeSnapshot: 50,
      pruneAfterSnapshot: false,
      keepRecentNodes: 10,
    };

    expect(custom.enabled).toBe(true);
    expect(custom.snapshotInterval).toBe(100);
    expect(custom.minChangesBeforeSnapshot).toBe(50);
    expect(custom.pruneAfterSnapshot).toBe(false);
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
