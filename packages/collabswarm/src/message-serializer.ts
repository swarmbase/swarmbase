/**
 * MessageSerializer provides serialization/deserialization methods for `CRDTSyncMessage`s.
 *
 * @tparam MessageType Type of CRDT document. CRDT implementation dependent.
 */
export interface MessageSerializer<MessageType> {
  serializeMessage(message: MessageType): Uint8Array;
  deserializeMessage(message: Uint8Array): MessageType;
}
