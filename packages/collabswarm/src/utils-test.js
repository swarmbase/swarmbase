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

(async function main() {
  const [privateKey, publicKey] = await generateAndExportHmacKey();
  console.log(JSON.stringify(privateKey));
  console.log(JSON.stringify(publicKey));
})();
