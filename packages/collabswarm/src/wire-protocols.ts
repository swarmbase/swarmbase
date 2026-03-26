export const documentLoadV1 = '/collabswarm/doc-load/1.0.0';
export const documentKeyUpdateV1 = '/collabswarm/key-update/1.0.0';
export const bloomFilterUpdateV1 = '/collabswarm/bloom-index/1.0.0';
export const snapshotLoadV1 = '/collabswarm/snapshot-load/1.0.0';

// V2 protocol IDs use a shared handler model where the document path is
// included in the stream payload. V1 protocol IDs registered per-document
// handlers. Both versions use the same wire format; the version bump signals
// that the handler is shared across all documents.
export const documentLoadV2 = '/collabswarm/doc-load/2.0.0';
export const documentKeyUpdateV2 = '/collabswarm/key-update/2.0.0';
export const snapshotLoadV2 = '/collabswarm/snapshot-load/2.0.0';
