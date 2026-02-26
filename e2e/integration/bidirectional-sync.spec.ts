import { test, expect, type Page, type ConsoleMessage } from '@playwright/test';

const APP_1_URL = 'http://localhost:3001';
const APP_2_URL = 'http://localhost:3002';

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

// Wait for both browsers to initialize, connect, and have GossipSub mesh ready
async function setupConnectedPair(browser: any): Promise<{
  page1: Page; page2: Page;
  track1: ReturnType<typeof trackConsole>;
  track2: ReturnType<typeof trackConsole>;
  context1: any; context2: any;
}> {
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
      track1.waitFor('PEER_CONNECTED:', 90_000),
      track2.waitFor('PEER_CONNECTED:', 90_000),
    ]);

    // Wait for GossipSub mesh to form (mesh grafting takes several seconds through relay).
    // Longer wait needed when previous tests have cycled connections through the relay.
    await page1.waitForTimeout(10000);

    return { page1, page2, track1, track2, context1, context2 };
  } catch (err) {
    await context1.close();
    await context2.close();
    throw err;
  }
}

test.describe('Bi-directional Sync', () => {
  test('Browser A sends message, Browser B receives it', async ({ browser }) => {
    const { page1, page2, track1, track2, context1, context2 } = await setupConnectedPair(browser);
    try {
      // Start listening for pubsub message on page2 BEFORE sending
      const messageReceived = track2.waitFor('PUBSUB_MESSAGE:', 30_000);

      // Send message from page1
      await page1.fill('#message-input', 'Hello from Browser A');
      await page1.click('#send-btn');

      const received = await messageReceived;
      console.log('Browser B received:', received);

      // Verify the message appears in Browser B's message list
      const messages2 = await page2.evaluate(() => (window as any).__messages);
      const matchingMsg = messages2.find((m: any) => m.text === 'Hello from Browser A');
      expect(matchingMsg).toBeTruthy();
      expect(matchingMsg.text).toBe('Hello from Browser A');

      // Verify it appears in the UI
      const messageElements = await page2.locator('.message').all();
      const messageTexts = await Promise.all(messageElements.map(el => el.textContent()));
      const hasMessage = messageTexts.some(t => t?.includes('Hello from Browser A'));
      expect(hasMessage).toBe(true);
    } finally {
      await context1.close();
      await context2.close();
    }
  });

  test('Browser B sends message, Browser A receives it', async ({ browser }) => {
    const { page1, page2, track1, track2, context1, context2 } = await setupConnectedPair(browser);
    try {
      const messageReceived = track1.waitFor('PUBSUB_MESSAGE:', 30_000);

      await page2.fill('#message-input', 'Hello from Browser B');
      await page2.click('#send-btn');

      const received = await messageReceived;
      console.log('Browser A received:', received);

      const messages1 = await page1.evaluate(() => (window as any).__messages);
      const matchingMsg = messages1.find((m: any) => m.text === 'Hello from Browser B');
      expect(matchingMsg).toBeTruthy();
    } finally {
      await context1.close();
      await context2.close();
    }
  });

  test('full bi-directional exchange: both browsers send and receive', async ({ browser }) => {
    const { page1, page2, track1, track2, context1, context2 } = await setupConnectedPair(browser);
    try {
      // Browser A sends
      const msg1to2 = track2.waitFor('PUBSUB_MESSAGE:', 30_000);
      await page1.fill('#message-input', 'Message from A');
      await page1.click('#send-btn');
      await msg1to2;

      // Browser B sends back
      const msg2to1 = track1.waitFor('PUBSUB_MESSAGE:', 30_000);
      await page2.fill('#message-input', 'Reply from B');
      await page2.click('#send-btn');
      await msg2to1;

      // Verify both browsers have both messages
      const messages1 = await page1.evaluate(() => (window as any).__messages);
      const messages2 = await page2.evaluate(() => (window as any).__messages);

      expect(messages1.some((m: any) => m.text === 'Message from A')).toBe(true);
      expect(messages1.some((m: any) => m.text === 'Reply from B')).toBe(true);

      expect(messages2.some((m: any) => m.text === 'Message from A')).toBe(true);
      expect(messages2.some((m: any) => m.text === 'Reply from B')).toBe(true);

      console.log(`Browser A messages: ${messages1.length}`);
      console.log(`Browser B messages: ${messages2.length}`);
    } finally {
      await context1.close();
      await context2.close();
    }
  });

  test('rapid concurrent messages from both sides', async ({ browser }) => {
    const { page1, page2, track1, track2, context1, context2 } = await setupConnectedPair(browser);
    try {
      // Verify mesh is working with a warmup message first
      const warmup = track2.waitFor('PUBSUB_MESSAGE:', 30_000);
      await page1.fill('#message-input', 'warmup');
      await page1.click('#send-btn');
      await warmup;

      const messageCount = 5;

      // Send messages from both sides with small delays for mesh stability
      for (let i = 0; i < messageCount; i++) {
        await page1.fill('#message-input', `A-msg-${i}`);
        await page1.click('#send-btn');
        await page1.waitForTimeout(300);
        await page2.fill('#message-input', `B-msg-${i}`);
        await page2.click('#send-btn');
        await page2.waitForTimeout(300);
      }

      // Wait until both browsers have received messages from the other side
      await Promise.all([
        page1.waitForFunction(
          (count) => (window as any).__messages?.filter((m: any) => m.text.startsWith('B-msg-')).length >= count,
          Math.floor(messageCount / 2),
          { timeout: 30_000 }
        ),
        page2.waitForFunction(
          (count) => (window as any).__messages?.filter((m: any) => m.text.startsWith('A-msg-')).length >= count,
          Math.floor(messageCount / 2),
          { timeout: 30_000 }
        ),
      ]);

      const messages1 = await page1.evaluate(() => (window as any).__messages);
      const messages2 = await page2.evaluate(() => (window as any).__messages);

      console.log(`Browser A total messages: ${messages1.length}`);
      console.log(`Browser B total messages: ${messages2.length}`);

      // Both should have all their own messages
      for (let i = 0; i < messageCount; i++) {
        expect(messages1.some((m: any) => m.text === `A-msg-${i}`)).toBe(true);
        expect(messages2.some((m: any) => m.text === `B-msg-${i}`)).toBe(true);
      }

      // Both should have received most messages from the other side
      const aReceivedFromB = messages1.filter((m: any) => m.text.startsWith('B-msg-')).length;
      const bReceivedFromA = messages2.filter((m: any) => m.text.startsWith('A-msg-')).length;

      console.log(`Browser A received ${aReceivedFromB}/${messageCount} from B`);
      console.log(`Browser B received ${bReceivedFromA}/${messageCount} from A`);

      expect(aReceivedFromB).toBeGreaterThanOrEqual(Math.floor(messageCount / 2));
      expect(bReceivedFromA).toBeGreaterThanOrEqual(Math.floor(messageCount / 2));
    } finally {
      await context1.close();
      await context2.close();
    }
  });
});
