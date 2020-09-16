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

Goals:

- ACLs
  - Users identified by their private key
  - Able to grant/deny read access to specific private keys
  - Able to grant/deny write access to specific private keys
  - Able to modify permissions without having to re-encrypt data (is this possible?)

How to protect/verify writes:
- Sign change messages with your private key before sending to peers.
- Peers decode incoming messages and check against ACL before accepting.
  - Need to verify all previous messages as well or maybe just the ones that contain ACL modifications (this is a chain of trust)
  - Sign something that comes from the previous message and then verify the entire chain (like DAT)
  - How many bad nodes are required before the ACL can be subverted (by spoofing )
  - Have to verify the acl content + user's pub key as well... perhaps the acl should just contain public keys?

How to decrypt/read data:
- Initial read needs to be hardened against "fake data"
  - Quorum protocol? What should the condition be?
- Key per document
  - Re-roll key on read-ACL change
  - Re-distribute new key to new readers on read-ACL change
  - How to distribute these keys safely?
    - What happens if a node "goes bad"? They could forward these keys to anyone.
    - What happens if someone tries to lock everyone else out and distribute new bogus keys?
