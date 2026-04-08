/**
 * Blockstore garbage collection helpers for compaction.
 *
 * After compaction prunes the in-memory sync tree, these helpers identify
 * unreferenced blocks that can be deleted from the Helia blockstore.
 */

import {
  CRDTChangeNode,
  crdtChangeNodeDeferred,
} from './crdt-change-node';

/**
 * Walk a CRDTChangeNode tree (BFS) and collect the CID strings of every
 * node reachable from the root, including the root itself.
 *
 * @param rootCID  CID string of the root node.
 * @param root     The root CRDTChangeNode.
 * @returns Set of CID strings present in the tree.
 */
export function collectTreeCIDs<ChangesType>(
  rootCID: string,
  root: CRDTChangeNode<ChangesType>,
): Set<string> {
  const cids = new Set<string>();
  cids.add(rootCID);

  const queue: Array<CRDTChangeNode<ChangesType>> = [root];
  let qi = 0;

  while (qi < queue.length) {
    const current = queue[qi++]!;
    if (
      current.children !== undefined &&
      current.children !== crdtChangeNodeDeferred
    ) {
      for (const [childCID, childNode] of Object.entries(current.children)) {
        cids.add(childCID);
        queue.push(childNode);
      }
    }
  }

  return cids;
}
