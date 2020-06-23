# `automerge-db`/`collab-swarm`/`automerge-swarm`/`y.js-swarm`

A fully decentralized (eventually) json document store backed by CRDTs.

## Pitch

- Spike-proof google-docs-like store. (Scales super well).
  - Ideally supports the public editable google doc use-case (100k-1M simultaneous users per doc)
- CRDTs backed json (automerge's pitch really).
- Soon-to-be fully decentralized peer connections
  - Currently centralized components are:
    - Browser signaling server
    - p2p-circuit relay nodes (not really centralized, just not good for cost scaling with the way they get used)
  - <https://github.com/ipfs/go-ipfs/issues/7433>
  - <https://github.com/libp2p/js-libp2p/issues/385>
- Plugged into state stores already
  - redux
  - react hook
  - angular service
- Super-cheap hosted node offerings (actual price depends on scaling of signaling-server/circuit-relay over ipfs nodes)
  - Pinning service (shared node joins room).
    - Can only be encryption if there isn't a way to have access-control work on pubsub/ipfs
  - Dedicated node
    - Also includes private bootstrapping nodes with swarm key
- On-premise offerings
  - Run your own node?
  - Node could be proprietary software? Not in the spirit of IPFS... Also not hard to replicate missing behavior.

## Future

- Integration between ipfs files and state stores.
- Add Y.js support as an alternative to automerge. Build an interface that allows swapping out the crdt engine.
- React/UI support
  - Rich text editors
  - Forms (make this very plug-n-play with common libraries)

## Questions

- How do you handle a user joining without them missing updates?
  - Joining users can connect to the pubsub room and request current.
  - Store all updates on IPFS and include messages hashes in updates. Implementation options:
    - *When joining, ask a random peer for their message list. Can use IPFS pubsub for now (message with a specific peer's id). or: <https://stackoverflow.com/questions/53467489/ipfs-how-to-send-message-from-a-peer-to-another>
    - Distributed heartbeat with latest messages
    - Have existing swarm listen for peer joining and have one or many nodes send their full document hash list
  - Fetch missing updates when updates are received. Union resulting hashes.
- How do you handle security?
  - IPFS/libp2p layers. Research needed. Looks like a "swarm-key" can be used that will protect the network:
    <https://discuss.ipfs.io/t/can-i-make-a-private-ipfs-network-of-public-external-ips-this-would-require-my-own-gateway-as-well/5509>
  - Protecting the pub-sub layer. Research needed.
  - Permissions within pub-sub? Can this be done with
- Security types:
  - Encryption
    - <https://blog.textile.io/the-5-steps-to-end-to-end-encrypted-photo-storage-and-sharing/>
    - <https://blog.textile.io/introducing-textiles-threads-protocol/>
  - Access Control
    - <https://github.com/ipfs/notes/issues/376>
    - <https://discuss.ipfs.io/t/can-i-make-a-private-ipfs-network-of-public-external-ips-this-would-require-my-own-gateway-as-well/5509>

## TODO

- Write up a userguide.
  - Concepts (lots of links to automerge/Y.js/IPFS/libp2p)
- Write up simple examples.
  - React TODO app.
  - QuillJS-based google docs clone.
  - Tabulator-based google sheets clone.
  - Security/ACL example.
- Write up API documentation.
- Build the police-brutality planning team-space using this then separate out the library.

## Architecture

- Gossip protocol
  - *IPFS pubsub
  - Custom libp2p solution
  - Custom webRTC solution
- Document storage
  - *IPFS files
    - Each node pins the latest version of each subscribed document
    - Send the current hash with each message.
- Message storage

## Notes

- Scaling of pubsub: <https://github.com/libp2p/notes/blob/master/OPEN_PROBLEMS/PUBSUB_AT_SCALE.md>
