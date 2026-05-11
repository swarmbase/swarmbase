import { describe, expect, test } from '@jest/globals';
import { CRDTSyncMessage } from './crdt-sync-message';
import { SyncMessageSerializer } from './sync-message-serializer';
import {
  evaluateBeeKEMWelcome,
  WelcomeValidationDeps,
} from './beekem-welcome-handler';

/**
 * Direct unit-test coverage for the security-critical gates of the
 * BeeKEM Welcome receive path.
 *
 * Comment #3222310800 on PR #273 asked for an integration-style test
 * that drives the receive-side validation against a real/mock
 * `AuthProvider`, ACL, and `Keychain`, since prior coverage only
 * mirrored decision logic in a helper. The validation gates have been
 * extracted from `CollabswarmDocument.handleBeeKEMWelcomeRequestData`
 * into the pure `evaluateBeeKEMWelcome` helper so each gate can be
 * exercised directly here with small mocks, rather than requiring a
 * full libp2p/Helia stack to construct a `CollabswarmDocument`.
 *
 * The production handler calls this same helper and applies
 * keychain.merge + `_invitationEpoch` assignment when the result is
 * `accept`; tests that exercise the mutation side-effects live in
 * `beekem-welcome.test.ts` against the in-memory keychain.
 */

type ChangesType = Uint8Array;
type PublicKey = { id: string };

/**
 * Minimal sync-message serializer that survives the round-trip used by
 * `evaluateBeeKEMWelcome` to compute the canonical bytes covered by
 * the writer signature. We only need a stable byte representation that
 * is deterministic for equal messages.
 */
const stubSerializer: SyncMessageSerializer<ChangesType, PublicKey> = {
  serializeSyncMessage(message: CRDTSyncMessage<ChangesType, PublicKey>) {
    return new TextEncoder().encode(JSON.stringify(message));
  },
  deserializeSyncMessage(_data: Uint8Array) {
    throw new Error('not used in evaluation');
  },
} as unknown as SyncMessageSerializer<ChangesType, PublicKey>;

function makeDeps(
  overrides: Partial<WelcomeValidationDeps<ChangesType, PublicKey>> = {},
): WelcomeValidationDeps<ChangesType, PublicKey> {
  return {
    documentPath: '/doc/welcome',
    localUserPublicKey: { id: 'my-pubkey' },
    isSigningEnabled: () => false,
    serializePublicKey: async (pk) => pk.id,
    isReader: async () => true,
    verifyWriterSignature: async () => true,
    syncMessageSerializer: stubSerializer,
    ...overrides,
  };
}

function baseAcceptableMessage(): CRDTSyncMessage<ChangesType, PublicKey> {
  return {
    documentId: '/doc/welcome',
    welcomeEpochId: new Uint8Array(32).fill(7),
    welcomeRecipient: 'my-pubkey',
    keychainChanges: new Uint8Array([1, 2, 3]),
  };
}

describe('evaluateBeeKEMWelcome (security-critical gates)', () => {
  test('accepts a fully-valid Welcome with signing disabled', async () => {
    const result = await evaluateBeeKEMWelcome(baseAcceptableMessage(), makeDeps());
    expect(result.kind).toBe('accept');
  });

  test('drops Welcomes for a different document path', async () => {
    const msg = { ...baseAcceptableMessage(), documentId: '/doc/other' };
    const result = await evaluateBeeKEMWelcome(msg, makeDeps());
    expect(result).toEqual({ kind: 'drop-malformed', reason: 'wrong-document' });
  });

  test('drops Welcomes missing welcomeEpochId', async () => {
    const msg = baseAcceptableMessage();
    delete msg.welcomeEpochId;
    const result = await evaluateBeeKEMWelcome(msg, makeDeps());
    expect(result).toEqual({
      kind: 'drop-malformed',
      reason: 'missing-welcome-epoch-id',
    });
  });

  test('drops Welcomes missing welcomeRecipient (recipient-binding gate)', async () => {
    const msg = baseAcceptableMessage();
    delete msg.welcomeRecipient;
    const result = await evaluateBeeKEMWelcome(msg, makeDeps());
    expect(result).toEqual({
      kind: 'drop-malformed',
      reason: 'missing-welcome-recipient',
    });
  });

  test('silently drops Welcomes addressed to someone else', async () => {
    const msg = {
      ...baseAcceptableMessage(),
      welcomeRecipient: 'someone-else',
    };
    const result = await evaluateBeeKEMWelcome(msg, makeDeps());
    expect(result).toEqual({ kind: 'drop-not-for-us' });
  });

  test('drops Welcomes addressed to us when we are not in the readers ACL', async () => {
    const result = await evaluateBeeKEMWelcome(
      baseAcceptableMessage(),
      makeDeps({ isReader: async () => false }),
    );
    expect(result).toEqual({
      kind: 'drop-unauthorized',
      reason: 'not-in-readers-acl',
    });
  });

  test('drops unsigned Welcomes when signing is enabled', async () => {
    const result = await evaluateBeeKEMWelcome(
      baseAcceptableMessage(),
      makeDeps({ isSigningEnabled: () => true }),
    );
    expect(result).toEqual({
      kind: 'drop-unauthorized',
      reason: 'missing-signature',
    });
  });

  test('drops Welcomes with an invalid writer signature', async () => {
    const msg = { ...baseAcceptableMessage(), signature: 'sig-bytes' };
    const result = await evaluateBeeKEMWelcome(
      msg,
      makeDeps({
        isSigningEnabled: () => true,
        verifyWriterSignature: async () => false,
      }),
    );
    expect(result).toEqual({
      kind: 'drop-unauthorized',
      reason: 'invalid-signature',
    });
  });

  test('accepts signed Welcomes when the writer signature verifies', async () => {
    let verifiedRawLength = 0;
    let verifiedSig = '';
    const msg = { ...baseAcceptableMessage(), signature: 'good-sig' };

    const result = await evaluateBeeKEMWelcome(
      msg,
      makeDeps({
        isSigningEnabled: () => true,
        verifyWriterSignature: async (raw, sig) => {
          verifiedRawLength = raw.length;
          verifiedSig = sig;
          return true;
        },
      }),
    );

    expect(result.kind).toBe('accept');
    // The signature gate must verify over the message **without** the
    // signature field embedded -- otherwise the inviter's signing
    // convention (`_signAsWriter` strips the signature before signing)
    // and the verification convention disagree.
    expect(verifiedSig).toBe('good-sig');
    expect(verifiedRawLength).toBeGreaterThan(0);
    const reSerialized = stubSerializer.serializeSyncMessage(msg);
    expect(verifiedRawLength).toBeLessThan(reSerialized.length);
  });

  test('gate ordering: missing welcomeEpochId takes precedence over missing welcomeRecipient', async () => {
    const msg: CRDTSyncMessage<ChangesType, PublicKey> = {
      documentId: '/doc/welcome',
      // Both welcomeEpochId and welcomeRecipient are missing. The
      // epoch-id gate runs first so the reported reason is the
      // epoch-id one, matching the production handler's order.
    };
    const result = await evaluateBeeKEMWelcome(msg, makeDeps());
    expect(result).toEqual({
      kind: 'drop-malformed',
      reason: 'missing-welcome-epoch-id',
    });
  });

  test('gate ordering: not-for-us check runs before the readers-ACL check', async () => {
    // A Welcome addressed to someone else should never invoke
    // `isReader` -- otherwise a misaddressed Welcome would still leak
    // the ACL-membership probe to whatever provider the test wires in.
    let isReaderCalled = false;
    const msg = {
      ...baseAcceptableMessage(),
      welcomeRecipient: 'someone-else',
    };
    const result = await evaluateBeeKEMWelcome(
      msg,
      makeDeps({
        isReader: async () => {
          isReaderCalled = true;
          return false;
        },
      }),
    );
    expect(result).toEqual({ kind: 'drop-not-for-us' });
    expect(isReaderCalled).toBe(false);
  });

  test('gate ordering: readers-ACL check runs before signature verification', async () => {
    // A non-member should be rejected even if the signature would
    // verify; we should not feed the signature path with unauthorized
    // inputs.
    let verifyCalled = false;
    const msg = { ...baseAcceptableMessage(), signature: 'sig' };
    const result = await evaluateBeeKEMWelcome(
      msg,
      makeDeps({
        isSigningEnabled: () => true,
        isReader: async () => false,
        verifyWriterSignature: async () => {
          verifyCalled = true;
          return true;
        },
      }),
    );
    expect(result).toEqual({
      kind: 'drop-unauthorized',
      reason: 'not-in-readers-acl',
    });
    expect(verifyCalled).toBe(false);
  });
});
