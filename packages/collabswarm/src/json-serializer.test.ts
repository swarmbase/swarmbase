import { expect, test } from '@jest/globals';
import { JSONSerializer } from './json-serializer';

const json_serializer = new JSONSerializer<any, any>();

let test_object = { "key": "val" }
let test_object_serialized = '{"key":"val"}'

test('serializes json object to type string', () =>{
  expect(json_serializer.serialize(test_object))
    .toMatch(test_object_serialized);
})

test('deserialize string to json object', () =>{
  expect(json_serializer.deserialize(test_object_serialized))
    .toMatchObject(test_object);
})

