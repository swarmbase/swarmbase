export const bloomFilterUpdateV1 = '/collabswarm/bloom-index/1.0.0';

// V2 doc-load, key-update, and snapshot-load handlers use a shared handler
// model where a single handler serves all documents. The key-update wire
// format prepends a length-prefixed document-path header so the shared
// handler can route requests to the correct document.
export const documentLoadV2 = '/collabswarm/doc-load/2.0.0';
export const documentKeyUpdateV2 = '/collabswarm/key-update/2.0.0';
export const snapshotLoadV2 = '/collabswarm/snapshot-load/2.0.0';

// BeeKEM Welcome v1: onboards a new reader/writer into a document. The
// inviting writer sends a Welcome containing (a) the invitation epoch ID
// the recipient should record so subsequent `since_invited` history
// filtering works, and (b) the keychain changes filtered per the
// document's `HistoryVisibility` setting -- so the new member can decrypt
// (at least) the current document state. The payload uses the same shared
// length-prefixed-document-path header as the V2 key-update protocol so
// the shared handler can route incoming Welcomes to the correct document.
export const beekemWelcomeV1 = '/collabswarm/beekem-welcome/1.0.0';
