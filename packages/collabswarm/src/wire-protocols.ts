// Legacy V1 protocol identifiers. These constants are retained for
// reference and documentation only; V1 per-document handler registration
// has been removed and these IDs are no longer actively handled.
export const documentLoadV1 = '/collabswarm/doc-load/1.0.0';
export const documentKeyUpdateV1 = '/collabswarm/key-update/1.0.0';
export const bloomFilterUpdateV1 = '/collabswarm/bloom-index/1.0.0';
export const snapshotLoadV1 = '/collabswarm/snapshot-load/1.0.0';

// V2 protocol IDs use a shared handler model where a single handler serves
// all documents. For doc-load and snapshot-load, the document path is
// extracted by deserializing the CRDTLoadRequest from the stream data. For
// key-update, a 4-byte length-prefixed document-path header precedes the
// encrypted payload for shared routing.
export const documentLoadV2 = '/collabswarm/doc-load/2.0.0';
export const documentKeyUpdateV2 = '/collabswarm/key-update/2.0.0';
export const snapshotLoadV2 = '/collabswarm/snapshot-load/2.0.0';
