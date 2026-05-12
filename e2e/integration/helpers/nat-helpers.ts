/**
 * Shared NAT integration-test helpers.
 *
 * Used by both `nat-traversal.spec.ts` (baseline cross-NAT sync) and
 * `nat-resilience.spec.ts` (failure-recovery scenarios). Extracted so the
 * two suites can't drift on tracker semantics, init timeouts, mesh waits,
 * etc.
 */
import type { Browser, BrowserContext, ConsoleMessage, Page } from '@playwright/test';

/**
 * Default timeout for `track.waitFor('PEER_ID:', ...)` inside `initPage`.
 *
 * In the test app's bootstrap (see `e2e/test-app/app.js`), `PEER_ID:` is
 * logged immediately after the libp2p node is created, while `INIT_COMPLETE`
 * is logged later — after pubsub subscribe, message handlers, and UI wiring
 * have all completed. So callers that `waitFor('INIT_COMPLETE')` will, by
 * definition, see `PEER_ID:` already in the buffer. We still keep a real
 * timeout here for direct `PEER_ID:` callers, in case the buffer is racing
 * with a slow page on a loaded CI box.
 */
export const PEER_ID_WAIT_MS = 30_000;

/** Default `INIT_COMPLETE` wait (test app boots libp2p before firing this). */
export const INIT_COMPLETE_WAIT_MS = 90_000;

/** Track console messages from a page; supports awaiting on prefixes. */
export function trackConsole(page: Page) {
  const messages: string[] = [];
  const collector = (msg: ConsoleMessage) => messages.push(msg.text());
  page.on('console', collector);

  /**
   * Pending in-flight `waitFor` / `waitForCount` waits. Each entry holds the
   * cleanup hook (clears the timer + removes the per-call console handler)
   * and the Promise's `reject`, so `dispose()` can both stop the listener
   * AND reject the awaited Promise — otherwise callers awaiting through a
   * `dispose()` would hang forever. Pending waits self-unregister on their
   * normal resolve/reject paths.
   */
  type PendingWait = { detach: () => void; reject: (err: Error) => void };
  const pendingWaits = new Set<PendingWait>();

  return {
    messages,
    has(prefix: string): boolean {
      return messages.some(m => m.startsWith(prefix));
    },
    waitFor(prefix: string, timeout = 60_000): Promise<string> {
      const existing = messages.find(m => m.startsWith(prefix));
      if (existing) return Promise.resolve(existing);

      return new Promise<string>((resolve, reject) => {
        const pending: PendingWait = {
          detach: () => {}, // assigned below
          reject,
        };
        const timer = setTimeout(() => {
          pending.detach();
          reject(new Error(
            `Timeout (${timeout}ms) waiting for console: "${prefix}"\n` +
            `Collected ${messages.length} messages:\n${messages.slice(-20).join('\n')}`,
          ));
        }, timeout);
        const handler = (msg: ConsoleMessage) => {
          if (msg.text().startsWith(prefix)) {
            pending.detach();
            resolve(msg.text());
          }
        };
        pending.detach = () => {
          clearTimeout(timer);
          page.off('console', handler);
          pendingWaits.delete(pending);
        };
        pendingWaits.add(pending);
        page.on('console', handler);
      });
    },
    /** Wait for at least `count` messages with the given prefix. */
    waitForCount(prefix: string, count: number, timeout = 60_000): Promise<string[]> {
      const matched = () => messages.filter(m => m.startsWith(prefix));
      if (matched().length >= count) return Promise.resolve(matched().slice(0, count));

      return new Promise<string[]>((resolve, reject) => {
        const pending: PendingWait = {
          detach: () => {}, // assigned below
          reject,
        };
        const timer = setTimeout(() => {
          pending.detach();
          const found = matched();
          reject(new Error(
            `Timeout (${timeout}ms) waiting for ${count} "${prefix}" messages (got ${found.length})\n` +
            `Collected ${messages.length} messages:\n${messages.slice(-20).join('\n')}`,
          ));
        }, timeout);
        const handler = (_msg: ConsoleMessage) => {
          const found = matched();
          if (found.length >= count) {
            pending.detach();
            resolve(found.slice(0, count));
          }
        };
        pending.detach = () => {
          clearTimeout(timer);
          page.off('console', handler);
          pendingWaits.delete(pending);
        };
        pendingWaits.add(pending);
        page.on('console', handler);
      });
    },
    /**
     * Detach the long-lived collector listener, cancel any pending
     * `waitFor` / `waitForCount` listeners (clearing their timers and
     * removing their `page.on('console', ...)` handlers), reject their
     * Promises so any in-flight awaits unblock instead of hanging, and
     * clear the buffer. Safe to call more than once.
     */
    dispose() {
      page.off('console', collector);
      // Snapshot first — each detach() mutates pendingWaits.
      for (const pending of [...pendingWaits]) {
        pending.detach();
        pending.reject(new Error('trackConsole disposed'));
      }
      pendingWaits.clear();
      messages.length = 0;
    },
  };
}

export type ConsoleTracker = ReturnType<typeof trackConsole>;

export interface PageHandle {
  page: Page;
  track: ConsoleTracker;
  context: BrowserContext;
  peerId: string;
}

/**
 * Open a new browser context + page at `url`, attach a console tracker, and
 * wait for the test app to publish `INIT_COMPLETE` and `PEER_ID:`.
 *
 * `peerIdTimeoutMs` defaults to `PEER_ID_WAIT_MS` so the resilience suite
 * stays in lockstep with the baseline NAT suite on slower machines.
 */
export async function initPage(
  browser: Browser,
  url: string,
  opts: { initTimeoutMs?: number; peerIdTimeoutMs?: number } = {},
): Promise<PageHandle> {
  const initTimeoutMs = opts.initTimeoutMs ?? INIT_COMPLETE_WAIT_MS;
  const peerIdTimeoutMs = opts.peerIdTimeoutMs ?? PEER_ID_WAIT_MS;

  const context = await browser.newContext();
  try {
    const page = await context.newPage();
    const track = trackConsole(page);
    await page.goto(url);
    await track.waitFor('INIT_COMPLETE', initTimeoutMs);
    const peerIdMsg = await track.waitFor('PEER_ID:', peerIdTimeoutMs);
    const peerId = peerIdMsg.replace('PEER_ID:', '').trim();
    return { page, track, context, peerId };
  } catch (err) {
    await context.close();
    throw err;
  }
}

/**
 * Replace the in-page console tracker after a page reload. Disposes the
 * previous tracker (removes its `page.on('console', ...)` listener and
 * clears its buffer) so listeners don't accumulate across multiple reloads.
 *
 * The new tracker is attached synchronously so callers can listen for output
 * emitted by the reloaded page. The returned handle's `peerId` is NOT yet
 * refreshed — call `refreshPeerId(handle)` after triggering `page.reload()`
 * to update it, since the test app generates a new libp2p node (and thus a
 * new peerId) on every reload.
 */
export function rebindTracker(handle: PageHandle): PageHandle {
  handle.track.dispose();
  return { ...handle, track: trackConsole(handle.page) };
}

/**
 * Await a fresh `PEER_ID:` log line from the (re)loaded page and return a
 * handle with `peerId` updated to match. Use this after `page.reload()` (or
 * any flow that restarts the test app's libp2p node) since each restart
 * generates a new peerId — the prior value on the handle becomes stale.
 *
 * Expects `handle.track` to be a tracker attached before the reload was
 * triggered (e.g. via `rebindTracker`) so the `PEER_ID:` emission isn't
 * missed.
 */
export async function refreshPeerId(
  handle: PageHandle,
  timeoutMs = PEER_ID_WAIT_MS,
): Promise<PageHandle> {
  const peerIdMsg = await handle.track.waitFor('PEER_ID:', timeoutMs);
  const peerId = peerIdMsg.replace('PEER_ID:', '').trim();
  return { ...handle, peerId };
}

/**
 * Wait for at least 1 `PEER_CONNECTED:` console message.
 * In CI's Docker environment only one connection event fires reliably.
 */
export async function waitForPeerConnection(track: ConsoleTracker, timeout = 90_000) {
  await track.waitFor('PEER_CONNECTED:', timeout);
}

/**
 * Idle wait used after `PEER_CONNECTED:` to let the GossipSub mesh stabilize
 * before exchanging messages. Mesh formation through a single relay takes
 * ~10s in steady state.
 */
export async function waitForMesh(page: Page, ms = 10_000) {
  await page.waitForTimeout(ms);
}
