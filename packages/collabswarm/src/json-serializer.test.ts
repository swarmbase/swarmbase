import { describe, expect, test } from '@jest/globals';
import { JSONSerializer } from './json-serializer';
import { CRDTChangeBlock } from './crdt-change-block';

const jsonSerializer = new JSONSerializer<any>();

let testObject = { key: 'val' };
let testObjectSerialized = '{"key":"val"}';
let testString = 'Hello';
let testStringAsUint8Array = Uint8Array.from([72, 101, 108, 108, 111]);

test('serialize json object to string', () => {
  expect(jsonSerializer.serialize(testObject)).toMatch(testObjectSerialized);
});

test('deserialize string to json object', () => {
  expect(jsonSerializer.deserialize(testObjectSerialized)).toMatchObject(
    testObject,
  );
});

test('encode string to Uint8Array', () => {
  expect(jsonSerializer.encode(testString)).toStrictEqual(
    testStringAsUint8Array,
  );
});

test('decode Uint8Array to string', () => {
  expect(jsonSerializer.decode(testStringAsUint8Array)).toMatch(testString);
});

describe('blindIndexTokens in serializeChangeBlock / deserializeChangeBlock', () => {
  const nonce = new Uint8Array([1, 2, 3, 4]);

  test('round-trips a change block without blindIndexTokens', () => {
    const block: CRDTChangeBlock<any> = {
      changes: { foo: 'bar' },
      nonce,
    };
    const serialized = jsonSerializer.serializeChangeBlock(block);
    const deserialized = jsonSerializer.deserializeChangeBlock(serialized);

    expect(deserialized.changes).toEqual({ foo: 'bar' });
    expect(deserialized.nonce).toEqual(nonce);
    expect(deserialized.blindIndexTokens).toBeUndefined();
    expect('blindIndexTokens' in deserialized).toBe(false);
  });

  test('round-trips a change block with a populated blindIndexTokens map', () => {
    const tokens = { 'field.name': 'hmac-token-abc', 'email': 'hmac-token-def' };
    const block: CRDTChangeBlock<any> = {
      changes: { foo: 'bar' },
      nonce,
      blindIndexTokens: tokens,
    };
    const serialized = jsonSerializer.serializeChangeBlock(block);
    const deserialized = jsonSerializer.deserializeChangeBlock(serialized);

    expect(deserialized.blindIndexTokens).toEqual(tokens);
  });

  test('round-trips a change block with an empty blindIndexTokens map', () => {
    const block: CRDTChangeBlock<any> = {
      changes: { foo: 'bar' },
      nonce,
      blindIndexTokens: {},
    };
    const serialized = jsonSerializer.serializeChangeBlock(block);
    const deserialized = jsonSerializer.deserializeChangeBlock(serialized);

    expect(deserialized.blindIndexTokens).toEqual({});
    expect('blindIndexTokens' in deserialized).toBe(true);
  });

  test('rejects blindIndexTokens that is an array', () => {
    const raw = JSON.stringify({
      changes: { foo: 'bar' },
      nonce: 'AQIDBA==',
      blindIndexTokens: ['not', 'an', 'object'],
    });
    expect(() => jsonSerializer.deserializeChangeBlock(raw)).toThrow(
      'blindIndexTokens must be a plain object',
    );
  });

  test('rejects blindIndexTokens that is null', () => {
    const raw = JSON.stringify({
      changes: { foo: 'bar' },
      nonce: 'AQIDBA==',
      blindIndexTokens: null,
    });
    expect(() => jsonSerializer.deserializeChangeBlock(raw)).toThrow(
      'blindIndexTokens must be a plain object',
    );
  });

  test('rejects blindIndexTokens with non-string values', () => {
    const raw = JSON.stringify({
      changes: { foo: 'bar' },
      nonce: 'AQIDBA==',
      blindIndexTokens: { field: 123 },
    });
    expect(() => jsonSerializer.deserializeChangeBlock(raw)).toThrow(
      'blindIndexTokens values must be strings',
    );
  });
});
