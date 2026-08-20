---
title: Security model
description: Swarmbase identities, binary ACL enforcement, encryption, quorum loading, and revocation limits.
---

Swarmbase is alpha software and has not had an independent security audit. Its cryptographic components have meaningful unit coverage, but the complete distributed security model is only partially verified.

## Identity and trust roots

The application supplies the user's signing key pair and is responsible for persisting, recovering, and binding it to a human or account. Swarmbase does not provide a certificate authority, identity directory, custody service, or account recovery. The application must also persist any KEM keys and related membership state it needs.

User signing keys are separate from libp2p peer IDs. ACLs use user public keys; peer IDs identify network participants and connections.

## Implemented authorization

The document's active enforcement uses binary **reader** and **writer** ACLs:

- writers may commit document and ACL changes;
- readers receive or retain document encryption keys and can decrypt allowed epochs;
- every writer can modify both ACLs, so writer access currently includes ACL administration.

Normal sync-message signing and verification are enabled by default but can be disabled with `enableSigning: false`. When enabled, a receiver accepts a sync signature if it verifies under **some current writer key**. The message does not durably identify which writer signed it, so this is current-writer authorization, not explicit per-change authorship or a durable audit attribution record. Disabling signing removes the normal application-layer authentication and ACL enforcement described here; libp2p's transport signing is separate.

Capability helpers, UCAN creation/validation, `UCANACL`, and the ACL chain have standalone implementations and tests. They are not integrated into the normal document mutation, sync, and load path. Do not document or depend on field capabilities, delegated UCAN authorization, or ACL-chain trust as active end-to-end enforcement.

## Encryption and history visibility

Change blocks and sync envelopes use document-key encryption. Possessing a document key provides cryptographic read capability, but current protocol acceptance can also depend on ACL identity, writer signatures, Welcome recipient binding, and current membership state. “Reader” is therefore not reducible to either key possession or an ACL entry alone across every workflow.

History visibility is a local document setting controlling which epoch-key changes that peer sends: `current_only`, `since_invited`, or `full_history`. It is not a global policy that can erase keys another peer already retained, and peers configured differently can disclose different history.

## Initial-load quorum

Initial loading enables a K-of-Q tip-hash gate by default. It asks multiple reachable peer identities to agree on the frontier they would serve, then binds the selected load response to that frontier. This is defense in depth against one stale or malicious responder, not consensus over the true document state.

The gate assumes sufficiently independent, reachable voters and is not Sybil-resistant. A party controlling enough peer identities can dominate the vote. Requiring agreement also reduces availability in small swarms, partitions, or after compaction and pruning. Snapshot loading requires writer verification when signing is enabled, but a first-time loader may not yet have the trusted writer ACL needed to accept that snapshot. The quorum covers the served frontier and can omit other locally known concurrent heads.

## Revocation

Removing a writer means future signed sync messages from that key no longer verify against the current writer ACL. It does not retract previously accepted changes or remove reader access the same identity may still hold.

Removing a reader requires both ACL change and future-key separation. Swarmbase includes a BeeKEM ratchet-tree cryptographic core, encrypted Welcomes, and a PathUpdate flow that derives a new epoch key for surviving readers. The cryptographic primitives and focused flows are tested, but the document integration keeps important BeeKEM membership mappings and tree state in memory. PathUpdate distribution is best effort, with no durable retry.

Restart, missed or out-of-order updates, concurrent/multiple writers, membership recovery, and complete multi-peer revocation are not solved or system-verified. A removed reader may retain old keys and plaintext, and failures can leave surviving peers on different epochs. Swarmbase therefore does not provide an absolute guarantee that revocation prevents all future decryption in the deployed system.

## Metadata and hostile infrastructure

Relays and storage peers need not receive plaintext, but they can observe identifiers, addresses, topics, timing, sizes, and key-rotation metadata. They can censor, delay, or partition peers. Encryption and signatures do not provide availability or traffic-analysis resistance; see [Networking](../networking/).

## CI-backed evidence

Current CI verifies WebCrypto operations, encryption tamper failure, binary ACLs in both adapters, UCAN/capability/ACL-chain components, epoch/keychain code, BeeKEM trees, Welcomes, revocation helpers, and PathUpdates. Missing system evidence includes persistent identity UX, hostile multi-peer quorum, ACL forks, revoked-peer writes, restart and missed-update recovery, and proof that removed readers cannot decrypt post-removal content. See [Limitations](../limitations/).
