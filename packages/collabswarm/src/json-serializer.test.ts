import { expect, test } from "@jest/globals";
import { JSONSerializer } from "./json-serializer";

const jsonSerializer = new JSONSerializer<any>();

let testObject = { key: "val" };
let testObjectSerialized = '{"key":"val"}';
let testString = "Hello";
let testStringAsUint8Array = Uint8Array.from([72, 101, 108, 108, 111]);

test("serialize json object to string", () => {
  expect(jsonSerializer.serialize(testObject)).toMatch(
    testObjectSerialized
  );
});

test("deserialize string to json object", () => {
  expect(jsonSerializer.deserialize(testObjectSerialized)).toMatchObject(
    testObject
  );
});

test("encode string to Uint8Array", () => {
  expect(jsonSerializer.encode(testString)).toStrictEqual(
    testStringAsUint8Array
  );
});

test("decode Uint8Array to string", () => {
  expect(jsonSerializer.decode(testStringAsUint8Array)).toMatch(testString);
});
