import BufferList from 'bl';

export function shuffleArray<T = any>(array: T[]) {
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
export function isBufferList(input: Uint8Array | BufferList): boolean {
  return !!Object.getOwnPropertySymbols(input).find((s) => {
    return String(s) === 'Symbol(BufferList)';
  });
}

export async function readUint8Iterable(
  iterable: AsyncIterable<Uint8Array | BufferList>,
): Promise<Uint8Array> {
  let length = 0;
  const chunks = [] as (Uint8Array | BufferList)[];
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
    } else {
      const arr = chunk as Uint8Array;
      assembled.set(arr, index);
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
  format = 'jwk',
  hash = 'SHA-512',
) {
  const key = await crypto.subtle.importKey(
    format,
    keyData,
    {
      name: 'HMAC',
      hash,
    },
    true,
    ['sign', 'verify'],
  );

  return key;
}

export async function importSymmetricKey(keyData: Uint8Array, format = 'jwk') {
  const key = await crypto.subtle.importKey(format, keyData, 'AES-GCM', true, [
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
