import BufferList from "bl";

export function shuffleArray<T=any>(array: T[]) {
  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
}

// HACK:
export function isBufferList(input: Uint8Array | BufferList): boolean {
  return !!Object.getOwnPropertySymbols(input).find((s) => {
    return String(s) === "Symbol(BufferList)";
  });
}

export async function readUint8Iterable(iterable: AsyncIterable<Uint8Array | BufferList>): Promise<Uint8Array> {
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

  return assembled
}
