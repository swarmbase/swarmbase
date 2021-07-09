# SwarmDB

(name change in process; for future reference please use: https://swarmdb.dev/ which we will keep up to date even if the repo name changes)

## What is SwarmDB?

An encrypted, eventually consistent object real-time application database with dynamic access control using the distributed web as a storage layer. Then intent is to make it easy to start with a secure, private, local database, and scale as needed in a performant manner without the requirement of adding or moving to a centrally managed database.

Benefits of this approach:

- Easy to start with a small number of locally-connected nodes
- Can handle offline clients or limited internet connectivity
- Reduced reliance on central web providers, and therefore also costs

Several recent technologies make this possible now, including JSON CRDTs, libp2p, ipfs, and efficient distributed pub-sub algorithms. They are early and documentation and interfaces may change.

## Latest Release

In active alpha development. Working on: dynamic access control, document encrypting, basic working example(s), auto-gen docs, testing

## Docs

Will be generated based on code comments, so that they are more likely to be current and we are encouraged to provide more detail.

## Situations where SwarmDB works well

- Projects built for local use or a small number of individuals such as syncing a to-list in a small family
- Projects where groups work with limited internet connectivity

## Situations where another choice may work better:

- All nodes are connected in real-time and require real-time consistency: this database is eventually consistent, which shines in asynchronously updating environments
- Database is very large with high transaction rate: not yet battle-tested
- Production requirement with high uptime requirements: not yet battle-tested

Implementing collaborative real-time applications can be very difficult and error prone.

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

Currently the transport for browser-browser communication is libp2p-js-web-rtc-star. This protocol requires the usage of
a centralized signaling server and/or a relay (non-browser) node if the twobrowsers connecting can't communicate due to NAT translation or firewall
problems.
These libp2p mechanisms fill a role similar to WebRTC's TURN and STUN
protocols/services.

# Reference

## CRDTs

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
They have created a content-based addressing sytem, IPFS, a networking layer for finding and connecting to peers,
and a messaging system [GossipSub](https://github.com/libp2p/specs/tree/master/pubsub/gossipsub), this message exchange
should scale well beyond naiive broadcast/flood based solutions. These changes are also cached on individual nodes using IPFS for initial document load and error

In this world, when a node loads data, it then caches it for peers seeking that same data. The data is not pushed, so that only viewed data will be cached, and non-popular content will not propogate. If all peers stop hosting content, it can disappear. This brings up the need for a new service called pinning where a central server will host (one) copy of the data (version) so that it is always available. Since one copy will suffice for existence, and content-addressing means the address does not need to be maintained, combined with the fact that the address is the data and version, things like archival storage and version control should become much simpler.

Basic questions and misconceptions about IPFS: https://voussoir.net/writing/ipfs_misconceptions
