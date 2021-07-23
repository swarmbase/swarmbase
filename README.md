# SwarmDB

(for bookmarking please use: https://swarmdb.dev which we will keep up to date even if the repo name changes)

## What is SwarmDB?

SwarmDB is an open-source JavaScript language library that implements a distributed web (dweb) document database with dynamic access control and encryption, providing conflict-free strong eventual consistency, able to run in the browser.

Designed as a dweb database means SwarmDB will work with data distributed over many nodes with varying connectivity, allow asynchronous updates without conflict, and be able to operate on untrusted networks or with the assistance of unknown or untrusted peers. It does not require centralized servers or a private intranet.

SwarmDB source code is in the public domain and free for anyone to use for commercial or private use.

### Goals and benefits: Method of implementation

- No conflict (asynchronous) editing with eventual consistency means a good user experience and ability to scale: store document as Conflict-free Resolution Data Type objects, specifically Yjs which is the most performant (https://github.com/dmonad/crdt-benchmarks)
- No server backend means easy start and scaling: use libp2p for peer discovery and connection, and IPFS and Merkle-DAG structure for object storage and comparison \*
- Dynamic access control for both read and write permissions allows a changing group to use documents or collections: readers can confirm change messages were sent by authorized writers, writers can add or remove readers or writers, keys are changed whenever a permission is removed \*\*
- Local-first write/read of content provides responsive user experience: local copy is updated, then opportunistically sync to other clients\*\*\*
- Data privacy using untrusted nodes and public content location tables (DHT) allows building on powerful dweb technologies like IPFS: use document encryption with access control lists and smart key management

\* The peer discovery and content transport layer uses libp2p which uses several techniques to get around the NAT/Firewall problem (https://docs.libp2p.io/concepts/nat/) - only as a last-attempt fallback option is a a peer relay server used.

\*\* Use a separate, secure path to share the new key. For example, an end-to-end encrypted message app like Signal.

\*\*\* "Live collaboration between computers without Internet access feels like magic in a world that has come to depend on centralized APIs." [ - Local-First Software, Kleppmann et. al](https://martin.kleppmann.com/papers/local-first.pdf)

## Q & A:

- Why not use the libp2p peer id for the access control lists?
  - This id is not permanent and can change, for example if the computer is restarted. So we use a more permament key pair tied to the user.
- What if one peer updates a document when no other peer is online to receive the change?
  - The document will sync as peers become available. If time passes and other peers make changes, and these changes are in the same location, and they contradict or duplicate other changes, that area of the document could be re-edited. Using CRDTs as a data type means there should not be document conflicts or permanent data loss.

## Latest Release

In active alpha development! Dweb databases are a new concept and at this point we hope to release something good enough for use, to explore use cases and better understand pros and cons. Your help or support here is greatly appreciated and we hope SwarmDB can be useful for the greater distributed community. That said, it would not be appropriate just yet for production or heavy usage.

Working on: dynamic access control, document encrypting, basic tutorial and working example(s), setting up auto-gen docs, nailing the core API, more testing

Future work: benchmarking, more testing, make sure we are interacting well and responsively with users and contributors

Far future maybes: tools to make various things simpler like pinning, more language support like golang

Development philosophy: we intend to prioritize improving performance, reliability, security, etc., over things like adding new features or languages.

## Docs

Will be generated based on code comments, so that they are more likely to be current and we are encouraged to provide more detail.

## Situations where SwarmDB may work well

- For implementing collaborative real-time applications which can be very difficult and error prone
- Applications that want that local-first responsiveness at the point of user interaction
- Projects built for local use or a small number of individuals such as syncing a to-list in a small family
- Projects where users encounter limited or poor internet connectivity

## Situations where another choice may work better:

- All nodes are connected in real-time and global real-time consistency is required - dweb is asynchronous by nature
- Database is very large with high transaction rate - not yet battle-tested
- Production requirement with high uptime requirements - not yet battle-tested

## Local Development

Yarn workspaces link multiple npm packages together and ensure that dependency
versions match between packages.

To build collabswarm-automerge (plus its packages):

```
yarn install
```

There is also a docker-compose.yaml file provided that runs browser-test and wiki-swarm examples by default:

```sh
docker-compose build
docker-compose up
```

## Known Limitations

- Please be aware that data loss can occur if all clients lose local storage, for example exit browser, and remote pinning service is not set up. This is something we hope to address and make easier in the future, but at this early moment it's similar to venture investing where they say: only put in what you can afford to lose. Open to comments or requests in this area.
  - Relevant: [ipfs/js-ipfs#2937](https://github.com/ipfs/js-ipfs/issues/2937)
- Currently the transport for browser-browser communication is libp2p-js-web-rtc-star. This protocol requires the usage of
  a centralized signaling server and/or a relay (non-browser) node if the two browsers connecting can't communicate due to NAT translation or firewall
  problems. These libp2p mechanisms fill a role similar to WebRTC's TURN and STUN
  protocols/services.
  - Explanation of the plan for the removal of this: [libp2p/js-libp2p#385](https://github.com/libp2p/js-libp2p/issues/385)

## Why SwarmDB?

The inspiration was to make it easy to build local-first applications. Working on a side project, we discovered there was great complexity to attempt to use the dweb for an application.

IPFS was being used for many public data sharing projects, but to build an application we needed private data and there did not seem to be a database that would allow access control and encrypt files in the way we wanted. As we looked into it we discovered there were many different optimizations and structure appropriate for the dweb and decided to write SwarmDB.

# Reference

Several recent technologies make this possible now, including JSON CRDTs, the [libp2p networking stack](https://libp2p.io/), the [Interplanetary File System](https://ipfs.io/), and efficient distributed pub-sub algorithms. They are early and documentation and interfaces may change.

## CRDTs

Conflict-Free Replicated Data Types (CRDTs) obtain eventual consistency in a distributed system in non-adversarial scenarios. Operation-based CRDTs apply commutative operations locally to the state of each node. No consensus mechanism is required, which are usually complex and expensive.

CRDTs provide a simple way to allow multiple clients to make changes simultaneously without risking a "split-brain" state
where clients do not share the same state eventually. In short, CRDTs provide collabswarm documents with the property of
eventual-consistency.

This is a good introduction with examples for a technical reader: https://www.serverless.com/blog/crdt-explained-supercharge-serverless-at-edge/

### CRDT Performance

Performance of CRDTs can be an issue depending on the
[implementation](https://github.com/dmonad/crdt-benchmarks). Generally, performance becomes worse
as the document's history of changes grows.

In the future, some sort of compaction mechanism could be added as an optional feature. Changes
could be compacted by truncating the history after a specific number of events or something more
advanced such as compacting events into increasing time or change-count intervals.

## Distributed Web

Peer to peer networks have come a long way since Napster and recently a great amount of work has been done by Protocol Labs.
They have created a content-based addressing system, IPFS, a networking layer for finding and connecting to peers,
and a messaging system [GossipSub](https://github.com/libp2p/specs/tree/master/pubsub/gossipsub), this message exchange
should scale well beyond naive broadcast/flood based solutions. These changes are also cached on individual nodes using IPFS for initial document load and error

In this world, when a node loads data, it then caches it for peers seeking that same data. The data is not pushed, so that only viewed data will be cached, and non-popular content will not propagate. If all peers stop hosting content, it can disappear. This brings up the need for a new service called pinning where a central server will host (one) copy of the data (version) so that it is always available. Since one copy will suffice for existence, and content-addressing means the address does not need to be maintained, combined with the fact that the address is the data and version, things like archival storage and version control should become much simpler.

Basic questions and misconceptions about IPFS: https://voussoir.net/writing/ipfs_misconceptions
