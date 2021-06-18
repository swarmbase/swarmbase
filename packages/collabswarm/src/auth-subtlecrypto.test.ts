import { it, beforeAll, describe, expect, test } from "@jest/globals";
import { SubtleCrypto } from "./auth-subtlecrypto";

const auth = new SubtleCrypto();

const privateKeyData1 = {"key_ops":["sign"],"ext":true,"kty":"EC","x":"iV0DESMDz3fcubTpUCMK4YLWbU9gDslDgdflc5OGrQVII_wCViDdqGbMTOmQLY0F","y":"CQyfju2lK2mT0TIVDI-olIqFC3m3AayX0deHkw4JPCU-GwzV9k0BT295OSQ495kK","d":"kr28U5k3zRtFMXAQuoUZgmqnpI0w01p9sh0spOXZBnkc6Ez6rdbN2W6ZcAJBXxge","crv":"P-384"};
const publicKeyData1 = {"key_ops":["verify"],"ext":true,"kty":"EC","x":"iV0DESMDz3fcubTpUCMK4YLWbU9gDslDgdflc5OGrQVII_wCViDdqGbMTOmQLY0F","y":"CQyfju2lK2mT0TIVDI-olIqFC3m3AayX0deHkw4JPCU-GwzV9k0BT295OSQ495kK","crv":"P-384"};
const privateKeyData2 = {"key_ops":["sign"],"ext":true,"kty":"EC","x":"oodHRfDRDsXcpe2FvwctaK1y4pt8Lhx5tmiXZ-35vzXuDUD5zWhzPxgC8FZvyY0K","y":"KhgG-mU2-mNbhgdK9_8nEMwPa2_bWWl_zlqY6Q4xuXYMOjhSLGydbFIDSAGBaNaJ","d":"ZtP5zRvBLPK82BAwNs49-Y9227v2vtSdwhgUgH965LTdyZ-9R3qTQEPS7F6vwhyM","crv":"P-384"};
const publicKeyData2 = {"key_ops":["verify"],"ext":true,"kty":"EC","x":"oodHRfDRDsXcpe2FvwctaK1y4pt8Lhx5tmiXZ-35vzXuDUD5zWhzPxgC8FZvyY0K","y":"KhgG-mU2-mNbhgdK9_8nEMwPa2_bWWl_zlqY6Q4xuXYMOjhSLGydbFIDSAGBaNaJ","crv":"P-384"};

async function importKey(
  keyData: JsonWebKey,
  usage: KeyUsage[] = ['sign', 'verify'],
  format = 'jwk',
  namedCurve = "P-384",
) {
  const key = await crypto.subtle.importKey(format, keyData, {
    name: 'ECDSA',
    namedCurve
  }, true, usage);
  return key;
}

// try keys generated with different algos
describe("sign and verify", () => {
  test.only.each([
    [
      new Uint8Array([11, 12, 250]),
      privateKeyData1,
      publicKeyData1,
      true,
			false,
			false,
    ],
    [
      new Uint8Array([11, 44, 250]),
      privateKeyData1,
      publicKeyData2,
      false,
			false,
			false,
    ],
    [
      new Uint8Array([11, 44, 250]),
      publicKeyData1,
      publicKeyData1,
      false,
			true,
			false
    ],
		[
      new Uint8Array([11, 44, 250]),
      privateKeyData1,
      privateKeyData1,
      false,
			false,
			true
    ],
  ])(`sign and verify`, async (data: Uint8Array, privateKeyData: JsonWebKey, publicKeyData: JsonWebKey, success: boolean, expectedSignCrashed: boolean, expectedVerifyCrashed: boolean) => {
    const privateKey = await importKey(privateKeyData, ['sign']);
    const publicKey = await importKey(publicKeyData, ['verify']);
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
  });
});

// describe("encrypt and decrypt", async () => {
//   const documentKey = await crypto.subtle.generateKey(
//     {
//       name: "AES-GCM",
//       length: 256,
//     },
//     true,
//     ["encrypt", "decrypt"]
//   );
//   test.each([[new Uint8Array([11, 12, 250]), documentKey]])(
//     "encrypt and decrypt",
//     async (data, documentKey) => {
//       const res = await auth.encrypt(data, documentKey);
//       expect(await auth.decrypt(res.ciphertext, documentKey, res.iv)).toMatch(
//         data
//       );
//     }
//   );
// });
