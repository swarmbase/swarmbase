---
title: Designing Yjs schemas
description: Choose the right Yjs shared types for your app state, avoid CRDT anti-patterns, and evolve schemas safely.
---

In Swarmbase, every document wraps a `Y.Doc`, and there is no schema enforcement — structure is convention. But your choice of Yjs shared type *is* your conflict-resolution policy: pick the wrong type and concurrent edits get silently lost or duplicated. This recipe condenses the full [Yjs schema guide](https://github.com/swarmbase/swarmbase/blob/main/guides/yjs-schema-guide.md) in the repository into the decisions you'll actually make.

## Pick the type by the merge behavior you want

| You're storing… | Use | Concurrent edits resolve by… |
|---|---|---|
| Record fields, settings, metadata | `Y.Map` | Last-writer-wins **per key** |
| Ordered collections (tasks, messages) | `Y.Array` | All insertions preserved, deterministic order |
| Prose / collaborative text | `Y.Text` | Character-level merge (Quill-delta compatible) |
| Editor trees (ProseMirror, Slate, TipTap) | `Y.XmlFragment` / `Y.XmlElement` | Array semantics for children, LWW per attribute |
| A set (tags, labels, members) | `Y.Map<boolean>` | **Add wins** over concurrent delete |
| A counter | per-peer `Y.Map<number>`, summed | No lost increments (different keys never conflict) |

## Complete working example

A task list exercising the main patterns, written against the same `change()` API Swarmbase gives you:

```typescript
import * as Y from 'yjs';

// swarmDoc.change((doc: Y.Doc) => { ... }) hands you the Y.Doc.

function addTask(doc: Y.Doc, title: string): void {
  const tasks = doc.getArray<Y.Map<any>>('tasks');

  // Items with mutable fields = nested Y.Map inside Y.Array.
  const task = new Y.Map();
  task.set('id', crypto.randomUUID());
  task.set('title', title);
  task.set('status', 'todo');          // LWW register
  task.set('createdAt', Date.now());   // display only — never for ordering
  const labels = new Y.Map<boolean>(); // add-wins set
  task.set('labels', labels);
  tasks.push([task]);
}

function toggleDone(task: Y.Map<any>): void {
  // Updates ONE field; concurrent edits to other fields survive.
  task.set('status', task.get('status') === 'done' ? 'todo' : 'done');
}

// Counter: per-peer keys, summed on read. A single shared key would
// be LWW and lose concurrent increments.
function upvote(doc: Y.Doc, peerId: string): void {
  const counters = doc.getMap<number>('vote-counts');
  counters.set(peerId, (counters.get(peerId) || 0) + 1);
}
function totalVotes(doc: Y.Doc): number {
  let sum = 0;
  doc.getMap<number>('vote-counts').forEach((v) => { sum += v; });
  return sum;
}

// Batch related edits into one update event.
function importTasks(doc: Y.Doc, titles: string[]): void {
  doc.transact(() => {
    for (const t of titles) addTask(doc, t);
    doc.getMap('meta').set('updatedAt', Date.now());
  });
}
```

## Do / Don't

**Do**

- **Nest `Y.Map` inside `Y.Array`** for list items with editable fields — each field then merges independently.
- **Reference items by ID, not index.** Array indices shift when other peers insert or delete.
- **Use soft-delete flags** (`item.set('hidden', true)`) instead of delete + re-insert loops. Every deletion is a permanent tombstone.
- **Model moves with fractional sort keys** when reordering is frequent: store items in a `Y.Map` keyed by ID with a sortable `sortKey` field, instead of physically moving array slots. Concurrent delete+insert moves of the same item can duplicate it.
- **Split into multiple documents** when entities are independent, need different ACLs, exceed ~1 MB of encoded state, or should load lazily. Use an index document that maps IDs to metadata.
- **Keep indexed/queryable fields at consistent paths** (e.g. every document has `meta.type`, `meta.status`) so [indexing](../search-indexing/) can work across a collection.

**Don't**

- **Don't store plain objects when you need field-level edits.** `tasks.push([{ id, title, done }])` makes the object an opaque LWW blob — updating `done` replaces the whole thing.
- **Don't replace whole nested structures** (`config.set('settings', {...})`) — concurrent field-level edits to the old structure are lost. Set individual keys.
- **Don't store derived data** (counts, totals) in the CRDT — two peers computing from different states will fight. Compute on read.
- **Don't put JSON in `Y.Text`.** Concurrent character edits mid-JSON produce garbage. `Y.Text` is for prose.
- **Don't nest deeper than 2–3 levels.** Flatten with composite keys (`members.set('org:team:alice', ...)`) or split documents.
- **Don't use wall-clock timestamps for ordering or conflict resolution** — clocks skew and can be manipulated. Timestamps are for display; ordering comes from CRDT structure.

## Migration and versioning

Yjs documents are schema-less, so versions coexist on the network. The guide's rules:

```typescript
// Stamp a version on creation…
doc.getMap('meta').set('schemaVersion', 2);

// …and migrate idempotently on load.
function onDocumentLoad(doc: Y.Doc): void {
  const meta = doc.getMap('meta');
  const version = (meta.get('schemaVersion') as number) || 1;

  if (version < 2) {
    const tasks = doc.getArray<Y.Map<any>>('tasks');
    for (let i = 0; i < tasks.length; i++) {
      const task = tasks.get(i);
      if (!task.has('priority')) {       // has() check = idempotent
        task.set('priority', 'medium');
      }
    }
    meta.set('schemaVersion', 2);
  }

  if (version > 2) {
    // Newer peer wrote this — read what you understand, never crash.
    console.warn(`Schema version ${version} is newer than supported (2).`);
  }
}
```

- **Never remove fields** — older peers may still read them. Deprecate with `null`/sentinels.
- **Never change a field's type** — if `title` was a string, add `titleText` (a `Y.Text`) instead of replacing it.
- **Migrations must be idempotent** — multiple peers may run the same migration concurrently; guard with `has()`.
- **Renames are copies**: write the new key, keep the old one readable.

## Pitfalls

- **`Y.Map` set-vs-delete races resolve add-wins; same-key set-vs-set races are LWW by client ID.** Neither is "wrong" — but make sure your UI copy doesn't promise merge behavior the type can't deliver (e.g., two people editing one `Y.Map` string field is last-writer-wins, not a merge).
- **Documents only grow.** Deleted content leaves tombstones forever, and heavy `set()` churn on one key grows state linearly with writes. Don't stream high-frequency ephemeral state (cursor positions, presence) through the CRDT.
- **A shared type instance can only have one parent.** Inserting the same `Y.Map` into two arrays throws — always construct a fresh instance per insertion.
- **One document = one encryption key = one ACL.** You cannot selectively encrypt or share *parts* of a `Y.Doc` in Swarmbase; and key rotation protects future updates only, not already-synced history. Put data with different sensitivity in different documents.
