export const bloomFilterUpdateV1 = '/collabswarm/bloom-index/1.0.0';

// V2 doc-load, key-update, and snapshot-load handlers use a shared handler
// model where a single handler serves all documents. The key-update wire
// format prepends a length-prefixed document-path header so the shared
// handler can route requests to the correct document.
export const documentLoadV2 = '/collabswarm/doc-load/2.0.0';
export const documentKeyUpdateV2 = '/collabswarm/key-update/2.0.0';
export const snapshotLoadV2 = '/collabswarm/snapshot-load/2.0.0';
