/**
 * DocumentKeySerializer provides serialization/deserialization methods for document
 * encryption keys.
 *
 * @tparam DocumentKey Type describing a document encryption key.
 */
export interface KeySerializer<DocumentKey> {
  serializeKey(key: DocumentKey): Promise<Uint8Array>;
  deserializeKey(key: Uint8Array): Promise<DocumentKey>;
}
