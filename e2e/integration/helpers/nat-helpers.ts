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

  return {
    messages,
    has(prefix: string): boolean {
      return messages.some(m => m.startsWith(prefix));
    },
    waitFor(prefix: string, timeout = 60_000): Promise<string> {
      const existing = messages.find(m => m.startsWith(prefix));
      if (existing) return Promise.resolve(existing);

      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          page.off('console', handler);
          reject(new Error(
            `Timeout (${timeout}ms) waiting for console: "${prefix}"\n` +
            `Collected ${messages.length} messages:\n${messages.slice(-20).join('\n')}`,
          ));
        }, timeout);
        const handler = (msg: ConsoleMessage) => {
          if (msg.text().startsWith(prefix)) {
            clearTimeout(timer);
            page.off('console', handler);
            resolve(msg.text());
          }
        };
        page.on('console', handler);
      });
    },
    /** Wait for at least `count` messages with the given prefix. */
    waitForCount(prefix: string, count: number, timeout = 60_000): Promise<string[]> {
      const matched = () => messages.filter(m => m.startsWith(prefix));
      if (matched().length >= count) return Promise.resolve(matched().slice(0, count));

      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          page.off('console', handler);
          const found = matched();
          reject(new Error(
            `Timeout (${timeout}ms) waiting for ${count} "${prefix}" messages (got ${found.length})\n` +
            `Collected ${messages.length} messages:\n${messages.slice(-20).join('\n')}`,
          ));
        }, timeout);
        const handler = (_msg: ConsoleMessage) => {
          const found = matched();
          if (found.length >= count) {
            clearTimeout(timer);
            page.off('console', handler);
            resolve(found.slice(0, count));
          }
        };
        page.on('console', handler);
      });
    },
    /** Detach the console listener and clear the buffer. Safe to call more than once. */
    dispose() {
      page.off('console', collector);
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
 */
export function rebindTracker(handle: PageHandle): PageHandle {
  handle.track.dispose();
  return { ...handle, track: trackConsole(handle.page) };
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
