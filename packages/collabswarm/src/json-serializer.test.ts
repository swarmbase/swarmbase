import { expect, test } from "@jest/globals";
import { JSONSerializer } from "./json-serializer";

const json_serializer = new JSONSerializer<any, any>();

const test_object = { key: "val" };
const test_object_serialized = '{"key":"val"}';
let test_string = "Hello";
let test_string_as_u8_array = Uint8Array.from([72, 101, 108, 108, 111]);

test("serialize json object to string", () => {
  expect(json_serializer.serialize(test_object)).toMatch(
    test_object_serialized
  );
});

test("deserialize string to json object", () => {
  expect(json_serializer.deserialize(test_object_serialized)).toMatchObject(
    test_object
  );
});

test("encode string to Uint8Array", () => {
  expect(json_serializer.encode(test_string)).toStrictEqual(
    test_string_as_u8_array
  );
});

test("decode Uint8Array to string", () => {
  expect(json_serializer.decode(test_string_as_u8_array)).toMatch(test_string);
});
