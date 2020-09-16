One way to look at the problem of data replication is to look for a set of rules that naturally settles
into a nash equilibrium where network participants are incentivized to offer up computing time, storage
space, and network bandwidth to the network for other user's data. This likely requires a way to ensure
that work was done (something similiar to bitcoin's proof-of-work or the various proofs used in
filecoin such as proof-of-storage)

Regardless of the incentives used, selective replication of data units (in this case: CRDT documents)
such as using a replication factor R requiring that at minimum R copies of each data unit exists
on the network can ensure both storage and access to all data is maintained.
