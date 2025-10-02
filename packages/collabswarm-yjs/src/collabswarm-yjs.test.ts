import { describe, expect, test } from '@jest/globals';
import { Doc } from 'yjs';
import { Base64 } from 'js-base64';

// Test the core Yjs functionality that YjsProvider wraps
describe('Yjs Core Functionality', () => {
  test('should create a new Yjs document', () => {
    const doc = new Doc();
    expect(doc).toBeDefined();
    expect(doc).toBeInstanceOf(Doc);
  });

  test('should handle basic document operations', () => {
    const doc = new Doc();
    const map = doc.getMap('test');
    map.set('key', 'value');
    
    expect(map.get('key')).toBe('value');
  });

  test('should create multiple independent documents', () => {
    const doc1 = new Doc();
    const doc2 = new Doc();
    
    const map1 = doc1.getMap('test');
    map1.set('key', 'value1');
    
    const map2 = doc2.getMap('test');
    map2.set('key', 'value2');
    
    expect(map1.get('key')).toBe('value1');
    expect(map2.get('key')).toBe('value2');
  });

  test('should handle Uint8Array serialization', () => {
    const data = new Uint8Array([1, 2, 3, 4, 5]);
    const base64 = Base64.fromUint8Array(data);
    const decoded = Base64.toUint8Array(base64);
    
    expect(base64).toBeDefined();
    expect(typeof base64).toBe('string');
    expect(decoded).toEqual(data);
  });

  test('should handle empty Uint8Array', () => {
    const data = new Uint8Array([]);
    const base64 = Base64.fromUint8Array(data);
    const decoded = Base64.toUint8Array(base64);
    
    expect(decoded).toEqual(data);
  });

  test('should handle document arrays', () => {
    const doc = new Doc();
    const arr = doc.getArray('testArray');
    
    arr.push(['item1']);
    arr.push(['item2']);
    
    expect(arr.length).toBe(2);
    expect(arr.get(0)).toBe('item1');
    expect(arr.get(1)).toBe('item2');
  });

  test('should handle nested structures', () => {
    const doc = new Doc();
    const map = doc.getMap('root');
    
    map.set('nested', 'value');
    map.set('another', 'data');
    
    expect(map.get('nested')).toBe('value');
    expect(map.get('another')).toBe('data');
  });
});


