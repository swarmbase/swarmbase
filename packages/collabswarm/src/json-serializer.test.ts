import { describe, expect, test } from '@jest/globals';
import { JSONSerializer } from './json-serializer';

let json_serializer = new JSONSerializer();

describe('test serialize methods', () => {
  test.each([
    [{ "key": "val" }, '{"key":"val"}'],
    [{123:234, 345: 567}, '{"123":234,"345":567}']
  ])(`serialize object to string`, (example, expected) =>{
    expect(json_serializer.serialize(example))
    .toMatch(expected);
  })
  test.each([
    ['{"key":"val"}', { "key": "val" }],
    ['{"123":234,"345":567}', {123:234, 345: 567}]
  ])('deserialize string to json object', (example, expected) =>{
    expect(json_serializer.deserialize(example))
    .toMatchObject(expected);
  })
})

describe('test encode methods', () => {
  test.each([
    ["Hello", Uint8Array.from([72, 101, 108, 108, 111])]
  ])('encode string to Uint8Array', (example, expected) =>{
  expect(json_serializer.encode(example))
    .toStrictEqual(expected);
	})

	test.each([
		[Uint8Array.from([72, 101, 108, 108, 111]), "Hello"]
	])('decode Uint8Array to string', (example, expected) =>{
		expect(json_serializer.decode(example))
			.toMatch(expected);
	})
})
