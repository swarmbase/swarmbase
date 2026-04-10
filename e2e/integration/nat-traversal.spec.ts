/**
 * NAT Traversal Integration Tests
 *
 * These tests verify that SwarmDB peers on isolated Docker networks
 * can discover each other and sync data through the Circuit Relay V2 server.
 *
 * Requires: docker compose -f docker-compose.nat-test.yaml up -d
 *
 * Network topology:
 *   nat-a: [test-app-a, test-app-c, relay]
 *   nat-b: [test-app-b, relay]
 *   relay-net: [relay]
 *
 * test-app-a and test-app-b cannot communicate directly (different networks).
 * test-app-a and test-app-c are on the same network (same "LAN").
 * All traffic between nat-a and nat-b must route through the relay.
 */
import { test, expect, type Browser, type Page, type ConsoleMessage } from '@playwright/test';

const APP_A_URL = 'http://localhost:3001';
const APP_B_URL = 'http://localhost:3002';
const APP_C_URL = 'http://localhost:3003';

function trackConsole(page: Page) {
  const messages: string[] = [];
  page.on('console', (msg) => messages.push(msg.text()));

  return {
    messages,
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
        const handler = (msg: ConsoleMessage) => {
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
  };
}

async function initPage(browser: Browser, url: string) {
  const context = await browser.newContext();
  try {
    const page = await context.newPage();
    const track = trackConsole(page);
    await page.goto(url);
    await track.waitFor('INIT_COMPLETE');
    const peerIdMsg = await track.waitFor('PEER_ID:');
    const peerId = peerIdMsg.replace('PEER_ID:', '').trim();
    return { page, track, context, peerId };
  } catch (err) {
    await context.close();
    throw err;
  }
}

/**
 * Wait for at least 2 PEER_CONNECTED messages (one relay + one actual peer).
 * A single PEER_CONNECTED may only be the relay, not the target peer.
 */
async function waitForPeerConnection(track: ReturnType<typeof trackConsole>, timeout = 90_000) {
  await track.waitForCount('PEER_CONNECTED:', 2, timeout);
}

async function waitForMesh(page: Page, ms = 10_000) {
  await page.waitForTimeout(ms);
}

test.describe('Cross-NAT Document Sync', () => {
  test.setTimeout(180_000);

  test('peers on different networks sync through relay', async ({ browser }) => {
    const a = await initPage(browser, APP_A_URL);
    const b = await initPage(browser, APP_B_URL);
    try {
      await Promise.all([
        waitForPeerConnection(a.track),
        waitForPeerConnection(b.track),
      ]);
      await waitForMesh(a.page);

      // A sends to B (cross-NAT, must go through relay)
      const msgReceived = b.track.waitFor('PUBSUB_MESSAGE:', 30_000);
      await a.page.fill('#message-input', 'cross-nat-hello');
      await a.page.click('#send-btn');
      await msgReceived;

      const messagesB = await b.page.evaluate(() => (window as any).__messages);
      expect(messagesB.some((m: any) => m.text === 'cross-nat-hello')).toBe(true);

      // Verify the connection to peer B specifically routes through circuit relay
      const hasCircuitRelayToB = await a.page.evaluate((remotePeerId: string) => {
        const libp2p = (window as any).__libp2p;
        if (!libp2p) return false;
        return libp2p.getConnections().some(
          (conn: any) =>
            conn.remotePeer.toString() === remotePeerId &&
            conn.remoteAddr.toString().includes('/p2p-circuit'),
        );
      }, b.peerId);
      expect(hasCircuitRelayToB).toBe(true);
    } finally {
      await a.context.close();
      await b.context.close();
    }
  });

  test('bidirectional sync across NAT boundaries', async ({ browser }) => {
    const a = await initPage(browser, APP_A_URL);
    const b = await initPage(browser, APP_B_URL);
    try {
      await Promise.all([
        waitForPeerConnection(a.track),
        waitForPeerConnection(b.track),
      ]);
      await waitForMesh(a.page);

      // A -> B
      const msg1 = b.track.waitFor('PUBSUB_MESSAGE:', 30_000);
      await a.page.fill('#message-input', 'from-nat-a');
      await a.page.click('#send-btn');
      await msg1;

      // B -> A
      const msg2 = a.track.waitFor('PUBSUB_MESSAGE:', 30_000);
      await b.page.fill('#message-input', 'from-nat-b');
      await b.page.click('#send-btn');
      await msg2;

      const messagesA = await a.page.evaluate(() => (window as any).__messages);
      const messagesB = await b.page.evaluate(() => (window as any).__messages);

      expect(messagesA.some((m: any) => m.text === 'from-nat-b')).toBe(true);
      expect(messagesB.some((m: any) => m.text === 'from-nat-a')).toBe(true);
    } finally {
      await a.context.close();
      await b.context.close();
    }
  });
});

test.describe('Same-LAN Peer Connectivity', () => {
  test.setTimeout(180_000);

  test('peers on the same network can sync', async ({ browser }) => {
    // A and C are on the same Docker network (nat-a)
    const a = await initPage(browser, APP_A_URL);
    const c = await initPage(browser, APP_C_URL);
    try {
      await Promise.all([
        waitForPeerConnection(a.track),
        waitForPeerConnection(c.track),
      ]);
      await waitForMesh(a.page);

      const msgReceived = c.track.waitFor('PUBSUB_MESSAGE:', 30_000);
      await a.page.fill('#message-input', 'same-lan-msg');
      await a.page.click('#send-btn');
      await msgReceived;

      const messagesC = await c.page.evaluate(() => (window as any).__messages);
      expect(messagesC.some((m: any) => m.text === 'same-lan-msg')).toBe(true);

      // Verify the connection to peer C is direct (not via circuit relay)
      const usesCircuitRelay = await a.page.evaluate((remotePeerId: string) => {
        const libp2p = (window as any).__libp2p;
        if (!libp2p) return false;
        return libp2p.getConnections().some(
          (conn: any) =>
            conn.remotePeer.toString() === remotePeerId &&
            conn.remoteAddr.toString().includes('/p2p-circuit'),
        );
      }, c.peerId);
      expect(usesCircuitRelay).toBe(false);
    } finally {
      await a.context.close();
      await c.context.close();
    }
  });
});

// Three-peer and concurrent tests are skipped in CI because GossipSub mesh
// formation through a single relay is unreliable for >2 peers (same issue
// documented in resilience.spec.ts). Run manually with: yarn test:nat
test.describe('Three-Peer Cross-NAT Sync', () => {
  test.setTimeout(240_000);

  test.skip(!!process.env.CI, 'Three-peer relay mesh is unreliable in CI');

  test('message from NAT-A reaches both NAT-A and NAT-B peers', async ({ browser }) => {
    const a = await initPage(browser, APP_A_URL);
    const b = await initPage(browser, APP_B_URL);
    const c = await initPage(browser, APP_C_URL);
    try {
      await Promise.all([
        waitForPeerConnection(a.track),
        waitForPeerConnection(b.track),
        waitForPeerConnection(c.track),
      ]);
      await waitForMesh(a.page, 20_000);

      const msgB = b.track.waitFor('PUBSUB_MESSAGE:', 45_000);
      const msgC = c.track.waitFor('PUBSUB_MESSAGE:', 45_000);
      await a.page.fill('#message-input', 'broadcast-from-a');
      await a.page.click('#send-btn');
      await Promise.all([msgB, msgC]);

      const messagesB = await b.page.evaluate(() => (window as any).__messages);
      const messagesC = await c.page.evaluate(() => (window as any).__messages);

      expect(messagesB.some((m: any) => m.text === 'broadcast-from-a')).toBe(true);
      expect(messagesC.some((m: any) => m.text === 'broadcast-from-a')).toBe(true);
    } finally {
      await a.context.close();
      await b.context.close();
      await c.context.close();
    }
  });

  test('message from NAT-B reaches all NAT-A peers', async ({ browser }) => {
    const a = await initPage(browser, APP_A_URL);
    const b = await initPage(browser, APP_B_URL);
    const c = await initPage(browser, APP_C_URL);
    try {
      await Promise.all([
        waitForPeerConnection(a.track),
        waitForPeerConnection(b.track),
        waitForPeerConnection(c.track),
      ]);
      await waitForMesh(a.page, 20_000);

      const msgA = a.track.waitFor('PUBSUB_MESSAGE:', 45_000);
      const msgC = c.track.waitFor('PUBSUB_MESSAGE:', 45_000);
      await b.page.fill('#message-input', 'broadcast-from-b');
      await b.page.click('#send-btn');
      await Promise.all([msgA, msgC]);

      const messagesA = await a.page.evaluate(() => (window as any).__messages);
      const messagesC = await c.page.evaluate(() => (window as any).__messages);

      expect(messagesA.some((m: any) => m.text === 'broadcast-from-b')).toBe(true);
      expect(messagesC.some((m: any) => m.text === 'broadcast-from-b')).toBe(true);
    } finally {
      await a.context.close();
      await b.context.close();
      await c.context.close();
    }
  });
});

test.describe('Rapid Cross-NAT Concurrent Messages', () => {
  test.setTimeout(180_000);

  test.skip(!!process.env.CI, 'Concurrent cross-NAT messaging is unreliable in CI');

  test('concurrent messages from both NATs achieve at least 50% delivery', async ({ browser }) => {
    const a = await initPage(browser, APP_A_URL);
    const b = await initPage(browser, APP_B_URL);
    try {
      await Promise.all([
        waitForPeerConnection(a.track),
        waitForPeerConnection(b.track),
      ]);
      await waitForMesh(a.page);

      // Warmup message to confirm mesh
      const warmup = b.track.waitFor('PUBSUB_MESSAGE:', 60_000);
      await a.page.fill('#message-input', 'warmup');
      await a.page.click('#send-btn');
      await warmup;

      const count = 5;
      for (let i = 0; i < count; i++) {
        await a.page.fill('#message-input', `nat-a-${i}`);
        await a.page.click('#send-btn');
        await a.page.waitForTimeout(300);
        await b.page.fill('#message-input', `nat-b-${i}`);
        await b.page.click('#send-btn');
        await b.page.waitForTimeout(300);
      }

      // Wait for at least half the messages to arrive on each side
      await Promise.all([
        a.page.waitForFunction(
          (n) => (window as any).__messages?.filter((m: any) => m.text.startsWith('nat-b-')).length >= n,
          Math.floor(count / 2),
          { timeout: 30_000 },
        ),
        b.page.waitForFunction(
          (n) => (window as any).__messages?.filter((m: any) => m.text.startsWith('nat-a-')).length >= n,
          Math.floor(count / 2),
          { timeout: 30_000 },
        ),
      ]);

      const messagesA = await a.page.evaluate(() => (window as any).__messages);
      const messagesB = await b.page.evaluate(() => (window as any).__messages);

      const aFromB = messagesA.filter((m: any) => m.text.startsWith('nat-b-')).length;
      const bFromA = messagesB.filter((m: any) => m.text.startsWith('nat-a-')).length;

      console.log(`Cross-NAT delivery: A received ${aFromB}/${count} from B, B received ${bFromA}/${count} from A`);

      expect(aFromB).toBeGreaterThanOrEqual(Math.floor(count / 2));
      expect(bFromA).toBeGreaterThanOrEqual(Math.floor(count / 2));
    } finally {
      await a.context.close();
      await b.context.close();
    }
  });
});
