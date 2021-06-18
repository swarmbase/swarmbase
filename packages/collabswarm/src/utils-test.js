// https://nodejs.org/api/webcrypto.html#webcrypto_exporting_and_importing_keys

const { webcrypto } = require("crypto");

async function generateAndExportHmacKey() {
  const key = await webcrypto.subtle.generateKey(
    {
      name: "ECDSA",
      namedCurve: "P-384",
    },
    true,
    ["sign", "verify"]
  );
  return [
    await webcrypto.subtle.exportKey("jwk", key.privateKey),
    await webcrypto.subtle.exportKey("jwk", key.publicKey),
  ];
}

async function importHmacKey(keyData, format = "jwk", hash = "SHA-512") {
  const key = await webcrypto.subtle.importKey(
    format,
    keyData,
    {
      name: "HMAC",
      hash,
    },
    true,
    ["sign", "verify"]
  );

  return key;
}

async function importSymmetricKey(keyData, format = "jwk", hash = "SHA-512") {
  const key = await webcrypto.subtle.importKey(
    format,
    keyData,
    "AES-GCM",
    true,
    ["encrypt", "decrypt"]
  );

  return key;
}

async function generateAndExportSymmetricKey() {
  const documentKey = await webcrypto.subtle.generateKey(
    {
      name: "AES-GCM",
      length: 256,
    },
    true,
    ["encrypt", "decrypt"]
  );
  return await webcrypto.subtle.exportKey("jwk", documentKey);
}

(async function main() {
  // Pair
  // const [privateKey, publicKey] = await generateAndExportHmacKey();
  // console.log(JSON.stringify(privateKey));
  // console.log(JSON.stringify(publicKey));

  // Symmetric
  const documentKey = await generateAndExportSymmetricKey();
  console.log(JSON.stringify(documentKey));
})();
