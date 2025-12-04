import { describe, expect, test } from '@jest/globals';
import {
  shuffleArray,
  firstTrue,
  concatUint8Arrays,
  generateAndExportHmacKey,
  generateAndExportSymmetricKey,
  importHmacKey,
  importSymmetricKey,
} from './utils';

describe('shuffleArray', () => {
  test('should shuffle array elements', () => {
    const arr = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    const original = [...arr];
    shuffleArray(arr);
    // Array should have same elements but potentially in different order
    expect(arr.sort()).toEqual(original.sort());
    expect(arr.length).toBe(original.length);
  });

  test('should handle empty array', () => {
    const arr: number[] = [];
    shuffleArray(arr);
    expect(arr).toEqual([]);
  });

  test('should handle single element array', () => {
    const arr = [1];
    shuffleArray(arr);
    expect(arr).toEqual([1]);
  });
});

describe('firstTrue', () => {
  test('should resolve with true when first promise resolves true', async () => {
    const promises = [
      Promise.resolve(true),
      Promise.resolve(false),
      Promise.resolve(false),
    ];
    const result = await firstTrue(promises);
    expect(result).toBe(true);
  });

  test('should resolve with false when all promises resolve false', async () => {
    const promises = [
      Promise.resolve(false),
      Promise.resolve(false),
      Promise.resolve(false),
    ];
    const result = await firstTrue(promises);
    expect(result).toBe(false);
  });

  test('should handle empty promise array', async () => {
    const promises: Promise<boolean>[] = [];
    const result = await firstTrue(promises);
    expect(result).toBe(false);
  });
});

describe('concatUint8Arrays', () => {
  test('should concatenate multiple Uint8Array', () => {
    const arr1 = new Uint8Array([1, 2, 3]);
    const arr2 = new Uint8Array([4, 5, 6]);
    const arr3 = new Uint8Array([7, 8, 9]);
    const result = concatUint8Arrays(arr1, arr2, arr3);
    expect(result).toEqual(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9]));
  });

  test('should handle empty arrays', () => {
    const arr1 = new Uint8Array([]);
    const arr2 = new Uint8Array([1, 2]);
    const result = concatUint8Arrays(arr1, arr2);
    expect(result).toEqual(new Uint8Array([1, 2]));
  });

  test('should handle single array', () => {
    const arr = new Uint8Array([1, 2, 3]);
    const result = concatUint8Arrays(arr);
    expect(result).toEqual(arr);
  });

  test('should handle no arrays', () => {
    const result = concatUint8Arrays();
    expect(result).toEqual(new Uint8Array([]));
  });
});

describe('crypto key utilities', () => {
  test('should generate and export HMAC key pair', async () => {
    const [privateKey, publicKey] = await generateAndExportHmacKey();
    expect(privateKey).toBeDefined();
    expect(publicKey).toBeDefined();
    expect(privateKey.kty).toBe('EC');
    expect(publicKey.kty).toBe('EC');
    expect(privateKey.crv).toBe('P-384');
    expect(publicKey.crv).toBe('P-384');
  });

  test('should generate and export symmetric key', async () => {
    const key = await generateAndExportSymmetricKey();
    expect(key).toBeDefined();
    expect(key.kty).toBe('oct');
    expect(key.alg).toBe('A256GCM');
  });

  test('should import HMAC key from raw data', async () => {
    const keyData = new Uint8Array(32);
    crypto.getRandomValues(keyData);
    const key = await importHmacKey(keyData);
    expect(key).toBeDefined();
    expect(key.type).toBe('secret');
  });

  test('should import symmetric key from raw data', async () => {
    const keyData = new Uint8Array(32);
    crypto.getRandomValues(keyData);
    const key = await importSymmetricKey(keyData);
    expect(key).toBeDefined();
    expect(key.type).toBe('secret');
  });
});
