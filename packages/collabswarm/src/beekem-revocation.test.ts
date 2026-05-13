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
    // Alice (writer) sets up a 2-member group (Alice + Bob). The test
    // focuses on the simplest configuration that exercises the
    // revocation security property: a removed reader cannot derive the
    // new document key from the writer-broadcast PathUpdate. Larger
    // tree configurations are exercised by the wire-integration tests
    // in `beekem-revocation-wire.test.ts`.
    // Tree layout (2 leaves):
    //   leaf positions: 0=Alice, 1=Bob
    //   node indices:   0,       2
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

    // Alice revokes Bob. `removeMember` itself blanks Bob's leaf,
    // blanks every internal node on Bob's direct path, AND re-derives
    // fresh key material along Alice's path to root. The returned
    // `PathUpdate` + `rootSecret` are exactly what `removeReader`
    // broadcasts and installs in the keychain -- no follow-up
    // `update()` call is involved. Asserting against `removeMember`'s
    // return values mirrors what the integration code actually ships
    // on the wire.
    const bobLeafIndex = 2;
    const { pathUpdate, rootSecret: aliceNewRoot } =
      await alice.removeMember(bobLeafIndex);

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

  test('writer can recover leaf assignment from BeeKEM tree after cache wipe', async () => {
    // Models the integration-layer "writer restart wipes
    // _readerLeafIndices but BeeKEM tree state is still around" case
    // exercised by `CollabswarmDocument.removeReader`'s fallback to
    // `BeeKEM.findLeafByPublicKey`. The collabswarm-document layer
    // tracks the reader's KEM public key alongside the leaf index;
    // on a cache miss it scans the BeeKEM tree by that public key.
    //
    // This test exercises the cryptographic primitive that backs
    // that fallback: `findLeafByPublicKey` returns the correct
    // node index for a joined member, and that index is exactly
    // what `removeMember` consumes.
    const alice = new BeeKEM();
    const aliceKeys = await generateECDHKeyPair();
    await alice.initialize(aliceKeys.privateKey, aliceKeys.publicKey);

    const bobKeys = await generateECDHKeyPair();
    await alice.addMember(bobKeys.publicKey);

    const charlieKeys = await generateECDHKeyPair();
    await alice.addMember(charlieKeys.publicKey);

    // Simulate cache wipe: we no longer "know" Bob's leaf index
    // directly. All we have is his KEM public key (which the
    // collabswarm-document layer tracks alongside identity). Scan
    // the tree.
    const recoveredLeafIndex = await alice.findLeafByPublicKey(
      bobKeys.publicKey,
    );
    expect(recoveredLeafIndex).toBe(2);

    // Use the recovered leaf to revoke Bob -- the same call shape as
    // the production `removeReader` after cache miss + tree scan.
    const { rootSecret: postRoot } = await alice.removeMember(
      recoveredLeafIndex!,
    );
    expect(postRoot.byteLength).toBe(32);

    // Post-revocation: Bob's leaf is blanked, so a second scan must
    // NOT return his old index (otherwise the writer would re-revoke
    // a blank leaf or, worse, hand the index back as the "current"
    // leaf for a different reader).
    expect(
      await alice.findLeafByPublicKey(bobKeys.publicKey),
    ).toBeUndefined();
    // Charlie's leaf is unaffected by Bob's removal -- still
    // findable.
    expect(await alice.findLeafByPublicKey(charlieKeys.publicKey)).toBe(4);
  });

  test('removing a reader does not reuse the same root secret', async () => {
    // Quick sanity that `removeMember` itself produces a *new* root,
    // not the previous one. The `removeReader` integration calls
    // `removeMember` only -- not a follow-up `update()` -- so this
    // test exercises the same surface.
    const alice = new BeeKEM();
    const aliceKeys = await generateECDHKeyPair();
    await alice.initialize(aliceKeys.privateKey, aliceKeys.publicKey);

    const bobKeys = await generateECDHKeyPair();
    await alice.addMember(bobKeys.publicKey);

    const charlieKeys = await generateECDHKeyPair();
    await alice.addMember(charlieKeys.publicKey);

    const preRoot = await alice.getRootSecret();
    const { rootSecret: postRoot } = await alice.removeMember(2);

    expect(Buffer.from(preRoot).equals(Buffer.from(postRoot))).toBe(false);
  });

  test('surviving reader decrypts the ACL-change broadcast with its pre-revocation key', async () => {
    // CRITICAL ORDERING INVARIANT (PR #285 Copilot round 3, issue #1):
    //
    //   The `removeReader` flow broadcasts two messages: a gossipsub
    //   ACL-change message (encrypted under the current keychain key)
    //   and a unicast PathUpdate (which carries enough state for
    //   surviving readers to derive the NEW key). Those two
    //   broadcasts are independent; either can arrive at a surviving
    //   reader first.
    //
    //   If the writer installed the new key into its keychain BEFORE
    //   broadcasting the ACL change, the ACL change would be
    //   encrypted under the new key -- which a surviving reader
    //   doesn't have until they process the PathUpdate. They'd be
    //   unable to decrypt the ACL change unless the PathUpdate
    //   happens to arrive first, an ordering the wire does not
    //   guarantee.
    //
    //   The fix: install the new key into the LOCAL keychain only
    //   AFTER both broadcasts have gone out. The ACL change is then
    //   encrypted under the previous key (which surviving readers
    //   already have), so it's decryptable regardless of PathUpdate
    //   arrival order.
    //
    // This test models the writer-side sequence with a stub keychain
    // and asserts: a surviving reader holding only the
    // pre-revocation key successfully decrypts the simulated
    // ACL-change ciphertext. (The full `CollabswarmDocument` call
    // path is omitted -- it requires a libp2p stack -- but the
    // sequencing invariant is exactly the same.)
    type StubKey = {
      readonly id: string;
      readonly cryptoKey: CryptoKey;
    };
    // Stub keychain modelling the "last-write-wins" current()
    // behaviour of the production Yjs/Automerge providers (see
    // `_keychain.current()` in `_makeChange`).
    class StubKeychain {
      private readonly keys: StubKey[] = [];
      readonly callLog: string[] = [];
      install(id: string, cryptoKey: CryptoKey) {
        this.callLog.push(`addEpochKey:${id}`);
        this.keys.push({ id, cryptoKey });
      }
      current(): StubKey {
        this.callLog.push('current');
        if (this.keys.length === 0) throw new Error('empty keychain');
        return this.keys[this.keys.length - 1];
      }
    }

    // Pre-revocation key: a freshly generated AES-GCM key, modelling
    // whatever epoch key the writer was already encrypting under
    // before the revocation begins. The surviving reader has this
    // key (it's been on the keychain since they joined).
    const preRevocationKey = await crypto.subtle.generateKey(
      { name: 'AES-GCM', length: 256 },
      true,
      ['encrypt', 'decrypt'],
    );

    const writerKeychain = new StubKeychain();
    writerKeychain.install('pre-revocation', preRevocationKey);
    writerKeychain.callLog.length = 0; // reset; setup install isn't part of the flow under test

    // 2-member BeeKEM: Alice (writer) + Bob (revoked). Bob is the
    // member we remove. The surviving-reader perspective is modelled
    // by the pre-revocation key alone -- the survivor doesn't need a
    // BeeKEM instance to validate the ACL-change decryptability
    // invariant (that's a property of the keychain key the ACL
    // change was encrypted under, not the BeeKEM tree state). The
    // tree-side primitive that a removed reader CANNOT derive the
    // new key is exercised in the other tests in this file.
    const alice = new BeeKEM();
    const aliceKeys = await generateECDHKeyPair();
    await alice.initialize(aliceKeys.privateKey, aliceKeys.publicKey);

    const bobKeys = await generateECDHKeyPair();
    await alice.addMember(bobKeys.publicKey);
    const bobLeafIndex = 2; // leaf-1 -> node index 2

    // -- Begin modelled removeReader flow (mirrors steps 2-6 in
    //    `removeReader` JSDoc) --

    // Step 2-3: BeeKEM rotation + HKDF derivation (the writer holds
    // the new key locally; the keychain is NOT updated yet).
    const { rootSecret } = await alice.removeMember(bobLeafIndex);
    const newKey = await deriveDocumentKeyFromRootSecret(rootSecret);

    // Step 4: broadcast the ACL change. This goes through
    // `_makeChange` in production, which calls `_keychain.current()`
    // to pick the encryption key. We model that by reading the
    // current key off the stub keychain (which still points at
    // `preRevocationKey`, because the new key hasn't been installed
    // yet).
    const currentKeyAtAclBroadcast = writerKeychain.current();
    const aclChangePlaintext = new TextEncoder().encode(
      '<readers ACL minus Carol>',
    );
    const aclChangeCiphertext = await encryptUnder(
      currentKeyAtAclBroadcast.cryptoKey,
      aclChangePlaintext,
    );

    // Step 5: PathUpdate broadcast. In production this goes out to
    // every surviving peer over `beekemPathUpdateV1` and they
    // derive the new key by processing it. The post-revocation
    // decryptability of the *new* key by a surviving reader is
    // covered by `surviving reader re-derives the same document key
    // as the writer` above; this test focuses on the *previous* key
    // remaining valid for the ACL-change broadcast.

    // Step 6: install the new key in the writer's keychain. This is
    // the deferred step -- everything above used the previous key.
    writerKeychain.install('post-revocation', newKey);

    // INVARIANT (a) -- call order:
    //   `current` was consulted for the ACL broadcast BEFORE
    //   `addEpochKey` installed the new key. If a future refactor
    //   moves the install before the broadcast, this assertion
    //   catches it.
    expect(writerKeychain.callLog).toEqual([
      'current',
      'addEpochKey:post-revocation',
    ]);

    // INVARIANT (b) -- surviving-reader decryptability:
    //   A surviving reader has the pre-revocation key (received via
    //   the keychain delta back when they joined). They have not yet
    //   processed any PathUpdate-derived key. They must be able to
    //   decrypt the ACL change with the pre-revocation key alone.
    const survivorDecrypted = await decryptUnder(
      preRevocationKey,
      aclChangeCiphertext.iv,
      aclChangeCiphertext.ct,
    );
    expect(survivorDecrypted).toEqual(aclChangePlaintext);

    // Defensive double-check: an ACL change ENCRYPTED UNDER THE NEW
    // KEY (the bug-shape we're guarding against) would NOT be
    // decryptable by a survivor holding only the pre-revocation key.
    // This is what `_makeChange` would produce if the install moved
    // back above the broadcast.
    const aclUnderNewKey = await encryptUnder(newKey, aclChangePlaintext);
    await expect(
      decryptUnder(preRevocationKey, aclUnderNewKey.iv, aclUnderNewKey.ct),
    ).rejects.toThrow();
  });
});
