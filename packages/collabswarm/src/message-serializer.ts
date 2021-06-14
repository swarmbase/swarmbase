export interface MessageSerializer<MessageType> {
  serializeMessage(message: MessageType): Uint8Array;
  deserializeMessage(message: Uint8Array): MessageType;
}
