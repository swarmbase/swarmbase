/** A legacy browser store whose lifecycle uses open/close instead of start/stop. */
export interface OpenableStore {
  open(): Promise<void>;
  close?: () => Promise<void>;
}

function isOpenableStore(value: unknown): value is OpenableStore {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { open?: unknown }).open === 'function'
  );
}

/**
 * Open custom Helia stores before Helia/libp2p first access them.
 *
 * Current `datastore-idb` and `blockstore-idb` expose the older `open()` /
 * `close()` lifecycle, while Helia 6 only auto-starts stores implementing the
 * newer `start()` / `stop()` lifecycle. Helia also checks its datastore
 * version before invoking generic start hooks, so these stores must be opened
 * before `createHelia()`.
 */
export async function openLegacyHeliaStores(
  ...stores: unknown[]
): Promise<OpenableStore[]> {
  const opened: OpenableStore[] = [];
  try {
    for (const store of new Set(stores)) {
      if (!isOpenableStore(store)) continue;
      await store.open();
      opened.push(store);
    }
    return opened;
  } catch (error) {
    await closeLegacyHeliaStores(opened);
    throw error;
  }
}

/** Close stores in reverse-open order, attempting every close operation. */
export async function closeLegacyHeliaStores(
  stores: OpenableStore[],
): Promise<void> {
  await Promise.allSettled(
    [...stores].reverse().map(async (store) => store.close?.()),
  );
}
