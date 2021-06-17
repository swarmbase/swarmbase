import { beforeAll, describe, expect, test } from "@jest/globals";
import { SubtleCrypto } from "./auth-subtlecrypto";

const auth = new SubtleCrypto();

let keyPair: CryptoKeyPair;
let documentKey: CryptoKey;
beforeAll(async () => {
  keyPair = await window.crypto.subtle.generateKey(
    {
      name: "ECDSA",
      namedCurve: "P-384",
    },
    true,
    ["sign", "verify"]
  );
  documentKey;
});

describe("sign and verify", () => {
  test.each([
    [new Uint8Array([11, 12, 250]), keyPair.privateKey, keyPair.publicKey],
    [{ 123: 234, 345: 567 }, '{"123":234,"345":567}'],
  ])(`serialize object to string`, async (data, privKey, pubKey) => {
    const sig = await auth.sign(data, privKey);
    expect(await auth.verify(data, pubKey, sig)).toBe(true);
  });
});

// describe('encrypt and decrypt', () => {
//   test.each([
//     [test_string, test_string_as_u8_array]
//   ])
//   ('encode string to Uint8Array', () =>{
//   expect(json_serializer.encode(test_string))
//     .toStrictEqual(test_string_as_u8_array);
// })

// test('decode Uint8Array to string', () =>{
//   expect(json_serializer.decode(test_string_as_u8_array))
//     .toMatch(test_string);
// })})
