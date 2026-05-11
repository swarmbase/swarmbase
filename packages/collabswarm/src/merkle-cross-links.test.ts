import { describe, expect, test } from '@jest/globals';
import {
  MAX_CROSS_LINKS,
  MAX_RECENT_TIPS,
  mergeRemoteSyncTree,
  selectCrossLinks,
  trackTipInList,
} from './merkle-cross-links';
import {
  CRDTChangeNode,
  CRDTChangeNodeKind,
  crdtDocumentChangeNode,
  crdtWriterChangeNode,
} from './crdt-change-node';

/**
 * Tests for the Merkle-CRDT cross-link selection helpers introduced in
 * GitHub issue #180. These exercise the pure logic that drives the cross-
 * linking emitted from `_makeChange()`:
 *   - which recent tips become cross-link targets, and
 *   - how the bounded recent-tips list evolves under repeated appends.
 *
 * Full end-to-end behavior (a peer that missed a message converging via
 * cross-link, deferred blockstore fetch, etc.) is covered by the existing
 * e2e/integration suite.
 */
describe('Merkle CRDT cross-link selection (paper §VI.B.e)', () => {
  type Tip = { cid: string; kind: CRDTChangeNodeKind };
  const docKind: CRDTChangeNodeKind = crdtDocumentChangeNode;
  const writerKind: CRDTChangeNodeKind = crdtWriterChangeNode;

  test('returns empty list when there are no recent tips', () => {
    expect(selectCrossLinks<Tip>([], 'parent', 'new', MAX_CROSS_LINKS)).toEqual([]);
  });

  test('returns empty list when the only tip is the primary parent', () => {
    // Linear history: the only recent tip *is* the parent, so there's nothing
    // new to cross-link to. This is the no-regression case for linear chains.
    const tips: Tip[] = [{ cid: 'parent', kind: docKind }];
    expect(selectCrossLinks(tips, 'parent', 'new', MAX_CROSS_LINKS)).toEqual([]);
  });

  test('excludes the primary parent from cross-links', () => {
    const tips: Tip[] = [
      { cid: 'a', kind: docKind },
      { cid: 'parent', kind: docKind },
      { cid: 'b', kind: docKind },
    ];
    const result = selectCrossLinks(tips, 'parent', 'new', MAX_CROSS_LINKS);
    expect(result.map((t) => t.cid)).not.toContain('parent');
  });

  test('excludes the new CID itself from cross-links', () => {
    // Defensive: tip-tracking happens after this call in _makeChange, but if
    // a caller invokes with `newCid` already in the tips list, do not link
    // a node to itself.
    const tips: Tip[] = [
      { cid: 'a', kind: docKind },
      { cid: 'new', kind: docKind },
    ];
    const result = selectCrossLinks(tips, 'parent', 'new', MAX_CROSS_LINKS);
    expect(result.map((t) => t.cid)).not.toContain('new');
  });

  test('selects newest tips first (LRU order, back-to-front)', () => {
    // Most-recently-pushed entry is at the END of the list. Selection should
    // start there because newer tips are more likely to be reachable on the
    // peer side.
    const tips: Tip[] = [
      { cid: 'oldest', kind: docKind },
      { cid: 'mid', kind: docKind },
      { cid: 'newest', kind: docKind },
    ];
    const result = selectCrossLinks(tips, 'parent', 'new', 2);
    expect(result.map((t) => t.cid)).toEqual(['newest', 'mid']);
  });

  test('respects the maxCrossLinks cap', () => {
    const tips: Tip[] = [
      { cid: 'a', kind: docKind },
      { cid: 'b', kind: docKind },
      { cid: 'c', kind: docKind },
      { cid: 'd', kind: docKind },
      { cid: 'e', kind: docKind },
    ];
    const result = selectCrossLinks(tips, 'parent', 'new', 3);
    expect(result.length).toBe(3);
  });

  test('returns multiple recent tips when multiple are available', () => {
    // Two concurrent peers; this peer has applied a remote change and is now
    // emitting a local change. Both tips should be cross-linked.
    const tips: Tip[] = [
      { cid: 'parent', kind: docKind },
      { cid: 'remoteTip', kind: docKind },
    ];
    const result = selectCrossLinks(tips, 'parent', 'new', MAX_CROSS_LINKS);
    expect(result.length).toBeGreaterThanOrEqual(1);
    expect(result.map((t) => t.cid)).toContain('remoteTip');
  });

  test('preserves the original kind on each selected tip', () => {
    // ACL nodes (writer/reader kinds) must keep their kind so the receiver
    // routes the deferred-fetch result through the right merge path.
    const tips: Tip[] = [
      { cid: 'aclTip', kind: writerKind },
      { cid: 'docTip', kind: docKind },
    ];
    const result = selectCrossLinks(tips, 'parent', 'new', MAX_CROSS_LINKS);
    const byCid = Object.fromEntries(result.map((t) => [t.cid, t.kind]));
    expect(byCid['aclTip']).toBe(writerKind);
    expect(byCid['docTip']).toBe(docKind);
  });

  test('default cap is MAX_CROSS_LINKS', () => {
    const tips: Tip[] = [
      { cid: 'a', kind: docKind },
      { cid: 'b', kind: docKind },
      { cid: 'c', kind: docKind },
      { cid: 'd', kind: docKind },
      { cid: 'e', kind: docKind },
    ];
    const result = selectCrossLinks(tips, 'parent', 'new');
    expect(result.length).toBe(MAX_CROSS_LINKS);
  });

  test('cap of 0 disables cross-linking entirely', () => {
    const tips: Tip[] = [
      { cid: 'a', kind: docKind },
      { cid: 'b', kind: docKind },
    ];
    expect(selectCrossLinks(tips, 'parent', 'new', 0)).toEqual([]);
  });

  test('no duplicate cids in the returned cross-link list', () => {
    // Even if the input list contains duplicates (shouldn't happen with the
    // tracker but defensive), the output should be unique.
    const tips: Tip[] = [
      { cid: 'a', kind: docKind },
      { cid: 'a', kind: docKind },
      { cid: 'b', kind: docKind },
    ];
    const result = selectCrossLinks(tips, 'parent', 'new', MAX_CROSS_LINKS);
    const cids = result.map((t) => t.cid);
    expect(new Set(cids).size).toBe(cids.length);
  });
});

describe('Merkle CRDT tip-tracking LRU (paper §VI.B.e)', () => {
  type Tip = { cid: string; kind: CRDTChangeNodeKind };
  const docKind: CRDTChangeNodeKind = crdtDocumentChangeNode;

  test('appends new tips to the back', () => {
    const tips: Tip[] = [];
    trackTipInList(tips, { cid: 'a', kind: docKind });
    trackTipInList(tips, { cid: 'b', kind: docKind });
    expect(tips.map((t) => t.cid)).toEqual(['a', 'b']);
  });

  test('evicts oldest tips when exceeding maxRecentTips', () => {
    const tips: Tip[] = [];
    for (const cid of ['a', 'b', 'c', 'd', 'e']) {
      trackTipInList(tips, { cid, kind: docKind }, 3);
    }
    // 'a' and 'b' should have been evicted.
    expect(tips.map((t) => t.cid)).toEqual(['c', 'd', 'e']);
  });

  test('moves an existing cid to the back on re-track (LRU refresh)', () => {
    // Scenario: this peer applies a remote change, then publishes locally,
    // and later receives the SAME remote change again (e.g. via gossip
    // duplication). The second tracking should refresh recency, not
    // accumulate a duplicate.
    const tips: Tip[] = [];
    trackTipInList(tips, { cid: 'a', kind: docKind }, 4);
    trackTipInList(tips, { cid: 'b', kind: docKind }, 4);
    trackTipInList(tips, { cid: 'c', kind: docKind }, 4);
    trackTipInList(tips, { cid: 'a', kind: docKind }, 4);
    expect(tips.map((t) => t.cid)).toEqual(['b', 'c', 'a']);
    expect(tips.length).toBe(3);
  });

  test('default capacity is MAX_RECENT_TIPS', () => {
    const tips: Tip[] = [];
    for (let i = 0; i < MAX_RECENT_TIPS + 2; i++) {
      trackTipInList(tips, { cid: `c${i}`, kind: docKind });
    }
    expect(tips.length).toBe(MAX_RECENT_TIPS);
  });

  test('ignores empty cid (defensive: e.g. before first change)', () => {
    const tips: Tip[] = [{ cid: 'a', kind: docKind }];
    trackTipInList(tips, { cid: '', kind: docKind });
    expect(tips.map((t) => t.cid)).toEqual(['a']);
  });

  test('maxRecentTips of 0 clears the list and skips appending', () => {
    // Defensive: a misconfigured cap of 0 must not loop forever in the
    // eviction `while` loop. The existing entries are dropped and the new
    // entry is also dropped (cap=0 means "track nothing").
    const tips: Tip[] = [{ cid: 'a', kind: docKind }];
    trackTipInList(tips, { cid: 'b', kind: docKind }, 0);
    expect(tips).toEqual([]);
  });

  test('negative maxRecentTips is clamped (no infinite loop)', () => {
    // Defensive: a negative cap is invalid configuration but must not hang.
    // The eviction loop uses `recentTips.length > cap`, which would be
    // permanently true against an empty array if `cap` were negative. The
    // implementation clamps `cap` to >= 0 before entering the loop.
    const tips: Tip[] = [{ cid: 'a', kind: docKind }];
    trackTipInList(tips, { cid: 'b', kind: docKind }, -5);
    expect(tips).toEqual([]);
  });
});

describe('Merkle CRDT cross-link integration scenario', () => {
  type Tip = { cid: string; kind: CRDTChangeNodeKind };
  const docKind: CRDTChangeNodeKind = crdtDocumentChangeNode;

  /**
   * Simulates a concurrent-write scenario:
   *
   *   tA (peer A) --\
   *                  \---> tC (peer A's next change)
   *   tB (peer B) --/
   *
   * Peer A receives B's change `tB` via gossip and tracks it as a tip.
   * Peer A then makes a local change `tC` whose primary parent is `tA`.
   *
   * Without cross-linking, a third peer C that missed `tB`'s broadcast
   * has no way to discover `tB` from `tC`'s sync message. With cross-
   * linking, `tC`'s outgoing message references `tB` as a deferred child,
   * giving peer C a CID to fetch from the blockstore.
   */
  test('cross-link includes a recently-received remote tip', () => {
    const recentTips: Tip[] = [];
    // Peer A makes local change tA.
    trackTipInList(recentTips, { cid: 'tA', kind: docKind });
    // Peer A receives and tracks remote tip tB from peer B.
    trackTipInList(recentTips, { cid: 'tB', kind: docKind });

    // Peer A now publishes tC whose primary parent is tA.
    const crossLinks = selectCrossLinks(recentTips, 'tA', 'tC', MAX_CROSS_LINKS);
    const linkedCids = crossLinks.map((t) => t.cid);

    expect(linkedCids).toContain('tB');
    expect(linkedCids).not.toContain('tA'); // Already the primary parent.
    expect(linkedCids).not.toContain('tC'); // Self-link forbidden.
  });

  test('linear history with single tip emits no cross-links (no regression)', () => {
    // First change after open: there are no other tips besides the parent,
    // so no cross-links can be attached. This is the no-regression case
    // for a fresh document with a single linear history.
    const recentTips: Tip[] = [];
    trackTipInList(recentTips, { cid: 't1', kind: docKind });
    const crossLinks = selectCrossLinks(recentTips, 't1', 't2', MAX_CROSS_LINKS);
    expect(crossLinks).toEqual([]);
  });

  test('linear history with multiple ancestors cross-links to older ancestors', () => {
    // After several linear changes, older ancestors become cross-link
    // candidates. Cross-linking to ancestors (not just concurrent tips) is
    // intentional: a peer that missed an intermediate message can still
    // discover the missing block via the cross-link reference. This is the
    // "improved consistency and availability" property from paper §VI.B.e.
    const recentTips: Tip[] = [];
    trackTipInList(recentTips, { cid: 't1', kind: docKind });
    trackTipInList(recentTips, { cid: 't2', kind: docKind });
    const crossLinks = selectCrossLinks(recentTips, 't2', 't3', MAX_CROSS_LINKS);
    expect(crossLinks.map((t) => t.cid)).toEqual(['t1']);
  });
});

describe('mergeRemoteSyncTree (per-message cross-link dedup)', () => {
  const docKind: CRDTChangeNodeKind = crdtDocumentChangeNode;
  type Node = CRDTChangeNode<string>;

  test('returns empty list for undefined remote root', () => {
    const root: Node = { kind: docKind };
    expect(
      mergeRemoteSyncTree(undefined, root, undefined, new Set()),
    ).toEqual([]);
  });

  test('returns empty list when remote root matches local head', () => {
    const root: Node = { kind: docKind, change: 'payload-A' };
    expect(mergeRemoteSyncTree('A', root, 'A', new Set())).toEqual([]);
  });

  test('skips subtrees whose root CID is already in localHashes', () => {
    // Linear remote tree A -> B (B inline under A). If A is already known
    // locally we should walk no further: B is reachable through A and the
    // local hashes guard short-circuits the whole subtree.
    const root: Node = {
      kind: docKind,
      change: 'payload-A',
      children: { B: { kind: docKind, change: 'payload-B' } },
    };
    const out = mergeRemoteSyncTree('A', root, undefined, new Set(['A']));
    expect(out).toEqual([]);
  });

  test('flattens a linear inline tree into one entry per CID', () => {
    // Remote tree: C --(inline)--> B --(inline)--> A. Receiver knows nothing
    // locally, so all three nodes should be returned with their payloads.
    const tree: Node = {
      kind: docKind,
      change: 'payload-C',
      children: {
        B: {
          kind: docKind,
          change: 'payload-B',
          children: {
            A: { kind: docKind, change: 'payload-A' },
          },
        },
      },
    };
    const out = mergeRemoteSyncTree('C', tree, undefined, new Set());
    const byCid = new Map(out.map(([cid, , change]) => [cid, change]));
    expect(byCid.get('A')).toBe('payload-A');
    expect(byCid.get('B')).toBe('payload-B');
    expect(byCid.get('C')).toBe('payload-C');
    expect(out).toHaveLength(3);
  });

  test('dedupes a cross-link CID that also appears inline in the primary subtree', () => {
    // Reproduces the bug fixed by per-message dedup: a linear history where
    // a later change cross-links to an older ancestor that is also present
    // inline via the primary parent's subtree. Construction mirrors
    // `_makeChange()` after several linear changes:
    //
    //   D = new change
    //     children:
    //       C (primary parent, inline)
    //         children:
    //           B (inline)
    //             children:
    //               A (inline)
    //       A (deferred cross-link leaf -- duplicate of inline A above)
    //
    // Without dedup, the receiver would apply A twice (once via the inline
    // subtree, once via the deferred leaf which would also trigger a
    // blockstore fetch). The merged result must contain A exactly once and
    // must carry the inline payload, not the deferred-leaf undefined.
    const tree: Node = {
      kind: docKind,
      change: 'payload-D',
      children: {
        C: {
          kind: docKind,
          change: 'payload-C',
          children: {
            B: {
              kind: docKind,
              change: 'payload-B',
              children: {
                A: { kind: docKind, change: 'payload-A' },
              },
            },
          },
        },
        // Deferred cross-link leaf pointing at an inline ancestor (A).
        A: { kind: docKind },
      },
    };
    const out = mergeRemoteSyncTree('D', tree, undefined, new Set());

    // Exactly one entry per distinct CID.
    const cids = out.map(([cid]) => cid).sort();
    expect(cids).toEqual(['A', 'B', 'C', 'D']);

    // A must carry the inline payload, not the deferred-leaf undefined.
    const aEntry = out.find(([cid]) => cid === 'A')!;
    expect(aEntry[2]).toBe('payload-A');
  });

  test('prefers inline payload over deferred leaf regardless of traversal order', () => {
    // Defensive: even if a remote constructs the message with the deferred
    // cross-link leaf positioned BEFORE the inline subtree (e.g. a future
    // serializer changes key ordering), the inline payload should still win.
    //
    // We can't directly control Object.entries ordering across engines, but
    // we can verify the merge respects insertion order of the source object:
    // inserting the deferred leaf first, then the inline subtree.
    const tree: Node = {
      kind: docKind,
      change: 'payload-D',
      children: {},
    };
    // Insertion order: A (deferred) first, then C (inline subtree).
    (tree.children as Record<string, Node>)['A'] = { kind: docKind };
    (tree.children as Record<string, Node>)['C'] = {
      kind: docKind,
      change: 'payload-C',
      children: { A: { kind: docKind, change: 'payload-A' } },
    };
    const out = mergeRemoteSyncTree('D', tree, undefined, new Set());
    const aEntry = out.find(([cid]) => cid === 'A')!;
    // Even though the deferred leaf came first, the inline payload wins.
    expect(aEntry[2]).toBe('payload-A');
    // Still exactly one A entry.
    expect(out.filter(([cid]) => cid === 'A')).toHaveLength(1);
  });

  test('cross-link leaf to a CID not in primary subtree is preserved as deferred', () => {
    // No duplication: a cross-link to a tip that isn't in the inline subtree
    // remains a deferred leaf so the receiver can fetch it from the
    // blockstore. This is the normal cross-link case (paper §VI.B.e).
    const tree: Node = {
      kind: docKind,
      change: 'payload-D',
      children: {
        C: { kind: docKind, change: 'payload-C' },
        X: { kind: docKind }, // deferred cross-link to an unknown CID
      },
    };
    const out = mergeRemoteSyncTree('D', tree, undefined, new Set());
    const xEntry = out.find(([cid]) => cid === 'X')!;
    expect(xEntry).toBeDefined();
    expect(xEntry[2]).toBeUndefined();
  });
});

describe('Merkle CRDT recent-tip tracking from a remote sync tree', () => {
  type Tip = { cid: string; kind: CRDTChangeNodeKind };
  const docKind: CRDTChangeNodeKind = crdtDocumentChangeNode;
  type Node = CRDTChangeNode<string>;

  /**
   * Regression test for the ordering bug noted on PR #259:
   * `mergeRemoteSyncTree` emits entries in root-first traversal order (the
   * remote head first, then its ancestors). `_syncDocumentChanges` tracks
   * each entry as a recent tip via the LRU `trackTipInList` helper, which
   * appends to the BACK of the list (most-recent-last).
   *
   * If we naively iterate the merged entries front-to-back, the remote head
   * (the truly most-recent tip) is the FIRST thing pushed and ends up at the
   * FRONT of `_recentTips` -- the oldest position. When more than
   * `MAX_RECENT_TIPS` new entries arrive in a single sync (e.g. a long chain
   * with cross-links that brings in many ancestors at once), the eviction
   * loop drops the head first, defeating the whole point of cross-linking.
   *
   * The fix iterates the merged entries in reverse before pushing them into
   * `_recentTips`, so the remote head ends up at the back (most-recent) and
   * older ancestors are evicted first when the cap is exceeded.
   */
  test('reverse-iterating mergeRemoteSyncTree output keeps the remote head as the most-recent tip', () => {
    // Build a long linear remote tree H -> A1 -> A2 -> ... -> An, with H as
    // the remote head and An as the deepest ancestor. Use a chain length of
    // MAX_RECENT_TIPS + 3 so the front-to-back order would evict the head.
    const chainLen = MAX_RECENT_TIPS + 3;
    const cids = ['H', ...Array.from({ length: chainLen - 1 }, (_, i) => `A${i + 1}`)];
    // Construct nested children: H.children = { A1: { children: { A2: ... }}}
    let inner: Node | undefined;
    for (let i = cids.length - 1; i >= 0; i--) {
      const node: Node = { kind: docKind, change: `payload-${cids[i]}` };
      if (inner) {
        node.children = { [cids[i + 1]!]: inner };
      }
      inner = node;
    }
    const tree = inner!;

    const merged = mergeRemoteSyncTree('H', tree, undefined, new Set());

    // Sanity: traversal is root-first (head H is the first entry).
    expect(merged[0]![0]).toBe('H');
    expect(merged.length).toBe(chainLen);

    // Simulate _syncDocumentChanges: track each entry as a recent tip,
    // iterating in REVERSE so the head ends up most-recent. This mirrors the
    // production code path.
    const recentTips: Tip[] = [];
    for (let i = merged.length - 1; i >= 0; i--) {
      const [cid, kind] = merged[i]!;
      trackTipInList(recentTips, { cid, kind });
    }

    // The recent-tips list is capped at MAX_RECENT_TIPS, and the remote head
    // 'H' must be preserved at the back (most-recent slot).
    expect(recentTips.length).toBe(MAX_RECENT_TIPS);
    expect(recentTips[recentTips.length - 1]!.cid).toBe('H');

    // Sanity counter-check: the naive front-to-back order would have lost H.
    const naive: Tip[] = [];
    for (const [cid, kind] of merged) {
      trackTipInList(naive, { cid, kind });
    }
    expect(naive.map((t) => t.cid)).not.toContain('H');
  });
});
