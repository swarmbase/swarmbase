import { describe, expect, test } from '@jest/globals';
import {
  CRDTChangeNode,
  crdtChangeNodeDeferred,
} from './crdt-change-node';
import {
  CRDTChangeNodeWire,
  deserializeChangeNodeFromJSON,
  serializeChangeNodeForJSON,
} from './merkle-dag-serialization';

// --- Test encoders -------------------------------------------------------

// Hex codec: keeps tests dependency-free while exercising the same shape as
// the base64 codec used by the real providers.
function hexEncode(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

function hexDecode(hex: string): Uint8Array {
  if (hex.length % 2 !== 0) {
    throw new Error('hex string must have even length');
  }
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(hex.substring(i * 2, i * 2 + 2), 16);
  }
  return out;
}

const encodeBytes = (b: Uint8Array): string => hexEncode(b);
const decodeBytes = (s: string): Uint8Array => hexDecode(s);

const encodeBytesArray = (bs: Uint8Array[]): string[] =>
  bs.map((b) => hexEncode(b));
const decodeBytesArray = (ss: string[]): Uint8Array[] =>
  ss.map((s) => hexDecode(s));

function expectBytesEqual(actual: Uint8Array, expected: Uint8Array): void {
  expect(Array.from(actual)).toEqual(Array.from(expected));
}

function expectBytesArrayEqual(
  actual: Uint8Array[],
  expected: Uint8Array[],
): void {
  expect(actual.length).toBe(expected.length);
  for (let i = 0; i < actual.length; i++) {
    expectBytesEqual(actual[i], expected[i]);
  }
}

// --- Tests ---------------------------------------------------------------

describe('serializeChangeNodeForJSON / deserializeChangeNodeFromJSON', () => {
  test('round-trips a leaf-only Uint8Array node (no children)', () => {
    const original: CRDTChangeNode<Uint8Array> = {
      kind: 'document',
      change: new Uint8Array([1, 2, 3, 4]),
    };

    const wire = serializeChangeNodeForJSON(original, encodeBytes);
    expect(wire.kind).toBe('document');
    expect(wire.change).toBe('01020304');
    expect(wire.children).toBeUndefined();

    const restored = deserializeChangeNodeFromJSON(wire, decodeBytes);
    expect(restored.kind).toBe('document');
    expect(restored.change).toBeDefined();
    expectBytesEqual(restored.change as Uint8Array, original.change as Uint8Array);
    expect(restored.children).toBeUndefined();
  });

  test('round-trips a leaf-only Uint8Array[] node (mirrors automerge)', () => {
    const original: CRDTChangeNode<Uint8Array[]> = {
      kind: 'writer',
      keyID: 'key-1',
      change: [new Uint8Array([5, 6]), new Uint8Array([7, 8, 9])],
    };

    const wire = serializeChangeNodeForJSON(original, encodeBytesArray);
    expect(wire.kind).toBe('writer');
    expect(wire.keyID).toBe('key-1');
    expect(wire.change).toEqual(['0506', '070809']);

    const restored = deserializeChangeNodeFromJSON(wire, decodeBytesArray);
    expect(restored.kind).toBe('writer');
    expect(restored.keyID).toBe('key-1');
    expectBytesArrayEqual(
      restored.change as Uint8Array[],
      original.change as Uint8Array[],
    );
  });

  test('preserves an empty tree where change is undefined and children is undefined', () => {
    const original: CRDTChangeNode<Uint8Array> = { kind: 'reader' };

    const wire = serializeChangeNodeForJSON(original, encodeBytes);
    expect(wire).toEqual({ kind: 'reader', change: undefined, children: undefined });

    const restored = deserializeChangeNodeFromJSON(wire, decodeBytes);
    expect(restored.kind).toBe('reader');
    expect(restored.change).toBeUndefined();
    expect(restored.children).toBeUndefined();
  });

  test('round-trips a multi-level tree with multiple children at each level (Uint8Array)', () => {
    const original: CRDTChangeNode<Uint8Array> = {
      kind: 'document',
      change: new Uint8Array([0xaa]),
      children: {
        h1: {
          kind: 'document',
          change: new Uint8Array([0xbb, 0xcc]),
          children: {
            h1a: {
              kind: 'writer',
              keyID: 'k-1',
              change: new Uint8Array([0x01]),
            },
            h1b: {
              kind: 'reader',
              change: new Uint8Array([0x02]),
            },
          },
        },
        h2: {
          kind: 'document',
          change: new Uint8Array([0xdd]),
          children: {
            h2a: {
              kind: 'document',
              change: new Uint8Array([0x03, 0x04, 0x05]),
            },
          },
        },
        h3: {
          kind: 'writer',
          change: new Uint8Array([]),
        },
      },
    };

    const wire = serializeChangeNodeForJSON(original, encodeBytes);

    // Wire form must be plain-JSON-safe: round-trip through JSON.
    const json = JSON.stringify(wire);
    const reparsed = JSON.parse(json) as CRDTChangeNodeWire<string>;

    const restored = deserializeChangeNodeFromJSON(reparsed, decodeBytes);

    expect(restored.kind).toBe('document');
    expectBytesEqual(restored.change as Uint8Array, new Uint8Array([0xaa]));

    // children should be present and structurally identical.
    expect(restored.children).not.toBe(crdtChangeNodeDeferred);
    expect(restored.children).toBeDefined();
    const children = restored.children as Record<
      string,
      CRDTChangeNode<Uint8Array>
    >;
    expect(Object.keys(children).sort()).toEqual(['h1', 'h2', 'h3']);

    expectBytesEqual(
      children.h1.change as Uint8Array,
      new Uint8Array([0xbb, 0xcc]),
    );
    const h1Children = children.h1.children as Record<
      string,
      CRDTChangeNode<Uint8Array>
    >;
    expect(Object.keys(h1Children).sort()).toEqual(['h1a', 'h1b']);
    expect(h1Children.h1a.kind).toBe('writer');
    expect(h1Children.h1a.keyID).toBe('k-1');
    expectBytesEqual(h1Children.h1a.change as Uint8Array, new Uint8Array([0x01]));
    expect(h1Children.h1b.kind).toBe('reader');
    expectBytesEqual(h1Children.h1b.change as Uint8Array, new Uint8Array([0x02]));

    const h2Children = children.h2.children as Record<
      string,
      CRDTChangeNode<Uint8Array>
    >;
    expect(Object.keys(h2Children)).toEqual(['h2a']);
    expectBytesEqual(
      h2Children.h2a.change as Uint8Array,
      new Uint8Array([0x03, 0x04, 0x05]),
    );

    expect(children.h3.kind).toBe('writer');
    expectBytesEqual(children.h3.change as Uint8Array, new Uint8Array([]));
    expect(children.h3.children).toBeUndefined();
  });

  test('round-trips a multi-level tree with Uint8Array[] leaves (mirrors automerge)', () => {
    const original: CRDTChangeNode<Uint8Array[]> = {
      kind: 'document',
      change: [new Uint8Array([1])],
      children: {
        a: {
          kind: 'writer',
          change: [new Uint8Array([2]), new Uint8Array([3, 4])],
          children: {
            'a.1': {
              kind: 'reader',
              keyID: 'reader-key',
              change: [new Uint8Array([5, 6, 7])],
            },
          },
        },
        b: {
          kind: 'document',
          change: [],
        },
      },
    };

    const wire = serializeChangeNodeForJSON(original, encodeBytesArray);
    const restored = deserializeChangeNodeFromJSON(wire, decodeBytesArray);

    expectBytesArrayEqual(
      restored.change as Uint8Array[],
      original.change as Uint8Array[],
    );
    const children = restored.children as Record<
      string,
      CRDTChangeNode<Uint8Array[]>
    >;
    expectBytesArrayEqual(
      children.a.change as Uint8Array[],
      [new Uint8Array([2]), new Uint8Array([3, 4])],
    );
    const aChildren = children.a.children as Record<
      string,
      CRDTChangeNode<Uint8Array[]>
    >;
    expect(aChildren['a.1'].keyID).toBe('reader-key');
    expectBytesArrayEqual(
      aChildren['a.1'].change as Uint8Array[],
      [new Uint8Array([5, 6, 7])],
    );
    // Empty array leaves must round-trip as empty arrays (not undefined).
    expect(children.b.change).toEqual([]);
  });

  test('preserves crdtChangeNodeDeferred children sentinel through round-trip', () => {
    const original: CRDTChangeNode<Uint8Array> = {
      kind: 'document',
      change: new Uint8Array([9]),
      children: crdtChangeNodeDeferred,
    };

    const wire = serializeChangeNodeForJSON(original, encodeBytes);
    expect(wire.children).toBe(crdtChangeNodeDeferred);

    const restored = deserializeChangeNodeFromJSON(wire, decodeBytes);
    expect(restored.children).toBe(crdtChangeNodeDeferred);
    expectBytesEqual(restored.change as Uint8Array, new Uint8Array([9]));
  });

  test('encoder is not invoked for nodes whose change is undefined', () => {
    const original: CRDTChangeNode<Uint8Array> = {
      kind: 'document',
      children: {
        only: {
          kind: 'writer',
          change: new Uint8Array([42]),
        },
      },
    };

    let calls = 0;
    const wire = serializeChangeNodeForJSON(original, (b) => {
      calls++;
      return hexEncode(b);
    });
    expect(calls).toBe(1);
    expect(wire.change).toBeUndefined();
    const wireChildren = wire.children as Record<
      string,
      CRDTChangeNodeWire<string>
    >;
    expect(wireChildren.only.change).toBe('2a');

    let decCalls = 0;
    const restored = deserializeChangeNodeFromJSON(wire, (s) => {
      decCalls++;
      return hexDecode(s);
    });
    expect(decCalls).toBe(1);
    expect(restored.change).toBeUndefined();
    const restoredChildren = restored.children as Record<
      string,
      CRDTChangeNode<Uint8Array>
    >;
    expectBytesEqual(
      restoredChildren.only.change as Uint8Array,
      new Uint8Array([42]),
    );
  });
});
