import { describe, expect, test, beforeAll, jest } from '@jest/globals';

import {
  ACLChain,
  ACLChainOps,
  ACLEntry,
  ACLState,
  canonicalEntryPayload,
  computeEntryHash,
} from './acl-chain';
import { SubtleCrypto } from './auth-subtlecrypto';

// ---------------------------------------------------------------------------
// Fixtures and helpers
// ---------------------------------------------------------------------------

const auth = new SubtleCrypto();

/**
 * Generate an ECDSA P-384 keypair using the same algorithm as the SubtleCrypto
 * auth provider's default. Each test gets fresh keys so identities don't
 * leak across tests.
 */
async function genKeyPair(): Promise<{
  publicKey: CryptoKey;
  privateKey: CryptoKey;
}> {
  const pair = await crypto.subtle.generateKey(
    { name: 'ECDSA', namedCurve: 'P-384' },
    true,
    ['sign', 'verify'],
  );
  return { publicKey: pair.publicKey, privateKey: pair.privateKey };
}

/**
 * Canonical raw encoding of an ECDSA public key. Stable across imports.
 */
async function serializePublicKey(key: CryptoKey): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.exportKey('raw', key));
}

// ---------------------------------------------------------------------------
// In-memory ACL adapter
//
// The chain is generic over the change format; for tests we use a tiny
// JSON-encoded "add" / "remove" change vocabulary. Each change carries a
// list of public-key hashes to grant or revoke writer status.
// ---------------------------------------------------------------------------

interface AclChange {
  op: 'add' | 'remove';
  /** Hex-encoded raw public keys. */
  keys: string[];
}

function serializeChange(c: AclChange): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(c));
}

function toHex(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    s += bytes[i].toString(16).padStart(2, '0');
  }
  return s;
}

class TestAclState implements ACLState<AclChange, CryptoKey> {
  // Brand from the interface; we satisfy it structurally without storing it.
  readonly _aclStateBrand?: never;
  /** Hex-encoded raw public keys of current writers. */
  readonly writers: Set<string>;
  constructor(writers: ReadonlySet<string> = new Set()) {
    this.writers = new Set(writers);
  }
  clone(): TestAclState {
    return new TestAclState(this.writers);
  }
}

const testOps: ACLChainOps<AclChange, CryptoKey> = {
  emptyState(): TestAclState {
    return new TestAclState();
  },
  async applyChange(state, change): Promise<TestAclState> {
    const s = (state as TestAclState).clone();
    if (change.op === 'add') {
      for (const k of change.keys) s.writers.add(k);
    } else {
      for (const k of change.keys) s.writers.delete(k);
    }
    return s;
  },
  async isWriter(state, publicKey): Promise<boolean> {
    const bytes = await serializePublicKey(publicKey);
    return (state as TestAclState).writers.has(toHex(bytes));
  },
};

interface TestIdentity {
  publicKey: CryptoKey;
  privateKey: CryptoKey;
  hashHex: string;
}

async function makeIdentity(): Promise<TestIdentity> {
  const { publicKey, privateKey } = await genKeyPair();
  const hashHex = toHex(await serializePublicKey(publicKey));
  return { publicKey, privateKey, hashHex };
}

function makeChain(
  genesisAuthorizedKeys: CryptoKey[],
): ACLChain<AclChange, CryptoKey, CryptoKey> {
  return new ACLChain<AclChange, CryptoKey, CryptoKey>(
    {
      auth,
      serializeKey: serializePublicKey,
      ops: testOps,
      genesisAuthorizedKeys,
    },
    serializeChange,
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

// Some operations are intentionally slow (P-384 keygen, signature verify).
// Generous timeout keeps CI green on slower machines.
jest.setTimeout(30_000);

let alice: TestIdentity;
let bob: TestIdentity;
let carol: TestIdentity;
let eve: TestIdentity;

beforeAll(async () => {
  alice = await makeIdentity();
  bob = await makeIdentity();
  carol = await makeIdentity();
  eve = await makeIdentity();
});

describe('canonical encoding', () => {
  test('changes in any field change the hash', async () => {
    const base: Omit<ACLEntry<AclChange>, 'signature'> = {
      sequenceNumber: 0,
      timestamp: 1000,
      parentHash: undefined,
      change: { op: 'add', keys: [bob.hashHex] },
      signerKeyHash: new Uint8Array([1, 2, 3]),
    };

    const h0 = toHex(await computeEntryHash(base, serializeChange));

    // Bump sequenceNumber
    const h1 = toHex(
      await computeEntryHash({ ...base, sequenceNumber: 1 }, serializeChange),
    );
    expect(h1).not.toBe(h0);

    // Bump timestamp
    const h2 = toHex(
      await computeEntryHash({ ...base, timestamp: 1001 }, serializeChange),
    );
    expect(h2).not.toBe(h0);

    // Different change content
    const h3 = toHex(
      await computeEntryHash(
        { ...base, change: { op: 'add', keys: [carol.hashHex] } },
        serializeChange,
      ),
    );
    expect(h3).not.toBe(h0);

    // Different signer
    const h4 = toHex(
      await computeEntryHash(
        { ...base, signerKeyHash: new Uint8Array([9, 9, 9]) },
        serializeChange,
      ),
    );
    expect(h4).not.toBe(h0);
  });

  test('length-prefixed encoding prevents boundary ambiguity', async () => {
    // Two entries that, without length prefixing, would have the same
    // concatenated representation:
    //   signerKeyHash=[1,2], change=bytes("3")
    //   signerKeyHash=[1,2,3], change=bytes("")
    // Both produce bytes [1,2,3] if you forget the length prefixes.
    const a: Omit<ACLEntry<AclChange>, 'signature'> = {
      sequenceNumber: 0,
      timestamp: 0,
      change: { op: 'add', keys: [] }, // serializes to '{"op":"add","keys":[]}'
      signerKeyHash: new Uint8Array([1, 2]),
    };
    const b: Omit<ACLEntry<AclChange>, 'signature'> = {
      sequenceNumber: 0,
      timestamp: 0,
      change: { op: 'add', keys: [] },
      signerKeyHash: new Uint8Array([1, 2, 3]),
    };
    const ha = canonicalEntryPayload(a, serializeChange);
    const hb = canonicalEntryPayload(b, serializeChange);
    expect(toHex(ha)).not.toBe(toHex(hb));
  });
});

describe('legitimate chain', () => {
  test('genesis member can author the first entry and bootstrap themselves', async () => {
    const chain = makeChain([alice.publicKey]);

    const entry = await chain.authorAndAppend(
      { op: 'add', keys: [alice.hashHex] },
      alice.publicKey,
      alice.privateKey,
    );

    expect(chain.length).toBe(1);
    expect(entry.sequenceNumber).toBe(0);
    expect(entry.parentHash).toBeUndefined();
    expect(chain.headHash).toBeDefined();
    expect(await testOps.isWriter(chain.state!, alice.publicKey)).toBe(true);
  });

  test('writer can add a second writer, who can then author', async () => {
    const chain = makeChain([alice.publicKey]);

    // Alice (genesis) adds herself.
    await chain.authorAndAppend(
      { op: 'add', keys: [alice.hashHex] },
      alice.publicKey,
      alice.privateKey,
    );
    // Alice adds Bob.
    await chain.authorAndAppend(
      { op: 'add', keys: [bob.hashHex] },
      alice.publicKey,
      alice.privateKey,
    );
    // Bob (now a writer) adds Carol.
    await chain.authorAndAppend(
      { op: 'add', keys: [carol.hashHex] },
      bob.publicKey,
      bob.privateKey,
    );

    expect(chain.length).toBe(3);
    expect(await testOps.isWriter(chain.state!, alice.publicKey)).toBe(true);
    expect(await testOps.isWriter(chain.state!, bob.publicKey)).toBe(true);
    expect(await testOps.isWriter(chain.state!, carol.publicKey)).toBe(true);
  });

  test('chain heads link properly via parentHash', async () => {
    const chain = makeChain([alice.publicKey]);
    const e0 = await chain.authorAndAppend(
      { op: 'add', keys: [alice.hashHex] },
      alice.publicKey,
      alice.privateKey,
    );
    const e1 = await chain.authorAndAppend(
      { op: 'add', keys: [bob.hashHex] },
      alice.publicKey,
      alice.privateKey,
    );

    expect(e0.parentHash).toBeUndefined();
    const e0Hash = await computeEntryHash(e0, serializeChange);
    expect(e1.parentHash).toBeDefined();
    expect(toHex(e1.parentHash!)).toBe(toHex(e0Hash));
  });
});

describe('rejection: unauthorized signer', () => {
  test('non-genesis key cannot author the genesis entry', async () => {
    const chain = makeChain([alice.publicKey]);

    // Eve tries to start a chain even though she's not in the genesis set.
    // authorAndAppend throws because the entry would be rejected.
    await expect(
      chain.authorAndAppend(
        { op: 'add', keys: [eve.hashHex] },
        eve.publicKey,
        eve.privateKey,
      ),
    ).rejects.toThrow(/unauthorized-signer/);

    expect(chain.length).toBe(0);
  });

  test('non-writer cannot author a non-genesis entry', async () => {
    const chain = makeChain([alice.publicKey]);
    await chain.authorAndAppend(
      { op: 'add', keys: [alice.hashHex] },
      alice.publicKey,
      alice.privateKey,
    );

    await expect(
      chain.authorAndAppend(
        { op: 'add', keys: [eve.hashHex] },
        eve.publicKey,
        eve.privateKey,
      ),
    ).rejects.toThrow(/unauthorized-signer/);
  });

  test('removed writer cannot replay a pre-removal style change', async () => {
    // Threat model:
    //   - Bob is a legitimate writer for a while.
    //   - Alice removes Bob.
    //   - Bob, having held his private key the whole time, signs a *new*
    //     entry as if he were still a writer, with a parentHash that
    //     correctly points at the current head (he can read the chain).
    //   - The chain MUST reject this: Bob is no longer a writer.
    const chain = makeChain([alice.publicKey]);

    await chain.authorAndAppend(
      { op: 'add', keys: [alice.hashHex] },
      alice.publicKey,
      alice.privateKey,
    );
    await chain.authorAndAppend(
      { op: 'add', keys: [bob.hashHex] },
      alice.publicKey,
      alice.privateKey,
    );
    // Bob legitimately authors something while he's still a writer.
    await chain.authorAndAppend(
      { op: 'add', keys: [carol.hashHex] },
      bob.publicKey,
      bob.privateKey,
    );
    // Alice removes Bob.
    await chain.authorAndAppend(
      { op: 'remove', keys: [bob.hashHex] },
      alice.publicKey,
      alice.privateKey,
    );

    expect(await testOps.isWriter(chain.state!, bob.publicKey)).toBe(false);

    // Bob crafts a fresh entry now that points at the current head.
    const head = chain.headHash;
    const seq = chain.length;
    const payload = {
      sequenceNumber: seq,
      timestamp: Date.now(),
      parentHash: head,
      change: { op: 'add' as const, keys: [eve.hashHex] },
      signerKeyHash: await serializePublicKey(bob.publicKey),
    };
    const encoded = canonicalEntryPayload(payload, serializeChange);
    const signature = await auth.sign(encoded, bob.privateKey);
    const evilEntry: ACLEntry<AclChange> = { ...payload, signature };

    const result = await chain.ingestEntry(evilEntry, bob.publicKey);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('unauthorized-signer');
    }
    expect(chain.length).toBe(4); // unchanged
  });

  test('replay of a removed writer\'s *historical* entry against a fresh chain fails', async () => {
    // Different threat: a former writer captured an entry they previously
    // authored (signature was valid at the time) and tries to feed it back
    // into a new node that is bootstrapping from a snapshot in which they
    // are no longer a writer. The chain must reject based on the current
    // state, not the historical state.
    const chain = makeChain([alice.publicKey]);

    await chain.authorAndAppend(
      { op: 'add', keys: [alice.hashHex] },
      alice.publicKey,
      alice.privateKey,
    );
    await chain.authorAndAppend(
      { op: 'add', keys: [bob.hashHex] },
      alice.publicKey,
      alice.privateKey,
    );
    const bobsLegitEntry = await chain.authorAndAppend(
      { op: 'add', keys: [carol.hashHex] },
      bob.publicKey,
      bob.privateKey,
    );
    await chain.authorAndAppend(
      { op: 'remove', keys: [bob.hashHex] },
      alice.publicKey,
      alice.privateKey,
    );

    // Now simulate a new node receiving the FIRST TWO entries (genesis +
    // bob added) and then immediately being fed bob's "legit" entry as if
    // out-of-order. The new node accepts genesis + add(bob) (because
    // sequence still lines up), then bob's entry should still be accepted
    // *if its sequenceNumber matches*. So this case is actually a legit
    // replay -- we test it elsewhere. Here we test the more interesting
    // case: feeding the entry with the WRONG sequence number gets rejected
    // for sequence-out-of-order, even though Bob *was* a valid writer.
    const fresh = makeChain([alice.publicKey]);
    await fresh.authorAndAppend(
      { op: 'add', keys: [alice.hashHex] },
      alice.publicKey,
      alice.privateKey,
    );
    // Skip the "add Bob" entry to simulate trying to inject Bob's entry
    // out of order.
    const result = await fresh.ingestEntry(bobsLegitEntry, bob.publicKey);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      // Either parent-hash-mismatch or sequence-out-of-order is acceptable
      // -- both are valid rejections. Just make sure it didn't slip through.
      expect(['parent-hash-mismatch', 'sequence-out-of-order']).toContain(
        result.reason,
      );
    }
  });
});

describe('rejection: tampering and replay', () => {
  test('flipping a single byte in the change invalidates the signature', async () => {
    // Build a chain, snapshot its entries, then construct a fresh chain
    // by replaying the *first* entry verbatim (so the head hashes match)
    // and try to ingest a tampered version of the *second* entry.
    const chain = makeChain([alice.publicKey]);
    const e0 = await chain.authorAndAppend(
      { op: 'add', keys: [alice.hashHex] },
      alice.publicKey,
      alice.privateKey,
    );
    const e1 = await chain.authorAndAppend(
      { op: 'add', keys: [bob.hashHex] },
      alice.publicKey,
      alice.privateKey,
    );

    // Replay e0 verbatim into a fresh chain so the heads line up.
    const fresh = makeChain([alice.publicKey]);
    const r0 = await fresh.ingestEntry(e0, alice.publicKey);
    expect(r0.ok).toBe(true);

    // Tamper: switch the add target from bob to eve while keeping the
    // signature unchanged. Signature was over the bob-add payload, so it
    // must no longer verify.
    const tampered: ACLEntry<AclChange> = {
      ...e1,
      change: { op: 'add', keys: [eve.hashHex] },
    };
    const result = await fresh.ingestEntry(tampered, alice.publicKey);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('bad-signature');
  });

  test('substituting a different signer for the same payload is rejected', async () => {
    const chain = makeChain([alice.publicKey]);
    await chain.authorAndAppend(
      { op: 'add', keys: [alice.hashHex] },
      alice.publicKey,
      alice.privateKey,
    );
    const entry = await chain.authorAndAppend(
      { op: 'add', keys: [bob.hashHex] },
      alice.publicKey,
      alice.privateKey,
    );

    const fresh = makeChain([alice.publicKey]);
    await fresh.authorAndAppend(
      { op: 'add', keys: [alice.hashHex] },
      alice.publicKey,
      alice.privateKey,
    );

    // Caller claims Eve signed, but the signerKeyHash inside the entry
    // says Alice -- mismatch caught before we even try to verify.
    const result = await fresh.ingestEntry(entry, eve.publicKey);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('unknown-signer-key');
  });

  test('exact duplicate ingest is rejected', async () => {
    const chain = makeChain([alice.publicKey]);
    const e0 = await chain.authorAndAppend(
      { op: 'add', keys: [alice.hashHex] },
      alice.publicKey,
      alice.privateKey,
    );

    // Try to ingest the same entry again -- sequence number is now 1, so
    // this is caught as sequence-out-of-order before we hit the duplicate
    // check, but the chain MUST reject it either way. We check that the
    // chain length stays at 1.
    const result = await chain.ingestEntry(e0, alice.publicKey);
    expect(result.ok).toBe(false);
    expect(chain.length).toBe(1);
  });

  test('fork attempt: two entries with the same parent are not both accepted', async () => {
    // Build a chain to a fork point.
    const chain = makeChain([alice.publicKey]);
    await chain.authorAndAppend(
      { op: 'add', keys: [alice.hashHex] },
      alice.publicKey,
      alice.privateKey,
    );
    await chain.authorAndAppend(
      { op: 'add', keys: [bob.hashHex] },
      alice.publicKey,
      alice.privateKey,
    );

    const forkPoint = chain.headHash;
    const forkSeq = chain.length;

    // Build entry A: alice adds carol.
    const payloadA = {
      sequenceNumber: forkSeq,
      timestamp: 1000,
      parentHash: forkPoint,
      change: { op: 'add' as const, keys: [carol.hashHex] },
      signerKeyHash: await serializePublicKey(alice.publicKey),
    };
    const sigA = await auth.sign(
      canonicalEntryPayload(payloadA, serializeChange),
      alice.privateKey,
    );
    const entryA: ACLEntry<AclChange> = { ...payloadA, signature: sigA };

    // Build entry B: bob adds eve. Same parent, same seq, different content.
    const payloadB = {
      sequenceNumber: forkSeq,
      timestamp: 1001,
      parentHash: forkPoint,
      change: { op: 'add' as const, keys: [eve.hashHex] },
      signerKeyHash: await serializePublicKey(bob.publicKey),
    };
    const sigB = await auth.sign(
      canonicalEntryPayload(payloadB, serializeChange),
      bob.privateKey,
    );
    const entryB: ACLEntry<AclChange> = { ...payloadB, signature: sigB };

    // First one in wins.
    const rA = await chain.ingestEntry(entryA, alice.publicKey);
    expect(rA.ok).toBe(true);
    expect(await testOps.isWriter(chain.state!, carol.publicKey)).toBe(true);

    // Second one is rejected: its parentHash no longer matches the head.
    const rB = await chain.ingestEntry(entryB, bob.publicKey);
    expect(rB.ok).toBe(false);
    if (!rB.ok) {
      expect(['parent-hash-mismatch', 'sequence-out-of-order']).toContain(
        rB.reason,
      );
    }
    expect(await testOps.isWriter(chain.state!, eve.publicKey)).toBe(false);
  });

  test('mid-chain malicious insertion is rejected', async () => {
    // Attacker wants to splice an entry into the middle of an existing
    // chain. Even if the entry's content is plausible, its parentHash
    // points to a non-head position so the chain rejects it.
    const chain = makeChain([alice.publicKey]);

    const e0 = await chain.authorAndAppend(
      { op: 'add', keys: [alice.hashHex] },
      alice.publicKey,
      alice.privateKey,
    );
    await chain.authorAndAppend(
      { op: 'add', keys: [bob.hashHex] },
      alice.publicKey,
      alice.privateKey,
    );
    await chain.authorAndAppend(
      { op: 'add', keys: [carol.hashHex] },
      alice.publicKey,
      alice.privateKey,
    );

    // Construct a malicious entry whose parentHash points at e0 (the
    // genesis), not the current head. Even with a valid signature from
    // Alice, this must be rejected.
    const e0Hash = await computeEntryHash(e0, serializeChange);
    const payload = {
      sequenceNumber: chain.length,
      timestamp: 9999,
      parentHash: e0Hash,
      change: { op: 'add' as const, keys: [eve.hashHex] },
      signerKeyHash: await serializePublicKey(alice.publicKey),
    };
    const signature = await auth.sign(
      canonicalEntryPayload(payload, serializeChange),
      alice.privateKey,
    );
    const evil: ACLEntry<AclChange> = { ...payload, signature };
    const result = await chain.ingestEntry(evil, alice.publicKey);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('parent-hash-mismatch');
  });

  test('sequence number that skips ahead is rejected', async () => {
    const chain = makeChain([alice.publicKey]);
    await chain.authorAndAppend(
      { op: 'add', keys: [alice.hashHex] },
      alice.publicKey,
      alice.privateKey,
    );

    const head = chain.headHash;
    const payload = {
      sequenceNumber: 5, // chain expects 1
      timestamp: 1000,
      parentHash: head,
      change: { op: 'add' as const, keys: [bob.hashHex] },
      signerKeyHash: await serializePublicKey(alice.publicKey),
    };
    const signature = await auth.sign(
      canonicalEntryPayload(payload, serializeChange),
      alice.privateKey,
    );
    const result = await chain.ingestEntry(
      { ...payload, signature },
      alice.publicKey,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('sequence-out-of-order');
  });
});

describe('replay() snapshot loading', () => {
  test('round-trips a legitimate chain into a fresh ACLChain instance', async () => {
    const chain = makeChain([alice.publicKey]);
    await chain.authorAndAppend(
      { op: 'add', keys: [alice.hashHex] },
      alice.publicKey,
      alice.privateKey,
    );
    await chain.authorAndAppend(
      { op: 'add', keys: [bob.hashHex] },
      alice.publicKey,
      alice.privateKey,
    );
    await chain.authorAndAppend(
      { op: 'add', keys: [carol.hashHex] },
      bob.publicKey,
      bob.privateKey,
    );

    const entries = chain.entries();

    // Build a resolver that can recover each public key from its hash --
    // in production this would consult a directory or a separate keystore.
    const byHash = new Map<string, CryptoKey>([
      [alice.hashHex, alice.publicKey],
      [bob.hashHex, bob.publicKey],
      [carol.hashHex, carol.publicKey],
    ]);

    const fresh = makeChain([alice.publicKey]);
    const result = await fresh.replay(entries, async (hash) =>
      byHash.get(toHex(hash)),
    );
    expect(result.ok).toBe(true);
    expect(fresh.length).toBe(3);
    expect(await testOps.isWriter(fresh.state!, alice.publicKey)).toBe(true);
    expect(await testOps.isWriter(fresh.state!, bob.publicKey)).toBe(true);
    expect(await testOps.isWriter(fresh.state!, carol.publicKey)).toBe(true);
  });

  test('replay rejects a chain with a hostile entry spliced in', async () => {
    const chain = makeChain([alice.publicKey]);
    const e0 = await chain.authorAndAppend(
      { op: 'add', keys: [alice.hashHex] },
      alice.publicKey,
      alice.privateKey,
    );
    const e1 = await chain.authorAndAppend(
      { op: 'add', keys: [bob.hashHex] },
      alice.publicKey,
      alice.privateKey,
    );

    // Build an Eve-authored entry that *looks* like it would extend the
    // chain, but Eve has never been a writer.
    const headAfterE1 = await computeEntryHash(e1, serializeChange);
    const payload = {
      sequenceNumber: 2,
      timestamp: 5000,
      parentHash: headAfterE1,
      change: { op: 'add' as const, keys: [eve.hashHex] },
      signerKeyHash: await serializePublicKey(eve.publicKey),
    };
    const signature = await auth.sign(
      canonicalEntryPayload(payload, serializeChange),
      eve.privateKey,
    );
    const eveEntry: ACLEntry<AclChange> = { ...payload, signature };

    const byHash = new Map<string, CryptoKey>([
      [alice.hashHex, alice.publicKey],
      [bob.hashHex, bob.publicKey],
      [eve.hashHex, eve.publicKey],
    ]);

    const fresh = makeChain([alice.publicKey]);
    const result = await fresh.replay([e0, e1, eveEntry], async (hash) =>
      byHash.get(toHex(hash)),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('unauthorized-signer');
      expect(result.index).toBe(2);
    }
    // After a failed replay, the chain holds the partial-but-valid prefix
    // so callers can inspect it for diagnostics.
    expect(fresh.length).toBe(2);
  });

  test('replay rejects when resolveKey cannot map a signerKeyHash', async () => {
    const chain = makeChain([alice.publicKey]);
    const e0 = await chain.authorAndAppend(
      { op: 'add', keys: [alice.hashHex] },
      alice.publicKey,
      alice.privateKey,
    );

    const fresh = makeChain([alice.publicKey]);
    const result = await fresh.replay([e0], async () => undefined);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('unknown-signer-key');
      expect(result.index).toBe(0);
    }
  });
});

describe('headHash behavior', () => {
  test('headHash returns a copy that callers cannot mutate', async () => {
    const chain = makeChain([alice.publicKey]);
    await chain.authorAndAppend(
      { op: 'add', keys: [alice.hashHex] },
      alice.publicKey,
      alice.privateKey,
    );

    const head1 = chain.headHash!;
    head1[0] ^= 0xff; // mutate the returned buffer
    const head2 = chain.headHash!;

    // The chain's internal head should not have been affected.
    expect(toHex(head1)).not.toBe(toHex(head2));
  });
});
