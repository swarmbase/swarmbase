export const documentLoadV1 = '/collabswarm/doc-load/1.0.0';
export const documentKeyUpdateV1 = '/collabswarm/key-update/1.0.0';
export const bloomFilterUpdateV1 = '/collabswarm/bloom-index/1.0.0';
export const snapshotLoadV1 = '/collabswarm/snapshot-load/1.0.0';

// V2 protocol IDs use a shared handler model where a single handler serves
// all documents; V1 protocol IDs register per-document handlers (protocol
// ID is suffixed with the document path). For doc-load and snapshot-load,
// V1 and V2 share the same request wire format; the version bump only
// signals that the handler is shared across all documents. For key-update,
// V2 prepends a length-prefixed document-path header for shared routing.
export const documentLoadV2 = '/collabswarm/doc-load/2.0.0';
export const documentKeyUpdateV2 = '/collabswarm/key-update/2.0.0';
export const snapshotLoadV2 = '/collabswarm/snapshot-load/2.0.0';
