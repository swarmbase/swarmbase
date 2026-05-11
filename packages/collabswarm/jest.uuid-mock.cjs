// CJS shim for the `uuid` package so Jest (which still loads test deps as
// CJS) can resolve `import * as uuid from 'uuid'` even after uuid dropped
// CommonJS support in v12 (still ESM-only through v14). Implements just the
// surface collabswarm uses:
//   - `v4()` — random UUID string
//   - `parse(uuid)` — UUID string -> Uint8Array(16)
//   - `stringify(bytes)` — Uint8Array(16) -> UUID string
const { randomUUID, randomFillSync } = require('crypto');

function v4() {
  if (typeof randomUUID === 'function') {
    return randomUUID();
  }
  const bytes = new Uint8Array(16);
  randomFillSync(bytes);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  return stringify(bytes);
}

function parse(uuid) {
  if (typeof uuid !== 'string') {
    throw new TypeError('Invalid UUID');
  }
  const hex = uuid.replace(/-/g, '');
  if (hex.length !== 32 || !/^[0-9a-fA-F]{32}$/.test(hex)) {
    throw new TypeError(`Invalid UUID: ${uuid}`);
  }
  const bytes = new Uint8Array(16);
  for (let i = 0; i < 16; i++) {
    const byte = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
    if (Number.isNaN(byte)) {
      // Defensive: the regex above should already prevent this.
      throw new TypeError(`Invalid UUID: ${uuid}`);
    }
    bytes[i] = byte;
  }
  return bytes;
}

function stringify(bytes) {
  if (
    !bytes ||
    typeof bytes.length !== 'number' ||
    typeof bytes[0] === 'undefined'
  ) {
    throw new TypeError('Invalid byte array passed to stringify');
  }
  if (bytes.length < 16) {
    throw new RangeError(
      `stringify expects at least 16 bytes, got ${bytes.length}`,
    );
  }
  const hex = [];
  for (let i = 0; i < 16; i++) {
    hex.push(bytes[i].toString(16).padStart(2, '0'));
  }
  return (
    `${hex.slice(0, 4).join('')}-` +
    `${hex.slice(4, 6).join('')}-` +
    `${hex.slice(6, 8).join('')}-` +
    `${hex.slice(8, 10).join('')}-` +
    `${hex.slice(10, 16).join('')}`
  );
}

module.exports = { v4, parse, stringify };
