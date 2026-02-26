import { test, expect, type Page, type ConsoleMessage } from '@playwright/test';

const APP_1_URL = 'http://localhost:3001';
const APP_2_URL = 'http://localhost:3002';

// Collect all console messages and provide a wait helper.
// Must be called BEFORE page.goto() to capture early messages.
function trackConsole(page: Page) {
  const messages: string[] = [];
  page.on('console', (msg) => messages.push(msg.text()));

  return {
    messages,
    waitFor(prefix: string, timeout = 60_000): Promise<string> {
      // Check messages already collected
      const existing = messages.find(m => m.startsWith(prefix));
      if (existing) return Promise.resolve(existing);

      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          page.off('console', handler);
          reject(new Error(`Timeout (${timeout}ms) waiting for console: "${prefix}"\nCollected: ${messages.join('\n')}`));
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
  };
}

test.describe('Peer Discovery', () => {
  test('both browsers initialize and get peer IDs', async ({ browser }) => {
    const context1 = await browser.newContext();
    const context2 = await browser.newContext();
    try {
      const page1 = await context1.newPage();
      const page2 = await context2.newPage();

      // Attach console trackers BEFORE navigating
      const track1 = trackConsole(page1);
      const track2 = trackConsole(page2);

      await page1.goto(APP_1_URL);
      await page2.goto(APP_2_URL);

      // Wait for both to initialize
      await Promise.all([
        track1.waitFor('INIT_COMPLETE'),
        track2.waitFor('INIT_COMPLETE'),
      ]);

      // Verify both have peer IDs
      const peerId1 = await page1.evaluate(() => (window as any).__libp2p?.peerId?.toString());
      const peerId2 = await page2.evaluate(() => (window as any).__libp2p?.peerId?.toString());

      expect(peerId1).toBeTruthy();
      expect(peerId2).toBeTruthy();
      expect(peerId1).not.toEqual(peerId2);

      const status1 = await page1.evaluate(() => (window as any).__status);
      const status2 = await page2.evaluate(() => (window as any).__status);
      expect(status1).not.toBe('error');
      expect(status2).not.toBe('error');

      console.log(`Browser 1 PeerId: ${peerId1}`);
      console.log(`Browser 2 PeerId: ${peerId2}`);
    } finally {
      await context1.close();
      await context2.close();
    }
  });

  test('browsers discover each other via relay', async ({ browser }) => {
    const context1 = await browser.newContext();
    const context2 = await browser.newContext();
    try {
      const page1 = await context1.newPage();
      const page2 = await context2.newPage();

      const track1 = trackConsole(page1);
      const track2 = trackConsole(page2);

      await page1.goto(APP_1_URL);
      await page2.goto(APP_2_URL);

      await Promise.all([
        track1.waitFor('INIT_COMPLETE'),
        track2.waitFor('INIT_COMPLETE'),
      ]);

      // Wait for peer discovery - should find at least the relay
      await Promise.all([
        track1.waitFor('PEER_CONNECTED:', 90_000),
        track2.waitFor('PEER_CONNECTED:', 90_000),
      ]);

      const peerId1 = await page1.evaluate(() => (window as any).__libp2p?.peerId?.toString());
      const peerId2 = await page2.evaluate(() => (window as any).__libp2p?.peerId?.toString());

      // Wait for mutual discovery: browsers find each other via gossipsub peer discovery
      // This takes longer than finding the relay, so poll with a timeout
      const mutualDiscoveryTimeout = 60_000;
      await Promise.all([
        page1.waitForFunction(
          (expectedPeer: string) => {
            const peers = (window as any).__peers;
            return peers && peers.has(expectedPeer);
          },
          peerId2,
          { timeout: mutualDiscoveryTimeout },
        ),
        page2.waitForFunction(
          (expectedPeer: string) => {
            const peers = (window as any).__peers;
            return peers && peers.has(expectedPeer);
          },
          peerId1,
          { timeout: mutualDiscoveryTimeout },
        ),
      ]);

      const peers1 = await page1.evaluate(() => Array.from((window as any).__peers));
      const peers2 = await page2.evaluate(() => Array.from((window as any).__peers));

      console.log(`Browser 1 peers: ${JSON.stringify(peers1)}`);
      console.log(`Browser 2 peers: ${JSON.stringify(peers2)}`);

      expect(peers1).toContain(peerId2);
      expect(peers2).toContain(peerId1);
    } finally {
      await context1.close();
      await context2.close();
    }
  });

  test('browsers connect via relay and potentially upgrade to WebRTC', async ({ browser }) => {
    const context1 = await browser.newContext();
    const context2 = await browser.newContext();
    try {
      const page1 = await context1.newPage();
      const page2 = await context2.newPage();

      const track1 = trackConsole(page1);
      const track2 = trackConsole(page2);

      await page1.goto(APP_1_URL);
      await page2.goto(APP_2_URL);

      await Promise.all([
        track1.waitFor('INIT_COMPLETE'),
        track2.waitFor('INIT_COMPLETE'),
      ]);

      await Promise.all([
        track1.waitFor('CONNECTION_OPEN:', 90_000),
        track2.waitFor('CONNECTION_OPEN:', 90_000),
      ]);

      const connectionTypes1 = await page1.evaluate(() => {
        const types = (window as any).__connectionTypes;
        return types ? Array.from(types.entries()) : [];
      });
      const connectionTypes2 = await page2.evaluate(() => {
        const types = (window as any).__connectionTypes;
        return types ? Array.from(types.entries()) : [];
      });

      console.log(`Browser 1 connections: ${JSON.stringify(connectionTypes1)}`);
      console.log(`Browser 2 connections: ${JSON.stringify(connectionTypes2)}`);

      expect(connectionTypes1.length).toBeGreaterThanOrEqual(1);
      expect(connectionTypes2.length).toBeGreaterThanOrEqual(1);

      const hasWebRTC1 = connectionTypes1.some(([_, addr]: [string, string]) => addr.includes('/webrtc'));
      const hasWebRTC2 = connectionTypes2.some(([_, addr]: [string, string]) => addr.includes('/webrtc'));
      console.log(`Browser 1 has WebRTC connection: ${hasWebRTC1}`);
      console.log(`Browser 2 has WebRTC connection: ${hasWebRTC2}`);

      // WebRTC upgrade is environment-dependent (not available in CI Docker/headless)
      if (!(hasWebRTC1 || hasWebRTC2)) {
        console.warn('WebRTC upgrade did not occur - expected in Docker/CI environments');
      }
    } finally {
      await context1.close();
      await context2.close();
    }
  });
});
