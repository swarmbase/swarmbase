---
title: Encrypted shared secrets store
description: Build a password manager where secrets are end-to-end encrypted and shared per-document via ACLs.
---

You want to store passwords and share individual ones with specific people — without any server ever being able to read them. With Swarmbase every document is end-to-end encrypted with its own key, and access is controlled by a per-document ACL of public keys, so "share this one password with Bob" is a first-class operation rather than a server-side permission check you have to trust. This recipe follows the `examples/password-manager` app in the repository.

## Why E2E encryption matters here

Secrets travel through relay servers and other peers you don't control. In Swarmbase, change payloads are AES-GCM-encrypted with a per-document symmetric key managed by the document keychain, and signed with the author's key. Relays and non-member peers forward and store ciphertext only. Removing a reader rotates the document key, so *future* changes are unreadable to them (see Pitfalls for what rotation cannot do).

## Identity is a keypair

There are no accounts. A user *is* an ECDSA P-384 WebCrypto keypair. Generate one on first login and let the user save it — losing the private key means losing access:

```typescript
// login.ts — from examples/password-manager/src/Login.tsx and utils.ts
export async function generateIdentity() {
  const keypair = await crypto.subtle.generateKey(
    { name: 'ECDSA', namedCurve: 'P-384' },
    true,
    ['sign', 'verify'],
  );
  return keypair;
}

// Persist / restore keys as JWK strings so the user can keep them.
export async function exportKey(key: CryptoKey): Promise<string> {
  const jwk = await crypto.subtle.exportKey('jwk', key);
  return JSON.stringify(jwk);
}

export async function importKey(
  keyData: string,
  keyUsage: KeyUsage[], // ['sign'] for private, ['verify'] for public
): Promise<CryptoKey> {
  const jwk = JSON.parse(keyData) as JsonWebKey;
  return await crypto.subtle.importKey(
    'jwk',
    jwk,
    { name: 'ECDSA', namedCurve: 'P-384' },
    true,
    keyUsage,
  );
}
```

The swarm setup (providers, `useCollabswarm`, `CollabswarmContext.Provider`) is identical to the [collaborative wiki recipe](../collaborative-wiki/) — the password manager example passes `YjsProvider`, `YjsJSONSerializer` (three times: changes, sync, and load serializer), `SubtleCrypto`, `YjsACLProvider`, and `YjsKeychainProvider` to `useCollabswarm`.

## A private index plus one document per secret

Each secret lives in its own document at `/passwords/<uuid>` so it can be shared individually. A per-user index document lists the secrets you know about:

```tsx
// PasswordList.tsx (condensed from examples/password-manager/src/PasswordList.tsx)
import React from 'react';
import * as Y from 'yjs';
import * as uuid from 'uuid';
import { useCollabswarmDocumentState } from '@swarmbase/collabswarm-react';
import { YjsCollabswarm } from './utils';

export function PasswordList({
  userId,
  collabswarm,
}: {
  userId: string;
  collabswarm: YjsCollabswarm;
}) {
  const [passwords, changePasswords] = useCollabswarmDocumentState(
    collabswarm,
    `/${userId}/passwords-index`,
  );

  const addSecret = () => {
    changePasswords((current: Y.Doc) => {
      current.getArray<Y.Map<Y.Text>>('passwords').push([
        new Y.Map<Y.Text>(
          Object.entries({
            id: new Y.Text(uuid.v4()),
          }),
        ),
      ]);
    });
  };

  return (
    <ul>
      {passwords &&
        passwords.getArray<Y.Map<Y.Text>>('passwords').map((password) => {
          const id = password.get('id')?.toString();
          const name = password.get('name')?.toString();
          return <li key={id}>{name || `Unnamed Secret (id: ${id})`}</li>;
        })}
      <li>
        <button onClick={addSecret}>New Secret</button>
      </li>
    </ul>
  );
}
```

Editing a secret's value applies a character-level delta so concurrent edits merge (see the wiki recipe for the same pattern):

```tsx
// PasswordEditor.tsx (condensed)
import Delta from 'quill-delta';
import * as Y from 'yjs';

const [doc, changeDoc] = useCollabswarmDocumentState(
  collabswarm,
  `/passwords/${passwordId}`,
);
const value = doc && doc.getText('value').toString();

// In the input's onChange:
const a = new Delta().insert(value || '');
const b = new Delta().insert(e.target.value);
const diff = a.diff(b);
changeDoc((current: Y.Doc) => {
  current.getText('value').applyDelta(diff.ops);
});
```

## Share a secret with the ACL

The third element of the `useCollabswarmDocumentState` tuple exposes the document's ACL. To share, a teammate copies their serialized public key to you (out of band); you deserialize it and add them as a reader (decrypt) or writer (decrypt + edit):

```tsx
// PermissionsTable.tsx (condensed from examples/password-manager/src/PermissionsTable.tsx)
import { useCollabswarmDocumentState } from '@swarmbase/collabswarm-react';
import { deserializeKey, serializeKey } from '@swarmbase/collabswarm-yjs';

const [, , { readers, addReader, removeReader, writers, addWriter, removeWriter }] =
  useCollabswarmDocumentState(collabswarm, `/passwords/${passwordId}`);

// Add a collaborator from their pasted public key:
const key = await deserializeKey(
  { name: 'ECDSA', namedCurve: 'P-384' },
  ['verify'],
)(pastedPublicKey);

await addReader(key);   // read-only: can decrypt
// or
await addWriter(key);   // read/write: can decrypt and author changes

// Revoke:
await removeReader(key); // rotates the document key for future changes

// Display keys in the UI:
const shortId = await serializeKey(someReaderKey); // base64 of the raw public key
```

Users find their own shareable public key the same way: `serializeKey(publicKey)` (the example shows it on a Settings page, alongside the node's multiaddrs from `collabswarm.libp2p.getMultiaddrs()`).

## How it works

- Each document keychain generates an AES-GCM-256 key; every change block is encrypted with the current key and tagged with a key ID before broadcast.
- `addReader`/`addWriter` update the document's CRDT-backed ACL and distribute key material to the new member; `removeReader` triggers key rotation so subsequent changes use a key the removed member never receives.
- `getReaders()` returns readers *and* writers — the example de-duplicates by serialized key when rendering a permissions table.
- The index document at `/${userId}/passwords-index` is just another encrypted document, private to you by default. Importing a secret someone shared is: add its ID to your index, then open `/passwords/<id>` — which only decrypts if you're on the ACL.

## Pitfalls

- **Revocation is forward-only.** A removed reader keeps everything they already decrypted, and can still decrypt history encrypted under keys they held. Key rotation protects *future* changes only. This is fundamental to CRDTs, not a bug to be patched later.
- **Key loss is unrecoverable.** There's no password reset. If the user loses the private key JWK, their index and any unshared secrets are gone. Make export/backup a prominent flow.
- **The document path is not a secret capability.** Anyone can subscribe to `/passwords/<uuid>` topics and collect ciphertext; only ACL members can decrypt. Don't put sensitive data in the path itself.
- **Index and secret can drift.** The secret's name is stored both in the secret document and in your index entry; the example updates both in the same UI handler. If you change the schema, keep that dual-write in mind.
- **Alpha software; unaudited crypto.** The encryption design has not had an external security audit. Don't protect production credentials with it yet — and run a [pinning node](../pinning/) so an all-tabs-closed weekend doesn't delete your vault.
