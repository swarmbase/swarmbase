export type CRDTChangeNodeDeferred = false;
export const crdtChangeNodeDeferred: CRDTChangeNodeDeferred = false;

/**
 * A CRDT Change node represents a shadow copy of a Merkle DAG that is sent over sync messages.
 *
 * @tparam ChangesType A block of CRDT change(s).
 */
export type CRDTChangeNode<ChangesType> = {
  // `undefined` changes means that the changes should be fetched from IPFS blockstore.
  change?: ChangesType;

  // `undefined` means that this node is a leaf node (equivalent to `[]`).
  children?:
    | { [hash: string]: CRDTChangeNode<ChangesType> }
    | CRDTChangeNodeDeferred;
};
