export type CRDTChangeNodeDeferred = false;
export const crdtChangeNodeDeferred: CRDTChangeNodeDeferred = false;

export type CRDTDocumentChangeNode = 'document';
export const crdtDocumentChangeNode: CRDTDocumentChangeNode = 'document';
export type CRDTWriterChangeNode = 'writer';
export const crdtWriterChangeNode: CRDTWriterChangeNode = 'writer';
export type CRDTReaderChangeNode = 'reader';
export const crdtReaderChangeNode: CRDTReaderChangeNode = 'reader';
export type CRDTChangeNodeKind = CRDTDocumentChangeNode | CRDTWriterChangeNode | CRDTReaderChangeNode;

/**
 * A CRDT Change node represents a shadow copy of a Merkle DAG that is sent over sync messages.
 *
 * @tparam ChangesType A block of CRDT change(s).
 */
export type CRDTChangeNode<ChangesType> = {
  // TODO: Add identifier for document key that should be used to decrypt (or just prepend it to the Uint8Array).

  kind: CRDTChangeNodeKind;

  /**
   * Changes made to the document itself (if any).
   * 
   * `false` means that the changes should be fetched from IPFS blockstore.
   */
  change?: ChangesType;

  /**
   * Child nodes of the current node keyed on its CID.
   * 
   * `undefined` means that this node is a leaf node (equivalent to `[]`).
   */
  children?:
    | { [hash: string]: CRDTChangeNode<ChangesType> }
    | CRDTChangeNodeDeferred;
};
