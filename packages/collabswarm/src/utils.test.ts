import {
  shuffleArray,
  firstTrue,
  concatUint8Arrays,
  isBufferList,
  readUint8Iterable,
  generateAndExportHmacKey,
  importHmacKey,
  importSymmetricKey,
  generateAndExportSymmetricKey,
} from './utils';
import BufferList from 'bl';

describe('utils', () => {
  describe('shuffleArray', () => {
    it('should shuffle the array', () => {
      const original = [1, 2, 3, 4, 5];
      const shuffled = [...original];
      shuffleArray(shuffled);
      expect(shuffled).not.toEqual(original);
      expect(shuffled.sort()).toEqual(original);
    });
  });

  describe('firstTrue', () => {
    it('should resolve to true when the first promise resolves to true', async () => {
      const promises = [
        Promise.resolve(false),
        Promise.resolve(true),
        Promise.resolve(false),
      ];
      const result = await firstTrue(promises);
      expect(result).toBe(true);
    });

    it('should resolve to false when all promises resolve to false', async () => {
      const promises = [
        Promise.resolve(false),
        Promise.resolve(false),
        Promise.resolve(false),
      ];
      const result = await firstTrue(promises);
      expect(result).toBe(false);
    });
  });

  describe('concatUint8Arrays', () => {
    it('should concatenate Uint8Arrays', () => {
      const arr1 = new Uint8Array([1, 2, 3]);
      const arr2 = new Uint8Array([4, 5]);
      const arr3 = new Uint8Array([6]);
      const result = concatUint8Arrays(arr1, arr2, arr3);
      expect(result).toEqual(new Uint8Array([1, 2, 3, 4, 5, 6]));
    });
  });

  describe('isBufferList', () => {
    it('should return true for BufferList instances', () => {
      const bl = new BufferList();
      expect(isBufferList(bl)).toBe(true);
    });

    it('should return false for Uint8Array instances', () => {
      const arr = new Uint8Array([1, 2, 3]);
      expect(isBufferList(arr)).toBe(false);
    });
  });

  describe('readUint8Iterable', () => {
    it('should read and concatenate Uint8Arrays from an iterable', async () => {
      const iterable = {
        async *[Symbol.asyncIterator]() {
          yield new Uint8Array([1, 2]);
          yield new Uint8Array([3, 4]);
          yield new Uint8Array([5]);
        },
      };
      const result = await readUint8Iterable(iterable);
      expect(result).toEqual(new Uint8Array([1, 2, 3, 4, 5]));
    });
  });

  describe('Crypto functions', () => {
    it('generateAndExportHmacKey should generate and export a key pair', async () => {
      const [privateKey, publicKey] = await generateAndExportHmacKey();
      expect(privateKey).toHaveProperty('kty', 'EC');
      expect(publicKey).toHaveProperty('kty', 'EC');
    });

    it('importHmacKey should import a key', async () => {
      const keyData = new Uint8Array([1, 2, 3, 4, 5]);
      const key = await importHmacKey(keyData);
      expect(key).toBeInstanceOf(CryptoKey);
    });

    it('importSymmetricKey should import a key', async () => {
      const keyData = new Uint8Array([1, 2, 3, 4, 5]);
      const key = await importSymmetricKey(keyData);
      expect(key).toBeInstanceOf(CryptoKey);
    });

    it('generateAndExportSymmetricKey should generate and export a key', async () => {
      const key = await generateAndExportSymmetricKey();
      expect(key).toHaveProperty('kty', 'oct');
    });
  });
});
