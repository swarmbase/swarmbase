import {
  CRDTChangeNode,
  CRDTChangeNodeDeferred,
  crdtChangeNodeDeferred,
} from './crdt-change-node';

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
    const children: { [hash: string]: CRDTChangeNodeWire<TOut> } = {};
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
  const change = node.change !== undefined ? decodeLeaf(node.change) : undefined;
  if (node.children !== undefined && node.children !== crdtChangeNodeDeferred) {
    const children: { [hash: string]: CRDTChangeNode<TOut> } = {};
    for (const [hash, child] of Object.entries(node.children)) {
      children[hash] = deserializeChangeNodeFromJSON(child, decodeLeaf);
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
