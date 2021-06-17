import { beforeAll, describe, expect, test } from "@jest/globals";
import { SubtleCrypto } from "./auth-subtlecrypto";

const auth = new SubtleCrypto();

let keyPair: CryptoKeyPair;
let documentKey: CryptoKey;
beforeAll(async () => {
  keyPair = await crypto.subtle.generateKey(
    {
      name: "ECDSA",
      namedCurve: "P-384",
    },
    true,
    ["sign", "verify"]
  );
  documentKey = await crypto.subtle.generateKey(
    {
      name: "AES-GCM",
      length: 256,
    },
    true,
    ["encrypt", "decrypt"]
  );
});

// try keys generated with different algos
describe("sign and verify", () => {
  test.each([
    [new Uint8Array([11, 12, 250]), keyPair.privateKey, keyPair.publicKey],
    [{ 123: 234, 345: 567 }, '{"123":234,"345":567}'],
  ])(`sign and verify`, async (data, privKey, pubKey) => {
    const sig = await auth.sign(data, privKey);
    expect(await auth.verify(data, pubKey, sig)).toBe(true);
  });
});

describe("encrypt and decrypt", () => {
  test.each([[new Uint8Array([11, 12, 250]), documentKey]])(
    "encrypt and decrypt",
    async (data, documentKey) => {
      const res = await auth.encrypt(data, documentKey);
      expect(await auth.decrypt(res.ciphertext, documentKey, res.iv)).toMatch(
        data
      );
    }
  );
});
