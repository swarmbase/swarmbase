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
 * Nodes whose children are deferred (`crdtChangeNodeDeferred`) are included
 * in the result, but their descendants are not traversed and are therefore
 * excluded from the returned set.
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

/**
 * Compute the set of CIDs that are safe to delete from the Helia blockstore
 * after pruning.
 *
 * A CID is safe to delete only if it is in the `candidates` set AND it is
 * NOT still reachable from the current in-memory sync tree (since a
 * post-prune sync tree may re-attach ACL nodes that were inside a pruned
 * subtree) AND it is not the snapshot boundary CID (which peers may still
 * request to verify their position in history).
 *
 * @param candidates       CIDs reported as pruned by `_pruneChanges()`.
 * @param retainedRootCID  CID of the root of the post-prune sync tree (or
 *   `undefined` when no sync tree exists yet).
 * @param retainedRoot     Root of the post-prune sync tree (or `undefined`).
 * @param protectedCIDs    Extra CIDs to protect (e.g. snapshot boundary CID,
 *   pinned blocks).
 * @returns Subset of `candidates` that are safe to delete.
 */
export function filterDeletableCIDs<ChangesType>(
  candidates: Iterable<string>,
  retainedRootCID: string | undefined,
  retainedRoot: CRDTChangeNode<ChangesType> | undefined,
  protectedCIDs: Iterable<string> = [],
): Set<string> {
  const reachable =
    retainedRootCID && retainedRoot
      ? collectTreeCIDs(retainedRootCID, retainedRoot)
      : new Set<string>();
  const protectedSet = new Set(protectedCIDs);
  const out = new Set<string>();
  for (const cid of candidates) {
    if (reachable.has(cid)) continue;
    if (protectedSet.has(cid)) continue;
    out.add(cid);
  }
  return out;
}
