---
title: Security model
description: How Swarmbase protects documents on untrusted networks — user keys, ACLs, change signing, AES-GCM encryption, and key rotation on revocation.
---

Swarmbase is designed to operate on untrusted networks with the assistance of unknown or untrusted peers. That only works if the security model is explicit about who is trusted with what. This page describes that model as implemented today. One caveat up front: Swarmbase is **alpha software and has not had an independent security audit** — see [Limitations](../limitations/).

## Users are public keys — not peer IDs

Every user is identified by a **permanent signing key pair**. The public key *is* the identity: ACLs are lists of public keys, and every change is attributable to one.

This is deliberately *not* the libp2p peer ID. A peer ID identifies a network endpoint, and it is not permanent — it can change when a node restarts, and one human may use many devices and browser sessions. Access control needs an identity that survives all of that, so Swarmbase keeps the two layers separate: [libp2p](../networking/) moves bytes between peer IDs; the security layer trusts only user keys.

Cryptography is pluggable through the `AuthProvider` interface (`sign`, `verify`, `encrypt`, `decrypt`), so applications control key types and algorithms. The shipped `SubtleCrypto` provider uses the browser's WebCrypto API, with ECDSA (SHA-384) signatures and AES-GCM encryption by default (AES-CTR and AES-CBC are supported with an encrypt-then-MAC HMAC-SHA256 construction, since only GCM is authenticated on its own).

Key custody is the application's job: Swarmbase does not generate, store, or recover user keys for you. Lose the private key, lose the identity.

## ACLs: who may read, who may write

Each document carries two ACLs — **readers** and **writers** — plus a hierarchical capability model (`/doc/admin` > `/doc/write` > `/doc/read`, with `/doc/history` as a separate, orthogonal grant for access to historical epoch keys). ACL entries are public keys. Membership changes (`addWriter`, `removeWriter`, `addReader`, `removeReader`) are themselves changes in the document's [Merkle-DAG](../storage/), so the permission history is replicated, ordered, and tamper-evident alongside the data. Only current writers may modify ACLs.

Write access is enforced by verification, read access by encryption:

## Writes: signing and verification

Every change follows the same path on the writer's side: check local write access, apply the change to the local CRDT, build the sync message (with its Merkle-DAG links), **sign it with the user's private key**, then **encrypt it with the current document key** and publish `keyID ‖ nonce ‖ ciphertext` to the document's [GossipSub topic](../networking/).

Receivers reverse it: decrypt with the document key (possible only for readers), then verify the signature against the public keys in the writer ACL. A message that fails to decrypt or verify is dropped with a warning — it never touches the document. An attacker without a writer's private key cannot fabricate a change that any honest peer will apply, no matter how many network nodes they control.

Initial document loads get an extra guard: before trusting a peer's copy of history, the loader probes several peers for a hash of their current document tips and requires a quorum to agree, so a single malicious or stale peer cannot quietly feed a joining peer a forked document.

## Reads: document encryption

Every document is encrypted with its own symmetric **document key** (AES-GCM, 256-bit, 12-byte random nonce per operation). All change payloads and sync messages are encrypted before they leave the device; blocks in the [blockstore](../storage/) are stored encrypted too. Anyone may store, forward, or serve the ciphertext — being a reader means holding the document key, nothing else.

Keys live in a per-document **keychain**, which is itself a small CRDT synchronized only to authorized readers. Because keys rotate over time (below), the keychain holds a history of keys, each identified by the key ID that prefixes encrypted blocks on the wire. How much key history a *new* member receives is configurable per document: only the current key (`current_only`, the default and most private), everything since they were invited (`since_invited`), or the full history (`full_history`, for audit use cases).

## Revocation and key rotation

Removing a *writer* is straightforward: their key leaves the writer ACL and their future signatures stop verifying.

Removing a *reader* is harder — they hold the document key. Swarmbase therefore **rotates the document key on read-permission revocation**, using BeeKEM, a TreeKEM-style group key-agreement tree: each reader occupies a leaf; removing a reader blanks their leaf and re-keys the path to the root; the writer broadcasts a path-update from which every *surviving* reader — and no one else — can compute the new root secret. Each peer independently derives the new document key from that secret (HKDF-SHA-256) and installs it in the keychain as a new epoch. All subsequent changes are encrypted under the new key. The removed reader can still see ciphertext on the network but can no longer derive the key that opens it.

Be precise about what revocation does **not** do: it protects *future* changes only. A revoked reader keeps whatever state their device already decrypted — no distributed system can reach into someone else's machine and delete data. This is fundamental, not a bug to be fixed later.

## Out-of-band key sharing

Two things must travel *outside* Swarmbase, over a channel you already trust — for example an end-to-end-encrypted messenger like Signal, or in person:

1. **Identity public keys.** When you add someone to an ACL you are naming their public key; you must obtain it in a way you trust, because Swarmbase has no certificate authority or identity directory to vouch for key ownership.
2. **The invitee's KEM public key.** Joining a document's encrypted group requires the new reader to hold a KEM key pair (P-256 ECDH); the inviter needs its public half to call `addReader`. The actual document keys then travel *in-band*: the inviter sends a Welcome message whose key material is sealed with ECIES to the invitee's KEM public key, so even the Welcome is unreadable to the rest of the swarm.

Get step 1 wrong — accept a key from an attacker claiming to be your collaborator — and you have granted the attacker access. The cryptography can only enforce the ACL you actually wrote.

## What untrusted peers can and cannot learn

Untrusted peers — relays, pinning nodes, strangers in the mesh — **cannot**: read document contents, forge or modify changes, grant themselves access, or usefully tamper with stored blocks (content addressing plus AES-GCM authentication makes substitution detectable).

They **can** observe metadata: document topic names (which by default embed the document *path* — keep paths non-sensitive), which peer IDs/IP addresses participate in which documents, message sizes and timing, key IDs (revealing when rotations happen), and the total volume of activity. Swarmbase does not attempt to hide traffic patterns; if you need resistance to traffic analysis, you need additional layers it does not provide.

## Where to go next

- [Storage](../storage/) — why encrypted blocks on untrusted nodes are safe to replicate.
- [Networking](../networking/) — the relay's role as an explicitly untrusted component.
- [Limitations](../limitations/) — audit status and other honest caveats.
