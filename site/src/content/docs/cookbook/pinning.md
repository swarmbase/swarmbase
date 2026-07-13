---
title: Keeping data alive (pinning)
description: Understand the data-loss risk in a peer-to-peer database and run a pinning node so documents survive when every browser closes.
---

Swarmbase has no central database: a document exists only as long as some peer holds a copy. Browsers are terrible archivists — tabs close, storage gets evicted, laptops sleep — so without help, a document that only ever lived in two browsers can simply vanish. Pinning is the answer: an always-on node that stores document data durably and serves it back to peers.

:::caution[Read this before storing anything you care about]
This is an alpha project, and the repository README says it plainly: **data loss can occur if all clients lose local storage and no remote pinning is set up.** Treat data in Swarmbase today "like venture investing — only put in what you can afford to lose." Pinning tooling is one of the thinnest areas of the project and a great place to contribute.
:::

## What pinning means here

Swarmbase stores encrypted CRDT change blocks as content-addressed IPFS blocks (via Helia). Under normal operation, peers cache and serve the blocks for documents they've viewed — data spreads with popularity and disappears with disinterest. A *pinning node* opts specific blocks out of that lifecycle: it marks them as pinned in its blockstore so they're always available, even when every other peer is offline. One durable copy is enough for the network to recover a document, and because addresses are content hashes, a restored block is automatically the *right* block.

Pinned blocks are ciphertext. A pinning node stores and serves your data without holding document keys — availability infrastructure doesn't need to be trusted with plaintext.

## What exists today: `CollabswarmNode`

The core package ships a Node.js-side node with automatic pinning logic. It subscribes to the document-publish pubsub topic (`/documents` by default); whenever any peer publishes a document, it opens that document, subscribes to its changes, and pins every CID it sees (`helia.pins.add`, with de-duplication and a concurrency cap). Adapted from the daemon in the repository (`packages/collabswarm-automerge/bin/collabswarm-automerge-d.ts`) to the Yjs backend:

```typescript
// pinning-node.ts — run with Node.js
import { SubtleCrypto, defaultBootstrapConfig } from '@swarmbase/collabswarm';
import { CollabswarmNode, defaultNodeConfig } from '@swarmbase/collabswarm/node';
import {
  YjsProvider,
  YjsJSONSerializer,
  YjsACLProvider,
  YjsKeychainProvider,
} from '@swarmbase/collabswarm-yjs';

const crdt = new YjsProvider();
const serializer = new YjsJSONSerializer();
const auth = new SubtleCrypto();
const acl = new YjsACLProvider();
const keychain = new YjsKeychainProvider();

const keypair = await crypto.subtle.generateKey(
  { name: 'ECDSA', namedCurve: 'P-384' },
  true,
  ['sign', 'verify'],
);

const swarmNode = new CollabswarmNode(
  keypair.privateKey,
  keypair.publicKey,
  crdt,
  serializer,   // ChangesSerializer
  serializer,   // SyncMessageSerializer
  serializer,   // LoadMessageSerializer
  auth,
  acl,
  keychain,
  defaultNodeConfig(
    defaultBootstrapConfig([
      // Your relay, so browsers and this node find each other:
      // '/dns4/relay.example.com/tcp/9001/ws/p2p/<relay-peer-id>',
    ]),
  ),
);

console.log('Starting pinning node...');
await swarmNode.start();
// Logs: "Listening for pinning requests on: /documents"
```

`swarmNode.stop()` unsubscribes the publish handler and document subscriptions.

## How it works

- On `start()`, the node initializes a full Swarmbase peer (Helia + libp2p, same stack as the browser) and subscribes to `config.pubsubDocumentPublishPath` (`/documents`).
- Each publish message names a document; the node calls `swarm.doc(documentId)`, subscribes a `pinning-handler`, opens the document, and pins the CIDs from the announcement and from every subsequent change it observes.
- Pinning is deduplicated (seen-CID set) and throttled (at most 10 concurrent pin operations), so a busy swarm doesn't overwhelm the blockstore.
- Because it's a normal peer, browsers fetch blocks from it over Bitswap like from any other peer — no special client configuration is needed beyond sharing a relay/bootstrap path.

## Honest limitations — help wanted

This is the least-finished part of Swarmbase. Know what you're getting:

- **No packaged pinning service.** There is no Docker image, CLI, or hosted offering for a pinning node today — the `CollabswarmNode` class and the daemon script above are the state of the art. (The relay server image is *not* a pinning node; it forwards messages and stores nothing durably.)
- **No client-side "pin this document" API.** A `documentRef.pin()` call is sketched in the codebase but not currently exposed; pinning is driven by the node observing publish messages, not by explicit client requests.
- **No selective or quota'd pinning.** The node pins everything it hears about on the publish topic, forever. There's no per-document policy, TTL, or storage accounting yet.
- **Generic IPFS pinning services are only a partial substitute.** Services like Pinata or web3.storage can pin the raw blocks, but they can't subscribe to Swarmbase's pubsub or follow new changes — they aren't CRDT-aware. Running a `CollabswarmNode` is what gives you automatic pin-on-publish behavior.
- **Contributions welcome.** Pinning policy, a packaged pinning server, client pin APIs, and storage GC are explicitly on the "make this easier" wishlist — if you need this for production, the maintainers want to hear from you.

## Pitfalls

- **A relay is not a backup.** It's easy to deploy the [relay](../running-a-relay/) and assume durability — the relay only moves messages. If the pinning node is down while all browsers clear storage, the data is gone.
- **The pinning node must be online to observe publishes.** It pins what it *hears*. Documents that were only ever synced while your pinning node was offline are not pinned; bring the node up before you rely on it, and keep it running.
- **Storage grows monotonically.** CRDT history plus pin-everything policy means disk usage only increases. Budget for it and monitor it.
- **Back up the node's blockstore.** Unlike relays (stateless), a pinning node is stateful: its blockstore/datastore *is* your durability story. Snapshot it, and persist its private key if you want a stable peer identity.
