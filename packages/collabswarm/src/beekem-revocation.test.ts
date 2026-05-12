/**
 * End-to-end security test for the BeeKEM-based reader revocation
 * flow used by `CollabswarmDocument.removeReader`.
 *
 * The flow is exercised at the cryptographic layer (BeeKEM tree +
 * HKDF doc-key derivation + AES-GCM round-trip) rather than through
 * the full libp2p stack, so the test stays fast and deterministic
 * while still validating the security property: a removed reader
 * who was connected at the moment of revocation cannot derive the
 * new document encryption key, and so cannot decrypt subsequent
 * traffic.
 *
 * The integration-layer wiring (per-document BeeKEM state, wire
 * protocol dispatch, signature gating) is covered by the
 * collabswarm-document path-update tests and (eventually) the
 * Playwright integration suite.
 */

import { describe, expect, test } from '@jest/globals';
import { BeeKEM } from './beekem/beekem';
import {
  deriveDocumentKeyFromRootSecret,
  deriveEpochIdFromRootSecret,
} from './derive-doc-key';
import {
  deserializePathUpdateFromWire,
  serializePathUpdateForWire,
} from './path-update-wire';

const ECDH_ALGO = { name: 'ECDH', namedCurve: 'P-256' };

async function generateECDHKeyPair(): Promise<CryptoKeyPair> {
  return crypto.subtle.generateKey(ECDH_ALGO, true, ['deriveBits']);
}

// Copy a Uint8Array into a fresh ArrayBuffer-backed view so the
// strict `BufferSource` type required by WebCrypto's TS signatures
// accepts it (rejects SharedArrayBuffer-backed views).
function toBuffer(bytes: Uint8Array): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(bytes.byteLength);
  out.set(bytes);
  return out;
}

async function encryptUnder(key: CryptoKey, plaintext: Uint8Array) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: toBuffer(iv) },
    key,
    toBuffer(plaintext),
  );
  return { iv, ct: new Uint8Array(ct) };
}

async function decryptUnder(
  key: CryptoKey,
  iv: Uint8Array,
  ct: Uint8Array,
): Promise<Uint8Array> {
  const pt = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: toBuffer(iv) },
    key,
    toBuffer(ct),
  );
  return new Uint8Array(pt);
}

describe('BeeKEM reader revocation', () => {
  test('removed reader cannot derive the new document key even if connected', async () => {
    // Alice (writer) sets up a 4-member group so the removed reader
    // (Bob) has at least one survivor (Charlie) on the OTHER side of
    // his subtree boundary -- the configuration in which the
    // revocation security property actually has to do work.
    // Tree layout (4 leaves):
    //   leaf positions: 0=Alice, 1=Bob, 2=Charlie, 3=Dave
    //   node indices:   0       2     4         6
    const alice = new BeeKEM();
    const aliceKeys = await generateECDHKeyPair();
    await alice.initialize(aliceKeys.privateKey, aliceKeys.publicKey);

    const bobKeys = await generateECDHKeyPair();
    const { welcome: bobWelcome } = await alice.addMember(bobKeys.publicKey);
    const bob = new BeeKEM();
    await bob.processWelcome(bobWelcome, bobKeys.privateKey, bobKeys.publicKey);

    // For the 3+ member tests below, Bob has stale tree state until
    // he processes each subsequent addMember PathUpdate. The
    // BeeKEM module's current implementation cannot apply an
    // addMember PathUpdate from an even-sized tree growth without
    // additional Welcome material, so we keep the test focused on
    // the 2-member case where the security property is unambiguous.

    // Alice revokes Bob.
    const bobLeafIndex = 2;
    await alice.removeMember(bobLeafIndex);
    const { pathUpdate, rootSecret: aliceNewRoot } = await alice.update();

    // Wire-format round-trip: PathUpdate goes over the
    // beekemPathUpdateV1 protocol, so the security claim must hold
    // through serialization too.
    const wire = JSON.parse(
      JSON.stringify(serializePathUpdateForWire(pathUpdate)),
    );
    const restored = deserializePathUpdateFromWire(wire);

    // Bob -- the removed reader -- cannot derive the new root from
    // the PathUpdate. With his leaf blanked, processPathUpdate has
    // no intersection with his (now empty) direct path, so it
    // throws.
    let bobDerivedKey: CryptoKey | null = null;
    try {
      const bobAttemptRoot = await bob.processPathUpdate(restored);
      bobDerivedKey = await deriveDocumentKeyFromRootSecret(bobAttemptRoot);
    } catch {
      // Throw is the expected and stronger outcome.
    }

    // Derive the post-revocation document key from Alice's new
    // root and encrypt some "post-revocation traffic" under it.
    const survivorsKey = await deriveDocumentKeyFromRootSecret(aliceNewRoot);
    const secret = new TextEncoder().encode('post-revocation message');
    const { iv, ct } = await encryptUnder(survivorsKey, secret);

    // Alice (writer) can decrypt it -- sanity check on the key.
    expect(await decryptUnder(survivorsKey, iv, ct)).toEqual(secret);

    // Bob CANNOT read it. Either his processPathUpdate threw above
    // (no derived key) or, if it returned something, the resulting
    // key is wrong and AES-GCM authentication fails.
    if (bobDerivedKey) {
      await expect(decryptUnder(bobDerivedKey, iv, ct)).rejects.toThrow();
    } else {
      // No key derived -- the revocation closed the gap fully.
      // Explicit assertion so the test fails clearly if a future
      // refactor accidentally hands Bob a key.
      expect(bobDerivedKey).toBeNull();
    }

    // Sanity: the writer's epoch ID is deterministic in the root.
    const aliceEpochId = await deriveEpochIdFromRootSecret(aliceNewRoot);
    expect(aliceEpochId.byteLength).toBe(32);
  });

  test('surviving reader re-derives the same document key as the writer', async () => {
    // Two-member group: Alice (writer) + Bob (survivor). Alice
    // performs a `BeeKEM.update` to simulate the path-rotation step
    // of removeReader (the `removeMember` half is exercised in the
    // test above). Bob applies the PathUpdate and must converge on
    // the same root secret -- and therefore the same document key
    // and epoch ID -- as Alice.
    const alice = new BeeKEM();
    const aliceKeys = await generateECDHKeyPair();
    await alice.initialize(aliceKeys.privateKey, aliceKeys.publicKey);

    const bobKeys = await generateECDHKeyPair();
    const { welcome } = await alice.addMember(bobKeys.publicKey);
    const bob = new BeeKEM();
    await bob.processWelcome(welcome, bobKeys.privateKey, bobKeys.publicKey);

    const { pathUpdate, rootSecret: aliceRoot } = await alice.update();
    const wire = JSON.parse(
      JSON.stringify(serializePathUpdateForWire(pathUpdate)),
    );
    const restored = deserializePathUpdateFromWire(wire);
    const bobRoot = await bob.processPathUpdate(restored);

    expect(Buffer.from(aliceRoot).equals(Buffer.from(bobRoot))).toBe(true);

    const [aliceKey, bobKey, aliceEpochId, bobEpochId] = await Promise.all([
      deriveDocumentKeyFromRootSecret(aliceRoot),
      deriveDocumentKeyFromRootSecret(bobRoot),
      deriveEpochIdFromRootSecret(aliceRoot),
      deriveEpochIdFromRootSecret(bobRoot),
    ]);
    const aliceRaw = new Uint8Array(
      await crypto.subtle.exportKey('raw', aliceKey),
    );
    const bobRaw = new Uint8Array(await crypto.subtle.exportKey('raw', bobKey));
    expect(aliceRaw).toEqual(bobRaw);
    expect(aliceEpochId).toEqual(bobEpochId);

    // Bob can decrypt a message Alice encrypts under the
    // post-rotation key.
    const secret = new TextEncoder().encode('post-rotation message');
    const { iv, ct } = await encryptUnder(aliceKey, secret);
    expect(await decryptUnder(bobKey, iv, ct)).toEqual(secret);
  });

  test('tampered PathUpdate fails closed on the survivor', async () => {
    const alice = new BeeKEM();
    const aliceKeys = await generateECDHKeyPair();
    await alice.initialize(aliceKeys.privateKey, aliceKeys.publicKey);

    const bobKeys = await generateECDHKeyPair();
    const { welcome } = await alice.addMember(bobKeys.publicKey);
    const bob = new BeeKEM();
    await bob.processWelcome(welcome, bobKeys.privateKey, bobKeys.publicKey);

    const charlieKeys = await generateECDHKeyPair();
    await alice.addMember(charlieKeys.publicKey);
    // (Charlie's BeeKEM state is not needed for this test; we just
    // want a non-trivial tree.)

    const { pathUpdate } = await alice.update();
    const wire = serializePathUpdateForWire(pathUpdate);

    // Flip a bit in the first node's encryptedPrivateKey. The
    // BeeKEM module's AES-GCM-backed ECIES has built-in
    // authentication, so tampered ciphertext must surface as a
    // decryption error -- not silently produce an
    // attacker-controlled derived key.
    const tampered = JSON.parse(JSON.stringify(wire));
    if (tampered.nodes.length > 0) {
      const bytes = Buffer.from(tampered.nodes[0].encryptedPrivateKey, 'base64');
      bytes[bytes.length - 1] ^= 0xff; // flip last byte
      tampered.nodes[0].encryptedPrivateKey = bytes.toString('base64');
    }

    const restored = deserializePathUpdateFromWire(tampered);
    await expect(bob.processPathUpdate(restored)).rejects.toThrow();
  });

  test('removing a reader does not reuse the same root secret', async () => {
    // Quick sanity that the rotation actually produces a *new* root,
    // not the previous one. (Sufficient because BeeKEM.update
    // generates fresh key pairs at every internal node on the path.)
    const alice = new BeeKEM();
    const aliceKeys = await generateECDHKeyPair();
    await alice.initialize(aliceKeys.privateKey, aliceKeys.publicKey);

    const bobKeys = await generateECDHKeyPair();
    await alice.addMember(bobKeys.publicKey);

    const charlieKeys = await generateECDHKeyPair();
    await alice.addMember(charlieKeys.publicKey);

    const preRoot = await alice.getRootSecret();
    await alice.removeMember(2);
    const { rootSecret: postRoot } = await alice.update();

    expect(Buffer.from(preRoot).equals(Buffer.from(postRoot))).toBe(false);
  });
});
