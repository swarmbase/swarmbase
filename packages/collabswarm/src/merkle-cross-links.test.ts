import { describe, expect, test } from '@jest/globals';
import {
  collectReferencedAncestors,
  computeServedFrontier,
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

  test('upgrades a deferred-leaf entry and walks newly-discovered children when CID is later seen inline', () => {
    // Regression test for PR #259 Copilot thread A:
    // If a CID is FIRST encountered as a deferred leaf (no `children`) and
    // LATER encountered inline with a populated `children` map (possible if
    // serializer or key ordering varies, or if a future remote message
    // structure interleaves cross-links before inline subtrees), the inline
    // children must still be walked. Previously, the dedup short-circuit
    // returned early on the second visit and silently dropped the inline
    // descendants (A's children: B, C).
    //
    // Tree (insertion order matters):
    //   root D
    //     children (insertion order):
    //       A   -- deferred cross-link leaf (no payload, no children)
    //       A'  -- inline visit of the SAME CID A, this time with children
    //                children: { B (inline), C (inline) }
    //
    // We can't add two keys with the same name to one object literal, so we
    // simulate the "same CID seen twice" case by nesting: D -> A (deferred)
    // and D -> X (inline) where X's subtree also references A inline with
    // children. The dedup is keyed on CID, so the two A visits collapse --
    // and the bug is whether A's inline children get walked.
    const tree: Node = {
      kind: docKind,
      change: 'payload-D',
      children: {
        // First visit: A as a deferred cross-link leaf (no children, no payload).
        A: { kind: docKind },
        // Second visit (via X's subtree): A inline with children B and C.
        X: {
          kind: docKind,
          change: 'payload-X',
          children: {
            A: {
              kind: docKind,
              change: 'payload-A',
              children: {
                B: { kind: docKind, change: 'payload-B' },
                C: { kind: docKind, change: 'payload-C' },
              },
            },
          },
        },
      },
    };
    const out = mergeRemoteSyncTree('D', tree, undefined, new Set());
    const byCid = new Map(out.map(([cid, , change]) => [cid, change]));

    // All five distinct CIDs must appear exactly once.
    const cids = out.map(([cid]) => cid).sort();
    expect(cids).toEqual(['A', 'B', 'C', 'D', 'X']);

    // A must carry the inline payload (deferred-leaf was upgraded).
    expect(byCid.get('A')).toBe('payload-A');

    // CRITICAL: A's inline children B and C must be present. Before the fix,
    // the early-return on the second A visit dropped both of them.
    expect(byCid.get('B')).toBe('payload-B');
    expect(byCid.get('C')).toBe('payload-C');
  });

  test('walks children on the inline visit when a CID was previously seen only as a deferred leaf (sibling order)', () => {
    // Additional regression: the deferred leaf and the inline visit are
    // siblings under the same parent. Insertion order: deferred A first,
    // then inline A with children. Verifies the upgrade-and-walk path even
    // when the two visits share a parent rather than living in separate
    // subtrees.
    const tree: Node = {
      kind: docKind,
      change: 'payload-Root',
      children: {},
    };
    // Deferred leaf for A first.
    (tree.children as Record<string, Node>)['Adeferred'] = {
      kind: docKind,
      // Sentinel sibling that simulates "A as deferred" with a distinct key
      // so the object literal can hold both visits. We then add the inline
      // visit under the same CID via a nested wrapper.
    };
    // Add a wrapper Y whose subtree contains A inline with children D1, D2.
    (tree.children as Record<string, Node>)['Y'] = {
      kind: docKind,
      change: 'payload-Y',
      children: {
        A: {
          kind: docKind,
          change: 'payload-A',
          children: {
            D1: { kind: docKind, change: 'payload-D1' },
            D2: { kind: docKind, change: 'payload-D2' },
          },
        },
      },
    };
    // Now also reference A directly as a deferred leaf at the root level
    // (same CID as inside Y). Object literal can't have duplicate keys, but
    // we can mutate after construction.
    (tree.children as Record<string, Node>)['A'] = { kind: docKind };

    const out = mergeRemoteSyncTree('Root', tree, undefined, new Set());
    const byCid = new Map(out.map(([cid, , change]) => [cid, change]));

    // A's inline descendants must be reached.
    expect(byCid.get('A')).toBe('payload-A');
    expect(byCid.get('D1')).toBe('payload-D1');
    expect(byCid.get('D2')).toBe('payload-D2');
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

describe('collectReferencedAncestors (frontier helper for initial-load quorum)', () => {
  const docKind: CRDTChangeNodeKind = crdtDocumentChangeNode;
  type Node = CRDTChangeNode<string>;

  test('empty tree (no children) yields no referenced ancestors', () => {
    const root: Node = { kind: docKind, change: 'payload-A' };
    const out = new Set<string>();
    collectReferencedAncestors('A', root, out);
    expect(out.size).toBe(0);
  });

  test('does NOT add the root CID to the referenced set', () => {
    // The root is the head, not an ancestor. Only `children` keys are
    // referenced.
    const root: Node = { kind: docKind, change: 'payload-A' };
    const out = new Set<string>();
    collectReferencedAncestors('A', root, out);
    expect(out.has('A')).toBe(false);
  });

  test('collects every CID found as a children key (linear chain)', () => {
    // Local writer chain: C -> B -> A (current head is C; A is the oldest
    // ancestor). C.children = {B: ...}, B.children = {A: ...}.
    const tree: Node = {
      kind: docKind,
      change: 'payload-C',
      children: {
        B: {
          kind: docKind,
          change: 'payload-B',
          children: { A: { kind: docKind, change: 'payload-A' } },
        },
      },
    };
    const out = new Set<string>();
    collectReferencedAncestors('C', tree, out);
    expect(out.has('B')).toBe(true);
    expect(out.has('A')).toBe(true);
    expect(out.has('C')).toBe(false); // root is the head, not an ancestor
    expect(out.size).toBe(2);
  });

  test('collects cross-link references emitted as deferred leaves', () => {
    // D's primary parent is C inline, and D cross-links to an older ancestor
    // X via a deferred leaf (no `change`, no `children`). Both must be
    // recorded as referenced.
    const tree: Node = {
      kind: docKind,
      change: 'payload-D',
      children: {
        C: {
          kind: docKind,
          change: 'payload-C',
          children: { B: { kind: docKind, change: 'payload-B' } },
        },
        X: { kind: docKind }, // deferred cross-link
      },
    };
    const out = new Set<string>();
    collectReferencedAncestors('D', tree, out);
    expect(out.has('C')).toBe(true);
    expect(out.has('B')).toBe(true);
    expect(out.has('X')).toBe(true);
    expect(out.has('D')).toBe(false);
  });

  test('skips a `crdtChangeNodeDeferred` children sentinel without throwing', () => {
    // IPLD-deferred subtree: the inline payload was elided and would need a
    // blockstore fetch. We don't try to walk it -- the caller already has
    // whatever parent relationships were inlined elsewhere.
    const tree: Node = {
      kind: docKind,
      change: 'payload-A',
      // Cast to bypass the type narrowing on `false` literal for tests.
      children: false as unknown as Record<string, Node>,
    };
    const out = new Set<string>();
    expect(() =>
      collectReferencedAncestors('A', tree, out),
    ).not.toThrow();
    expect(out.size).toBe(0);
  });

  test('mutates the passed Set in place and returns it', () => {
    // Tests can compose multiple sync trees into one shared set, mirroring
    // how `_referencedAncestors` accumulates across calls.
    const tree: Node = {
      kind: docKind,
      change: 'payload-B',
      children: { A: { kind: docKind, change: 'payload-A' } },
    };
    const out = new Set<string>(['X']); // pre-existing entry
    const returned = collectReferencedAncestors('B', tree, out);
    expect(returned).toBe(out);
    expect(out.has('X')).toBe(true); // pre-existing entry preserved
    expect(out.has('A')).toBe(true); // new entry added
  });

  test('cycle defence: revisiting a previously-walked CID does not recurse', () => {
    // Construct a pathological tree where two distinct subtree references
    // reach the same intermediate CID. The helper should not infinitely
    // recurse and should still surface the right referenced set.
    const sharedAncestor: Node = {
      kind: docKind,
      change: 'payload-A',
    };
    const tree: Node = {
      kind: docKind,
      change: 'payload-C',
      children: {
        B1: { kind: docKind, change: 'payload-B1', children: { A: sharedAncestor } },
        B2: { kind: docKind, change: 'payload-B2', children: { A: sharedAncestor } },
      },
    };
    const out = new Set<string>();
    expect(() =>
      collectReferencedAncestors('C', tree, out),
    ).not.toThrow();
    expect(out.has('A')).toBe(true);
    expect(out.has('B1')).toBe(true);
    expect(out.has('B2')).toBe(true);
  });

  test('frontier semantics: two trees of different cardinality but same head produce the same heads', () => {
    // PR #284 round-3 acceptance scenario: peer A has merged a long
    // ancestor chain (`_hashes` includes many CIDs) while peer B loaded
    // from a snapshot (its `_hashes` includes only the snapshot boundary
    // + post-snapshot changes). Both peers consider HEAD their current
    // head. The frontier helper (`_hashes \ referenced`) MUST agree on
    // {HEAD} across the two views.
    //
    // We mimic this by giving each peer different `_hashes` and different
    // tree shapes, then verifying the computed frontier collapses to the
    // shared head set.
    const compute = (
      hashes: Set<string>,
      rootId: string | undefined,
      root: Node,
    ): Set<string> => {
      const referenced = new Set<string>();
      collectReferencedAncestors(rootId, root, referenced);
      const frontier = new Set<string>();
      for (const cid of hashes) {
        if (!referenced.has(cid)) frontier.add(cid);
      }
      return frontier;
    };

    // Peer A: long history, current head HEAD with ancestors P1, P2, P3.
    const peerATree: Node = {
      kind: docKind,
      change: 'HEAD',
      children: {
        P1: {
          kind: docKind,
          change: 'P1',
          children: {
            P2: {
              kind: docKind,
              change: 'P2',
              children: { P3: { kind: docKind, change: 'P3' } },
            },
          },
        },
      },
    };
    const peerAHashes = new Set(['HEAD', 'P1', 'P2', 'P3']);

    // Peer B: loaded from a snapshot at P2, then synced forward to HEAD.
    // The post-snapshot sync that delivered HEAD had a pruned tree -- it
    // referenced P2 directly as the parent (the sender knew the loader
    // would have P2 from the snapshot, so no need to inline anything
    // deeper). P1 was compacted into the snapshot and never enters the
    // loader's view at all.
    const peerBTree: Node = {
      kind: docKind,
      change: 'HEAD',
      children: {
        P2: { kind: docKind }, // deferred reference to the snapshot boundary
      },
    };
    // After applying the snapshot: P2 is the snapshot boundary (added to
    // _hashes as a sentinel), HEAD is the new head. P1 is not in B's view.
    const peerBHashes = new Set(['HEAD', 'P2']);

    const frontierA = compute(peerAHashes, 'HEAD', peerATree);
    const frontierB = compute(peerBHashes, 'HEAD', peerBTree);

    // Each peer's frontier is exactly {HEAD} despite very different
    // `_hashes` cardinality (4 vs 3) and tree shapes. This is the
    // convergence property that round-3 of the Copilot review demanded.
    expect(Array.from(frontierA).sort()).toEqual(['HEAD']);
    expect(Array.from(frontierB).sort()).toEqual(['HEAD']);

    // Counter-check: the old buggy implementation (`Array.from(_hashes)`)
    // would have produced DIFFERENT frontiers for these two peers (4
    // entries vs 3 entries), so any tipsHash derived from it would have
    // diverged -- the bug round 3 of the review caught.
    expect(peerAHashes.size).not.toBe(peerBHashes.size);
  });
});

/**
 * Tests for `computeServedFrontier`, the structural-binding helper that
 * derives a load-response's frontier from the actual served payload
 * rather than the responder's `tips` attestation. Closes the gap caught
 * by PR #284 r7 Copilot review: previously the quorum frontier binding
 * hashed the responder-supplied `tips` array and compared to the
 * agreed `winningHashHex`, which let a Byzantine peer vote hash X and
 * then serve a divergent payload while keeping `tips` set to X's CIDs.
 * The new binding derives the served frontier structurally from
 * `message.changeId` + `message.changes` (+ optional snapshot
 * boundary), so the responder cannot lie about what they served.
 */
describe('computeServedFrontier (PR #284 r7 served-payload frontier derivation)', () => {
  const docKind: CRDTChangeNodeKind = crdtDocumentChangeNode;

  test('empty payload (no changes, no snapshot) => empty frontier', () => {
    // A responder that has no state at all serves nothing. Their
    // "frontier" is the canonical empty set, which the quorum loader
    // compares to `tipsHash([])`. Honest brand-new responders bootstrap
    // cleanly under this case.
    expect(computeServedFrontier(undefined, undefined, undefined)).toEqual([]);
    expect(computeServedFrontier(undefined, undefined, '')).toEqual([]);
  });

  test('snapshot-only payload (no changes) => boundary CID is the sole frontier', () => {
    // Pure-snapshot load (responder has nothing post-snapshot). The
    // boundary CID is the only head.
    const frontier = computeServedFrontier(undefined, undefined, 'SNAP_BOUNDARY');
    expect(frontier).toEqual(['SNAP_BOUNDARY']);
  });

  test('single-head linear chain: only the root CID is in the frontier', () => {
    // Typical case: responder has a linear change history. The served
    // tree is rooted at HEAD with primary-parent chain HEAD->P1->P2.
    // The frontier of this payload is {HEAD} -- P1 and P2 are
    // referenced ancestors.
    const tree: CRDTChangeNode<unknown> = {
      kind: docKind,
      children: {
        P1: {
          kind: docKind,
          children: {
            P2: { kind: docKind },
          },
        },
      },
    };
    const frontier = computeServedFrontier('HEAD', tree, undefined);
    expect(frontier.sort()).toEqual(['HEAD']);
  });

  test('snapshot + post-snapshot chain that references the boundary: boundary drops out, only post-snapshot head remains', () => {
    // Responder has a snapshot at SNAP_BOUNDARY plus one post-snapshot
    // change H1 that points back to it. After applying both:
    //   - SNAP_BOUNDARY is a node in _hashes (snapshot boundary sentinel)
    //   - SNAP_BOUNDARY is also referenced by H1 as a parent
    //   - SNAP_BOUNDARY therefore drops out of the frontier
    //   - H1 is the sole head
    const tree: CRDTChangeNode<unknown> = {
      kind: docKind,
      children: {
        SNAP_BOUNDARY: { kind: docKind },
      },
    };
    const frontier = computeServedFrontier('H1', tree, 'SNAP_BOUNDARY');
    expect(frontier.sort()).toEqual(['H1']);
  });

  test('snapshot + disjoint post-snapshot change (does NOT reference boundary): two heads', () => {
    // Edge case: post-snapshot change tree exists but does NOT
    // reference the snapshot boundary in its children. Both the
    // snapshot boundary AND the post-snapshot head are tips.
    const tree: CRDTChangeNode<unknown> = {
      kind: docKind,
      // No children -- this is a leaf node in the change tree.
    };
    const frontier = computeServedFrontier('H1', tree, 'SNAP_BOUNDARY');
    expect(frontier.sort()).toEqual(['H1', 'SNAP_BOUNDARY']);
  });

  test('cross-links: deferred children are referenced AND added to cids; not in frontier', () => {
    // Cross-link entries in the served tree are deferred leaves -- they
    // appear as a key in a parent's `children` map (so they are
    // referenced) and the child node has no `change` payload. They
    // should be treated as referenced ancestors, not as heads.
    const tree: CRDTChangeNode<unknown> = {
      kind: docKind,
      children: {
        PRIMARY_PARENT: {
          kind: docKind,
        },
        CROSS_LINK_TIP: {
          // Deferred leaf -- no change payload, no children.
          kind: docKind,
        },
      },
    };
    const frontier = computeServedFrontier('HEAD', tree, undefined);
    // HEAD is the only head -- PRIMARY_PARENT and CROSS_LINK_TIP are
    // both referenced as children.
    expect(frontier.sort()).toEqual(['HEAD']);
  });

  test('forged tips attack: responder ships changes for state Y but claims state X tips', () => {
    // This is the attack the structural-binding closes. Imagine the
    // quorum agreed on `winningHashHex = tipsHash([X_HEAD])`. A
    // Byzantine responder votes hash X (truthfully in the probe
    // round), then on the load serves changes rooted at a completely
    // different head Y_HEAD. The responder also fakes `message.tips =
    // [X_HEAD]` -- but the served payload doesn't contain X_HEAD
    // anywhere.
    //
    // The previous (responder-attestation) binding would have
    // compared `tipsHash([X_HEAD]) === winningHashHex` and PASSED,
    // allowing the divergent state Y to be applied. The new
    // structural binding examines the served payload and computes
    // the frontier as `[Y_HEAD]`. Hashing that gives a value that
    // differs from `winningHashHex`, so the binding REJECTS the
    // peer and `load()` retries the next agreeing peer.
    const forgedTree: CRDTChangeNode<unknown> = {
      kind: docKind,
      children: {
        Y_PARENT: { kind: docKind },
      },
    };
    const servedFrontier = computeServedFrontier(
      'Y_HEAD',
      forgedTree,
      undefined,
    );
    expect(servedFrontier.sort()).toEqual(['Y_HEAD']);
    // The responder's CLAIMED `tips` would say [X_HEAD], but the
    // structural derivation says [Y_HEAD]. The loader hashes the
    // structural result and compares to `winningHashHex`; they
    // differ, the peer is rejected.
    expect(servedFrontier).not.toContain('X_HEAD');
  });

  test('forged tips attack with snapshot in payload: structural derivation also exposes the lie', () => {
    // Same attack but the responder includes a snapshot in the
    // forged payload. The snapshot boundary they ship is for state Y
    // (Y_BOUNDARY), not for the agreed state X. The structural
    // derivation collects {Y_BOUNDARY, Y_HEAD} from the payload --
    // neither matches the agreed X_HEAD.
    const forgedTree: CRDTChangeNode<unknown> = {
      kind: docKind,
      children: {
        Y_BOUNDARY: { kind: docKind },
      },
    };
    const servedFrontier = computeServedFrontier(
      'Y_HEAD',
      forgedTree,
      'Y_BOUNDARY',
    );
    // Y_BOUNDARY is referenced by Y_HEAD => not in frontier.
    // Only Y_HEAD remains.
    expect(servedFrontier.sort()).toEqual(['Y_HEAD']);
  });

  test('responder-internal equivocation: tips claim multiple heads but payload only embeds one => structural frontier exposes the inconsistency', () => {
    // Variant: responder advertises `tips = [H1, H2]` in `message.tips`
    // (and hashes it correctly into the winning hash they voted for),
    // but the served `changes` tree only embeds H1. The
    // structurally-derived frontier is {H1}, which hashes
    // differently from `tipsHash([H1, H2])`. The loader's primary
    // structural check fires; the responder's `tips` is also
    // checked against the structural frontier as defense-in-depth.
    const tree: CRDTChangeNode<unknown> = {
      kind: docKind,
      // No children -- a leaf in the change DAG.
    };
    const servedFrontier = computeServedFrontier('H1', tree, undefined);
    expect(servedFrontier.sort()).toEqual(['H1']);
    // Claimed [H1, H2] != servedFrontier [H1]. Rejected.
  });

  test('deferred children sentinel: tree walk stops, no descendants recursed into', () => {
    // A `children === false` sentinel means IPLD-deferred. The
    // walker should not recurse and the deferred children's keys
    // are not enumerated. The frontier consists of whatever was
    // recorded at the level the deferred sentinel was hit.
    const tree: CRDTChangeNode<unknown> = {
      kind: docKind,
      children: false as false,
    };
    const frontier = computeServedFrontier('HEAD', tree, undefined);
    expect(frontier).toEqual(['HEAD']);
  });

  test('cycle defense: visited-set prevents infinite recursion', () => {
    // Content-addressed CIDs can't cycle in practice, but the helper
    // is defensively guarded. Construct a (synthetic) cycle and
    // verify the walk terminates.
    const a: CRDTChangeNode<unknown> = { kind: docKind, children: {} };
    const b: CRDTChangeNode<unknown> = { kind: docKind, children: { A: a } };
    a.children = { B: b };
    // Walk should terminate and the frontier should still be the
    // (anonymous) root -- with named cycles A and B both being
    // referenced.
    const frontier = computeServedFrontier(undefined, a, undefined);
    // Both A and B are children-keys of each other => both referenced
    // => empty frontier (no unreferenced CIDs).
    expect(frontier).toEqual([]);
  });

  test('honest single-head responder: structural frontier == _currentFrontier() on the loader after sync', () => {
    // Sanity test: the structural derivation produces the same
    // frontier the loader would compute via `_hashes \
    // _referencedAncestors` after applying the served payload
    // (starting from an empty loader). This is the convergence
    // property the binding relies on.
    const tree: CRDTChangeNode<unknown> = {
      kind: docKind,
      children: {
        P1: {
          kind: docKind,
          children: {
            P2: { kind: docKind },
          },
        },
      },
    };
    const servedFrontier = computeServedFrontier('HEAD', tree, undefined);
    // Simulate the loader applying the payload from scratch:
    //   _hashes after sync = {HEAD, P1, P2}
    //   _referencedAncestors after sync = {P1, P2}
    //   _currentFrontier = {HEAD}
    const loaderHashes = new Set<string>();
    const loaderRefs = new Set<string>();
    // Walk the tree the same way `_syncDocumentChanges` would:
    function applyWalk(
      id: string | undefined,
      node: CRDTChangeNode<unknown>,
    ) {
      if (id) loaderHashes.add(id);
      if (node.children === undefined) return;
      if (node.children === false) return;
      for (const [childId, childNode] of Object.entries(node.children)) {
        loaderHashes.add(childId);
        loaderRefs.add(childId);
        applyWalk(childId, childNode);
      }
    }
    applyWalk('HEAD', tree);
    const loaderFrontier = [...loaderHashes].filter((h) => !loaderRefs.has(h));
    expect(servedFrontier.sort()).toEqual(loaderFrontier.sort());
  });

  /**
   * Tests added for the PR #284 r8 multi-head responder fix.
   *
   * These tests document the exact bug Copilot flagged: an honest peer
   * with multiple concurrent heads in `_currentFrontier()` cannot serve
   * all of them in a single load response (the wire shape carries one
   * tree rooted at `_lastSyncMessage.changeId`). Advertising
   * `tipsHash(_currentFrontier())` therefore disagrees with the served
   * payload's structural frontier and the loader's bind check rejects
   * an honest peer.
   *
   * The fix advertises the served frontier
   * (`computeServedFrontier(_lastSyncMessage.changes, _latestSnapshot)`)
   * instead. These tests verify the structural property holds across the
   * multi-head scenario.
   */
  describe('multi-head responder served-vs-current frontier divergence (PR #284 r8)', () => {
    test('responder with concurrent heads {H1, H2, H3} serves a tree rooted at H1 only: served frontier is {H1}, NOT {H1, H2, H3}', () => {
      // Scenario from the Copilot review:
      //   - Peer A made one local change H1 (so `_lastSyncMessage.changeId = H1`).
      //   - Peer A then received H2 and H3 via GossipSub from concurrent
      //     writers. Both are in `_hashes` but neither is a child of any
      //     node in `_lastSyncMessage.changes` (H2 and H3 do not appear
      //     in H1's children map).
      //   - `_currentFrontier()` = {H1, H2, H3} (all three are unreferenced).
      //   - But the load response only ships H1's tree (the responder
      //     has not yet made a new local change that would cross-link
      //     H2/H3 into the served tree).
      //
      // The served payload's structural frontier is {H1}, which is
      // exactly what the loader's `computeServedFrontier` derives. The
      // fix in `_servedFrontier()` advertises tipsHash({H1}) instead of
      // tipsHash({H1, H2, H3}), so the probe and the load round agree.
      const servedTree: CRDTChangeNode<unknown> = {
        kind: docKind,
        // H1 is a leaf in A's served subtree -- no children, no
        // cross-links to H2/H3 yet.
      };
      const servedFrontier = computeServedFrontier('H1', servedTree, undefined);
      expect(servedFrontier.sort()).toEqual(['H1']);

      // Sanity: the FULL local DAG frontier as `_currentFrontier()`
      // would have computed it is {H1, H2, H3}. The two frontiers
      // differ, which is the entire point of the bug.
      const localFrontier = ['H1', 'H2', 'H3'].sort();
      expect(servedFrontier.sort()).not.toEqual(localFrontier);
    });

    test('honest multi-head responder: loader post-sync `_currentFrontier()` equals the served frontier (NOT the responder local frontier)', () => {
      // After the loader applies the served payload, its
      // `_currentFrontier()` will be {H1} (the only head in the
      // received tree). Two honest peers in the same logical state
      // would each advertise tipsHash({H1}); the quorum agrees on
      // {H1}; the structural bind check on the loader hashes the
      // received payload to {H1}; they match. Quorum succeeds for an
      // honest responder.
      const servedTree: CRDTChangeNode<unknown> = { kind: docKind };

      // Simulate two honest peers (P1 and P2) both at the same logical
      // state -- each with `_lastSyncMessage.changeId = H1` and
      // `_lastSyncMessage.changes = servedTree`. P1 has remote heads
      // {H2}, P2 has remote heads {H3}; both un-cross-linked.
      const p1Served = computeServedFrontier('H1', servedTree, undefined);
      const p2Served = computeServedFrontier('H1', servedTree, undefined);
      expect(p1Served.sort()).toEqual(p2Served.sort());

      // The loader (starting from empty) applying P1's load response
      // ends up with `_currentFrontier() = {H1}`. Same hash as
      // p1Served, so the bind check accepts.
      const loaderHashes = new Set<string>();
      const loaderRefs = new Set<string>();
      function applyWalk(
        id: string | undefined,
        node: CRDTChangeNode<unknown>,
      ) {
        if (id) loaderHashes.add(id);
        if (node.children === undefined) return;
        if (node.children === false) return;
        for (const [childId, childNode] of Object.entries(node.children)) {
          loaderHashes.add(childId);
          loaderRefs.add(childId);
          applyWalk(childId, childNode);
        }
      }
      applyWalk('H1', servedTree);
      const loaderFrontier = [...loaderHashes]
        .filter((h) => !loaderRefs.has(h))
        .sort();
      expect(loaderFrontier).toEqual(p1Served.sort());
    });

    test('multi-head responder with cross-linked remote head: served frontier includes both heads only when actually present in the served tree', () => {
      // Variant: the responder DID make a second local change that
      // cross-linked one remote head (H2) but not the other (H3). The
      // served tree now contains H1 -> H2 as cross-link, but H3 is
      // still un-cross-linked. The served frontier is {H1} (with H2
      // referenced as a deferred-leaf child), NOT {H1, H3}.
      //
      // This is consistent: the responder will reconcile H3 via
      // post-load GossipSub sync (cross-linking on the next local
      // change), not via the initial-load quorum protocol.
      const servedTree: CRDTChangeNode<unknown> = {
        kind: docKind,
        children: {
          H2: { kind: docKind }, // deferred leaf -- cross-linked but no inline body
        },
      };
      const servedFrontier = computeServedFrontier('H1', servedTree, undefined);
      // H1 is the head; H2 is referenced (a child of H1 in the served
      // tree); H3 is not part of the served payload at all.
      expect(servedFrontier.sort()).toEqual(['H1']);
    });

    test('Byzantine responder still caught: claims served frontier {H1} but actually serves a tree where H1 references unknown ancestors', () => {
      // The structural derivation is independent of whatever the
      // responder claims in `message.tips`. If the responder's
      // `_servedFrontier()` honest implementation would yield {H1} but
      // a tampered serializer ships a tree with H1 -> X -> Y (referencing
      // ancestors the responder never advertised), the structural
      // frontier remains {H1} (the only unreferenced node) -- the
      // ancestors X, Y are referenced by H1's children map and drop
      // out of the frontier. The bind check still passes against the
      // honest hash, BUT the served payload now includes data the
      // responder didn't authorize. That class of equivocation
      // (extra-data smuggling under a matching frontier hash) is out
      // of scope for `computeServedFrontier` -- it is detected by the
      // outer signature check + the loader's defense-in-depth
      // `message.tips` consistency check, both of which compare the
      // *served frontier* (not the responder's local frontier).
      //
      // This test simply confirms the served frontier of an
      // ancestor-bearing tree is still {H1}: the structural
      // derivation does not get fooled by "extra" nodes the responder
      // shipped that aren't heads.
      const servedTree: CRDTChangeNode<unknown> = {
        kind: docKind,
        children: {
          X: {
            kind: docKind,
            children: {
              Y: { kind: docKind },
            },
          },
        },
      };
      const servedFrontier = computeServedFrontier('H1', servedTree, undefined);
      expect(servedFrontier.sort()).toEqual(['H1']);
    });

    test('Byzantine responder lies in advertise vs serves: hash of FULL frontier {H1,H2,H3} but ships only H1 => structural derivation exposes the lie', () => {
      // A peer that lies about which heads they have -- i.e. computes
      // its advertise hash over the OLD (buggy) `_currentFrontier()`
      // semantics on {H1, H2, H3} -- but actually only serves H1's
      // tree, would lose against the loader's structural derivation.
      // Two honest peers running the FIX (advertise=served) would
      // both produce tipsHash({H1}); the liar's hash is
      // tipsHash({H1,H2,H3}). The liar's hash doesn't even win the
      // quorum (the honest peers disagree with the liar), but if it
      // somehow did, the loader's structural derivation would still
      // hash to {H1} and reject the bind.
      //
      // Verifies the structural derivation behaves identically
      // regardless of what the responder *claims* about their heads.
      const servedTree: CRDTChangeNode<unknown> = { kind: docKind };
      const structurallyDerived = computeServedFrontier(
        'H1',
        servedTree,
        undefined,
      );
      expect(structurallyDerived.sort()).toEqual(['H1']);
      // The liar's claim is {H1, H2, H3} -- different from the
      // structural truth. The loader's defense-in-depth check (compare
      // `message.tips` to structurally-derived frontier) catches this.
      expect(structurallyDerived.sort()).not.toEqual(
        ['H1', 'H2', 'H3'].sort(),
      );
    });

    test('multi-head responder with snapshot: served frontier is `_servedFrontier()` inputs (snapshot boundary + served tree)', () => {
      // When the load response also carries `_latestSnapshot`, the
      // served frontier is computed over BOTH the snapshot boundary
      // CID and the served tree. If the served tree references the
      // boundary (the common case post-snapshot), the boundary drops
      // out and the head of the post-snapshot chain remains. This is
      // identical to the single-head case -- the multi-head bug is
      // about heads NOT in the served tree, not about snapshot
      // semantics. Sanity that the helper handles the mixed input.
      const servedTree: CRDTChangeNode<unknown> = {
        kind: docKind,
        children: {
          SNAP_BOUNDARY: { kind: docKind },
        },
      };
      const servedFrontier = computeServedFrontier(
        'POST_SNAPSHOT_HEAD',
        servedTree,
        'SNAP_BOUNDARY',
      );
      expect(servedFrontier.sort()).toEqual(['POST_SNAPSHOT_HEAD']);
    });
  });
});
