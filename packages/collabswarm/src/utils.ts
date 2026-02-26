import BufferList from 'bl';
import type { Uint8ArrayList } from 'uint8arraylist';

export function shuffleArray<T>(array: T[]) {
  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
}

export function firstTrue(promises: Promise<boolean>[]) {
  const newPromises = promises.map(
    (p) =>
      new Promise<boolean>((resolve, reject) =>
        p.then((v) => v && resolve(true), reject),
      ),
  );
  newPromises.push(Promise.all(promises).then(() => false));
  return Promise.race(newPromises);
}

export function concatUint8Arrays(...arrs: Uint8Array[]): Uint8Array {
  const length = arrs.reduce((a, b) => a + b.length, 0);
  const newArr = new Uint8Array(length);
  let currentIndex = 0;
  for (const arr of arrs) {
    newArr.set(arr, currentIndex);
    currentIndex += arr.length;
  }
  return newArr;
}

// HACK:
export function isBufferList(input: Uint8Array | Uint8ArrayList | BufferList): boolean {
  return !!Object.getOwnPropertySymbols(input).find((s) => {
    return String(s) === 'Symbol(BufferList)';
  });
}

export async function readUint8Iterable(
  iterable: AsyncIterable<Uint8Array | Uint8ArrayList | BufferList>,
): Promise<Uint8Array> {
  let length = 0;
  const chunks = [] as (Uint8Array | Uint8ArrayList | BufferList)[];
  for await (const chunk of iterable) {
    if (chunk) {
      chunks.push(chunk);
      length += chunk.length;
    }
  }

  let index = 0;
  const assembled = new Uint8Array(length);
  for (const chunk of chunks) {
    if (isBufferList(chunk)) {
      const bufferList = chunk as BufferList;
      for (let i = 0; i < bufferList.length; i++) {
        assembled.set([bufferList.readUInt8(i)], index + i);
      }
    } else if (chunk instanceof Uint8Array) {
      assembled.set(chunk, index);
    } else {
      // Uint8ArrayList — use subarray() to get a contiguous Uint8Array
      assembled.set((chunk as Uint8ArrayList).subarray(), index);
    }
    index += chunk.length;
  }

  return assembled;
}

// CryptoKey utils

export async function generateAndExportHmacKey() {
  const key = await crypto.subtle.generateKey(
    {
      name: 'ECDSA',
      namedCurve: 'P-384',
    },
    true,
    ['sign', 'verify'],
  );
  return [
    await crypto.subtle.exportKey('jwk', key.privateKey),
    await crypto.subtle.exportKey('jwk', key.publicKey),
  ];
}

export async function importHmacKey(
  keyData: Uint8Array,
  format: Exclude<KeyFormat, 'jwk'> = 'raw',
  hash = 'SHA-512',
) {
  // Cast needed: Uint8Array<ArrayBufferLike> does not satisfy BufferSource (excludes SharedArrayBuffer)
  const key = await crypto.subtle.importKey(
    format,
    keyData as Uint8Array<ArrayBuffer>,
    {
      name: 'HMAC',
      hash,
    },
    true,
    ['sign', 'verify'],
  );

  return key;
}

export async function importSymmetricKey(
  keyData: Uint8Array,
  format: Exclude<KeyFormat, 'jwk'> = 'raw',
) {
  // Cast needed: Uint8Array<ArrayBufferLike> does not satisfy BufferSource (excludes SharedArrayBuffer)
  const key = await crypto.subtle.importKey(format, keyData as Uint8Array<ArrayBuffer>, 'AES-GCM', true, [
    'encrypt',
    'decrypt',
  ]);

  return key;
}

export async function generateAndExportSymmetricKey() {
  const documentKey = await crypto.subtle.generateKey(
    {
      name: 'AES-GCM',
      length: 256,
    },
    true,
    ['encrypt', 'decrypt'],
  );
  return await crypto.subtle.exportKey('jwk', documentKey);
}
