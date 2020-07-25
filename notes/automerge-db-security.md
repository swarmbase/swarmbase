# automerge-db security

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

Options:

- Re-implement without IPFS and using bare libp2p to inject access control to nodes.
- Implement using some sort of IPFS filter.
