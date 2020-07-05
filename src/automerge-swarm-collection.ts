// Support:
// - Indexes on documents
//   - Subscribe to publish topic. Maintain a shared map (using automerge) which maintains index reverse lookup.
//   - In the future, add a query protocol that allows the index to be sharded in case of it being large. Consider having this use a LRU style index, but then need a way to handle "missing" parts of the index.
// - Permissions/ACLs on collections
// - Lookup of document by id (implicitly supported, since collections would be a bolt-on to documents?)
