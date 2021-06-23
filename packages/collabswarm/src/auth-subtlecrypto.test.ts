import { it, beforeAll, describe, expect, test } from "@jest/globals";
import { SubtleCrypto } from "./auth-subtlecrypto";
const { webcrypto } = require("crypto");

const auth = new SubtleCrypto();

const privateKeyData1 = {
  key_ops: ["sign"],
  ext: true,
  kty: "EC",
  x: "iV0DESMDz3fcubTpUCMK4YLWbU9gDslDgdflc5OGrQVII_wCViDdqGbMTOmQLY0F",
  y: "CQyfju2lK2mT0TIVDI-olIqFC3m3AayX0deHkw4JPCU-GwzV9k0BT295OSQ495kK",
  d: "kr28U5k3zRtFMXAQuoUZgmqnpI0w01p9sh0spOXZBnkc6Ez6rdbN2W6ZcAJBXxge",
  crv: "P-384",
};
const publicKeyData1 = {
  key_ops: ["verify"],
  ext: true,
  kty: "EC",
  x: "iV0DESMDz3fcubTpUCMK4YLWbU9gDslDgdflc5OGrQVII_wCViDdqGbMTOmQLY0F",
  y: "CQyfju2lK2mT0TIVDI-olIqFC3m3AayX0deHkw4JPCU-GwzV9k0BT295OSQ495kK",
  crv: "P-384",
};
const privateKeyData2 = {
  key_ops: ["sign"],
  ext: true,
  kty: "EC",
  x: "oodHRfDRDsXcpe2FvwctaK1y4pt8Lhx5tmiXZ-35vzXuDUD5zWhzPxgC8FZvyY0K",
  y: "KhgG-mU2-mNbhgdK9_8nEMwPa2_bWWl_zlqY6Q4xuXYMOjhSLGydbFIDSAGBaNaJ",
  d: "ZtP5zRvBLPK82BAwNs49-Y9227v2vtSdwhgUgH965LTdyZ-9R3qTQEPS7F6vwhyM",
  crv: "P-384",
};
const publicKeyData2 = {
  key_ops: ["verify"],
  ext: true,
  kty: "EC",
  x: "oodHRfDRDsXcpe2FvwctaK1y4pt8Lhx5tmiXZ-35vzXuDUD5zWhzPxgC8FZvyY0K",
  y: "KhgG-mU2-mNbhgdK9_8nEMwPa2_bWWl_zlqY6Q4xuXYMOjhSLGydbFIDSAGBaNaJ",
  crv: "P-384",
};
const docKeyData1 = {
  key_ops: ["encrypt", "decrypt"],
  ext: true,
  kty: "oct",
  k: "LMP1XEE0zwpmZF0XXwFg5MYr_o5ZVpJ7vyVRyPXLC1o",
  alg: "A256GCM",
};
const docKeyData2 = {
  key_ops: ["encrypt", "decrypt"],
  ext: true,
  kty: "oct",
  k: "3TX-u2qZ6XAdIXL31LYVdUnspykU6J4DbQtYssWswKs",
  alg: "A256GCM",
};

/**
 * Expects format is jwk and type is either ECDSA or AES-GCM
 * which are the two default choices.
 */
async function importKey(
  keyData: JsonWebKey,
  usage: KeyUsage = ["sign", "verify"],
  algorithmName = "ECDSA",
  format = "jwk"
) {
  let algorithm: { name: string } | EcKeyImportParams;
  switch (algorithmName) {
    case "ECDSA": {
      algorithm = {
        name: algorithmName,
        namedCurve: "P-384",
      };
      break;
    }
    case "AES-GCM": {
      algorithm = {
        name: algorithmName,
      };
      break;
    }
    default: {
      throw "Error in key import. Is algorithm type supported?"!;
    }
  }
  const key = await webcrypto.subtle.importKey(
    format,
    keyData,
    algorithm,
    true,
    usage
  );
  return key;
}

// TODO try keys generated with different algos
describe("sign and verify", () => {
  test.each([
    [
      new Uint8Array([11, 12, 250]),
      privateKeyData1,
      publicKeyData1,
      true,
      false,
      false,
    ],
    // [
    //   new Uint8Array([11, 44, 250]),
    //   privateKeyData1,
    //   publicKeyData2,
    //   false,
    //   false,
    //   false,
    // ],
    // [
    //   new Uint8Array([11, 44, 250]),
    //   publicKeyData1,
    //   publicKeyData1,
    //   false,
    //   true,
    //   false,
    // ],
    // [
    //   new Uint8Array([11, 44, 250]),
    //   privateKeyData1,
    //   privateKeyData1,
    //   false,
    //   false,
    //   true,
    // ],
  ])(
    `sign and verify`,
    async (
      data: Uint8Array,
      privateKeyData: JsonWebKey,
      publicKeyData: JsonWebKey,
      success: boolean,
      expectedSignCrashed: boolean,
      expectedVerifyCrashed: boolean
    ) => {
      const privateKey = await importKey(privateKeyData, ["sign"]);
      const publicKey = await importKey(publicKeyData, ["verify"]);
      let signCrashed = false;
      let sig: Uint8Array | undefined;
      try {
        sig = await auth.sign(data, privateKey);
      } catch {
        signCrashed = true;
      }
      expect(signCrashed).toBe(expectedSignCrashed);
      if (sig !== undefined) {
        let verifyCrashed = false;
        let result: boolean | undefined;
        try {
          result = await auth.verify(data, publicKey, sig);
        } catch {
          verifyCrashed = true;
        }
        expect(verifyCrashed).toBe(expectedVerifyCrashed);
        if (result !== undefined) {
          expect(result).toBe(success);
        }
      }
    }
  );
});

/**
 * Check working by encrypting and decrypting the same data.
 * Use static keys.
 * Confirm type expectations.
 */
describe("encrypt and decrypt", () => {
  test.each([
    [new Uint8Array([43, 99, 250, 83]), docKeyData1, false, false],
    [new Uint8Array([43, 99, 250, 83, 89, 90, 111]), docKeyData2, false, false],
    [new Uint16Array([43, 99, 250, 83, 89, 90, 111]), docKeyData2, true, true],
  ])(
    "encrypt and decrypt",
    async (
      data: Uint8Array,
      documentKeyData: JsonWebKey,
      expectedEncryptCrashed: boolean,
      expectedDecryptCrashed: boolean
    ) => {
      const documentKey = await importKey(
        documentKeyData,
        ["encrypt", "decrypt"],
        "AES-GCM"
      );
      let encryptCrashed = false;
      let encrypted: Uint8Array | undefined;
      let nonce: Uint8Array | undefined;
      try {
        const res = await auth.encrypt(data, documentKey);
        encrypted = res.data;
        nonce = res.nonce;
      } catch {
        encryptCrashed = true;
      }
      expect(encryptCrashed).toBe(expectedEncryptCrashed);
      if (encrypted !== undefined && nonce !== undefined) {
        let decryptCrashed = false;
        let decrypted: Uint8Array | undefined;
        try {
          decrypted = await auth.decrypt(encrypted, documentKey, nonce); // TODO (eric) "nonce is used before assignment"
        } catch {
          decryptCrashed = true;
        }
        expect(decryptCrashed).toBe(expectedDecryptCrashed);
        if (decrypted !== undefined) {
          expect(decrypted).toBe(data);
        }
      }
    }
  );
});
