import { describe, expect, test } from '@jest/globals';
import { BeeKEM } from './beekem';

const ECDH_ALGO = { name: 'ECDH', namedCurve: 'P-256' };

/** Generate an ECDH P-256 key pair for BeeKEM testing. */
async function generateECDHKeyPair(): Promise<CryptoKeyPair> {
  return crypto.subtle.generateKey(ECDH_ALGO, true, ['deriveBits']);
}

describe('BeeKEM', () => {
  describe('initialize', () => {
    test('creates a single-member tree', async () => {
      const beekem = new BeeKEM();
      const keyPair = await generateECDHKeyPair();

      await beekem.initialize(keyPair.privateKey, keyPair.publicKey);

      expect(beekem.memberCount).toBe(1);
      expect(beekem.myLeafIndex).toBe(0);
    });

    test('getRootSecret returns a 32-byte Uint8Array', async () => {
      const beekem = new BeeKEM();
      const keyPair = await generateECDHKeyPair();

      await beekem.initialize(keyPair.privateKey, keyPair.publicKey);

      const rootSecret = await beekem.getRootSecret();
      expect(rootSecret).toBeInstanceOf(Uint8Array);
      expect(rootSecret.byteLength).toBe(32);
    });
  });

  describe('addMember', () => {
    test('increases member count', async () => {
      const beekem = new BeeKEM();
      const aliceKeyPair = await generateECDHKeyPair();
      await beekem.initialize(aliceKeyPair.privateKey, aliceKeyPair.publicKey);

      const bobKeyPair = await generateECDHKeyPair();
      const { pathUpdate, welcome } = await beekem.addMember(bobKeyPair.publicKey);

      expect(beekem.memberCount).toBe(2);
      expect(pathUpdate.nodes.length).toBeGreaterThan(0);
      expect(welcome.leafIndex).toBe(2); // leaf position 1 => node index 2
    });

    test('pathUpdate contains valid node data', async () => {
      const beekem = new BeeKEM();
      const aliceKeyPair = await generateECDHKeyPair();
      await beekem.initialize(aliceKeyPair.privateKey, aliceKeyPair.publicKey);

      const bobKeyPair = await generateECDHKeyPair();
      const { pathUpdate } = await beekem.addMember(bobKeyPair.publicKey);

      for (const node of pathUpdate.nodes) {
        expect(node.publicKey).toBeInstanceOf(Uint8Array);
        expect(node.publicKey.byteLength).toBe(65); // Uncompressed P-256 point
        expect(node.encryptedPrivateKey).toBeInstanceOf(Uint8Array);
        expect(node.encryptedPrivateKey.byteLength).toBeGreaterThan(0);
      }
    });
  });

  describe('update', () => {
    test('produces a new root secret different from the old one', async () => {
      const beekem = new BeeKEM();
      const aliceKeyPair = await generateECDHKeyPair();
      await beekem.initialize(aliceKeyPair.privateKey, aliceKeyPair.publicKey);

      const bobKeyPair = await generateECDHKeyPair();
      const { rootSecret: secretAfterAdd } = await beekem.addMember(bobKeyPair.publicKey);

      const { rootSecret: secretAfterUpdate } = await beekem.update();

      // Root secret should change after update (new key material)
      expect(secretAfterUpdate).toBeInstanceOf(Uint8Array);
      expect(secretAfterUpdate.byteLength).toBe(32);
      expect(Buffer.from(secretAfterUpdate).equals(Buffer.from(secretAfterAdd))).toBe(false);
    });
  });

  describe('two-member key agreement', () => {
    test('Alice and Bob derive the same root secret via Welcome', async () => {
      // Alice creates the group
      const alice = new BeeKEM();
      const aliceKeyPair = await generateECDHKeyPair();
      await alice.initialize(aliceKeyPair.privateKey, aliceKeyPair.publicKey);

      // Bob generates his key pair
      const bobKeyPair = await generateECDHKeyPair();

      // Alice adds Bob
      const { welcome, rootSecret: aliceRootSecret } = await alice.addMember(
        bobKeyPair.publicKey,
      );

      // Bob processes the welcome
      const bob = new BeeKEM();
      const bobRootSecret = await bob.processWelcome(
        welcome,
        bobKeyPair.privateKey,
        bobKeyPair.publicKey,
      );

      // Both should derive the same root secret
      expect(aliceRootSecret).toBeInstanceOf(Uint8Array);
      expect(bobRootSecret).toBeInstanceOf(Uint8Array);
      expect(aliceRootSecret.byteLength).toBe(32);
      expect(bobRootSecret.byteLength).toBe(32);

      expect(Buffer.from(aliceRootSecret).equals(Buffer.from(bobRootSecret))).toBe(true);
    });

    test('Bob has correct tree state after processing Welcome', async () => {
      const alice = new BeeKEM();
      const aliceKeyPair = await generateECDHKeyPair();
      await alice.initialize(aliceKeyPair.privateKey, aliceKeyPair.publicKey);

      const bobKeyPair = await generateECDHKeyPair();
      const { welcome } = await alice.addMember(bobKeyPair.publicKey);

      const bob = new BeeKEM();
      await bob.processWelcome(welcome, bobKeyPair.privateKey, bobKeyPair.publicKey);

      expect(bob.myLeafIndex).toBe(2); // leaf position 1 => node index 2
      expect(bob.memberCount).toBe(2);
    });
  });

  describe('three-member group', () => {
    test('Alice adds Bob then Charlie, all can derive root secret', async () => {
      // Alice creates the group
      const alice = new BeeKEM();
      const aliceKeyPair = await generateECDHKeyPair();
      await alice.initialize(aliceKeyPair.privateKey, aliceKeyPair.publicKey);

      // Add Bob
      const bobKeyPair = await generateECDHKeyPair();
      const { welcome: bobWelcome } = await alice.addMember(bobKeyPair.publicKey);

      const bob = new BeeKEM();
      await bob.processWelcome(bobWelcome, bobKeyPair.privateKey, bobKeyPair.publicKey);

      // Add Charlie
      const charlieKeyPair = await generateECDHKeyPair();
      const { welcome: charlieWelcome, rootSecret: aliceRootSecret } =
        await alice.addMember(charlieKeyPair.publicKey);

      const charlie = new BeeKEM();
      const charlieRootSecret = await charlie.processWelcome(
        charlieWelcome,
        charlieKeyPair.privateKey,
        charlieKeyPair.publicKey,
      );

      expect(alice.memberCount).toBe(3);
      expect(charlie.memberCount).toBe(3);

      // Alice and Charlie should agree on root secret
      expect(
        Buffer.from(aliceRootSecret).equals(Buffer.from(charlieRootSecret)),
      ).toBe(true);
    });
  });
});
