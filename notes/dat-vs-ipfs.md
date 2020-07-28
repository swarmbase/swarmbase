# DAT vs IPFS

There are two major platforms(?) in the distributed web space:

* [DAT Project](https://datprotocol.github.io/how-dat-works/)
* [IPFS](https://docs.ipfs.io/concepts/how-ipfs-works/)

The DAT Project was conceived for the purpose of sharing scientific datasets over the web

## DAT Pros

* DAT project handles verification of edits to files (was built to deal with mutable files)
* Hypermerge already exists (automerge + hyperswarm = automerge kv document store.)

## IPFS Pros

* IPFS has "built-in" write protection since it is actually a Content-Addressable-Store
* IPFS has more widespread usage
* IPFS is built upon libp2p which allows for custom protocols to be easily added
* libp2p implements gossip-sub which makes pub-sub much more efficient
* IPFS has decent browser support
