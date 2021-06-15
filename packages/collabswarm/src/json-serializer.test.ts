import { describe, expect, test } from '@jest/globals';
import { JSONSerializer } from './json-serializer';

const json_serializer = new JSONSerializer<any, any>();

let test_object = { "key": "val" };
let test_object_serialized = '{"key":"val"}';
let test_string = "Hello";
let test_string_as_u8_array = Uint8Array.from([72,101,108,108,111]);

describe('test serialize methods', () => {
  test.each([
    [{ "key": "val" }, '{"key":"val"}'],
    [{123:234, 345: 567}, '{"123":234,"345":567}']
  ])(`serialize object to string`, (example, expected) =>{
    expect(json_serializer.serialize(example))
    .toMatch(expected);
  })
  // TODO (e:r)
  test.each([
    ['{"key":"val"}', { "key": "val" }],
    ['{123:234,345:567}', {123:234, 345: 567}]
  ])('deserialize string to json object', () =>{
    expect(json_serializer.deserialize(test_object_serialized))
    .toMatchObject(test_object);
  })
})

describe('test encode methods', () => {
  test.each([
    [test_string, test_string_as_u8_array]
  ])
  ('encode string to Uint8Array', () =>{
  expect(json_serializer.encode(test_string))
    .toStrictEqual(test_string_as_u8_array);
})

test('decode Uint8Array to string', () =>{
  expect(json_serializer.decode(test_string_as_u8_array))
    .toMatch(test_string);
})})
