import {
  CRDTChangeNode,
  CRDTChangeNodeDeferred,
  CRDTChangeNodeKind,
  crdtChangeNodeDeferred,
  crdtDocumentChangeNode,
  crdtReaderChangeNode,
  crdtWriterChangeNode,
} from './crdt-change-node';

// Allow-list of `kind` discriminants accepted from peer wire messages.
// Kept in sync with `CRDTChangeNodeKind` via the type assertion below so a
// new kind added to the union will fail to compile here until the set is
// updated.
const VALID_CHANGE_NODE_KINDS: ReadonlySet<CRDTChangeNodeKind> = new Set([
  crdtDocumentChangeNode,
  crdtWriterChangeNode,
  crdtReaderChangeNode,
]);

function isValidChangeNodeKind(value: unknown): value is CRDTChangeNodeKind {
  return (
    typeof value === 'string' &&
    VALID_CHANGE_NODE_KINDS.has(value as CRDTChangeNodeKind)
  );
}

/**
 * Wire-shape mirror of `CRDTChangeNode<T>` used during JSON serialization.
 *
 * The `kind` / `keyID` / `children` shape is preserved exactly; only the
 * `change` payload at each leaf is rewritten to a JSON-friendly type by the
 * caller-provided encoder.
 */
export type CRDTChangeNodeWire<TOut> = {
  kind: CRDTChangeNode<unknown>['kind'];
  keyID?: string;
  change?: TOut;
  children?: { [hash: string]: CRDTChangeNodeWire<TOut> } | CRDTChangeNodeDeferred;
};

/**
 * Recursively serialize a `CRDTChangeNode` tree by transforming each node's
 * `change` payload via the provided encoder, preserving the `kind`, `keyID`,
 * and `children` structure for round-tripping through JSON.
 *
 * A `children` value equal to `crdtChangeNodeDeferred` (i.e. `false`) is
 * preserved verbatim so deferred subtrees survive the round-trip.
 *
 * The output is intentionally byte-identical (modulo the leaf encoding) to
 * the input shape so peers running this code interoperate with peers using
 * the prior per-provider helpers.
 *
 * @typeParam TIn  Input leaf payload type (e.g. `Uint8Array` or
 *                 `Uint8Array[]`).
 * @typeParam TOut Output leaf payload type (e.g. `string` or `string[]`).
 * @param node      The change node tree to serialize.
 * @param encodeLeaf Function that maps an input leaf payload to its
 *                  JSON-serializable representation.
 */
export function serializeChangeNodeForJSON<TIn, TOut>(
  node: CRDTChangeNode<TIn>,
  encodeLeaf: (leaf: TIn) => TOut,
): CRDTChangeNodeWire<TOut> {
  const change = node.change !== undefined ? encodeLeaf(node.change) : undefined;
  if (node.children !== undefined && node.children !== crdtChangeNodeDeferred) {
    // Use a null-prototype dictionary so that hash keys coming from peer
    // wire messages (e.g. `__proto__`, `constructor`) cannot mutate the
    // shared `Object.prototype` or otherwise alter lookup semantics.
    const children: { [hash: string]: CRDTChangeNodeWire<TOut> } =
      Object.create(null);
    for (const [hash, child] of Object.entries(node.children)) {
      children[hash] = serializeChangeNodeForJSON(child, encodeLeaf);
    }
    return {
      ...node,
      change,
      children,
    };
  }
  return {
    ...node,
    change,
    children: node.children,
  };
}

/**
 * Inverse of {@link serializeChangeNodeForJSON}: recursively reconstruct a
 * `CRDTChangeNode` tree from its JSON-friendly wire form, decoding each
 * node's `change` payload via the provided decoder.
 *
 * Preserves `crdtChangeNodeDeferred` children verbatim, matching the
 * serializer.
 *
 * Wire input is treated as untrusted: the reconstructed `children` map uses a
 * null prototype so peer-supplied hash keys (e.g. `__proto__`,
 * `constructor`) cannot pollute `Object.prototype` or shadow inherited
 * members. The shape of the node itself is also validated: `kind` must be a
 * known {@link CRDTChangeNodeKind} discriminant, and each entry in
 * `children` must be a plain object. A malformed peer message throws a
 * descriptive `Error` rather than silently passing the bad value through
 * via spread.
 *
 * @typeParam TIn  Wire leaf payload type (e.g. `string` or `string[]`).
 * @typeParam TOut Decoded leaf payload type (e.g. `Uint8Array` or
 *                 `Uint8Array[]`).
 * @param node       The wire-form change node tree to deserialize.
 * @param decodeLeaf Function that maps a wire leaf payload back to its
 *                   in-memory representation.
 */
export function deserializeChangeNodeFromJSON<TIn, TOut>(
  node: CRDTChangeNodeWire<TIn>,
  decodeLeaf: (leaf: TIn) => TOut,
): CRDTChangeNode<TOut> {
  // Wire input is untrusted: a malformed peer message can omit or supply a
  // non-string `kind`. Reject up front so downstream consumers can rely on
  // the discriminant being one of the documented `CRDTChangeNodeKind`s
  // rather than silently propagating an invalid value via `...node`.
  if (!isValidChangeNodeKind(node.kind)) {
    throw new Error(
      `Invalid merkle-dag node: "kind" must be one of ${Array.from(
        VALID_CHANGE_NODE_KINDS,
      )
        .map((k) => JSON.stringify(k))
        .join(', ')} (got ${JSON.stringify(node.kind)})`,
    );
  }
  const change = node.change !== undefined ? decodeLeaf(node.change) : undefined;
  if (node.children !== undefined && node.children !== crdtChangeNodeDeferred) {
    // Wire input is untrusted: validate the children shape before iterating,
    // since `Object.entries(null)` / non-object inputs throw a `TypeError`
    // that's hard to attribute back to a malformed peer message.
    if (
      typeof node.children !== 'object' ||
      node.children === null ||
      Array.isArray(node.children)
    ) {
      throw new Error(
        'Invalid merkle-dag node: "children" must be an object keyed by hash',
      );
    }
    // Null-prototype dictionary: peer-supplied JSON keys like `__proto__`
    // or `constructor` cannot pollute `Object.prototype` or shadow
    // inherited members on the resulting children map.
    const children: { [hash: string]: CRDTChangeNode<TOut> } =
      Object.create(null);
    for (const [hash, child] of Object.entries(node.children)) {
      // Each child must itself be a plain object (not null, not an array,
      // not a primitive) before we recurse -- otherwise the recursive call
      // would fail deep in the stack with a less helpful error and might
      // partially construct a children map.
      if (
        typeof child !== 'object' ||
        child === null ||
        Array.isArray(child)
      ) {
        throw new Error(
          `Invalid merkle-dag node: child at key ${JSON.stringify(
            hash,
          )} must be a plain object (got ${
            child === null ? 'null' : Array.isArray(child) ? 'array' : typeof child
          })`,
        );
      }
      children[hash] = deserializeChangeNodeFromJSON(
        child as CRDTChangeNodeWire<TIn>,
        decodeLeaf,
      );
    }
    return {
      ...node,
      change,
      children,
    };
  }
  return {
    ...node,
    change,
    children: node.children,
  };
}
