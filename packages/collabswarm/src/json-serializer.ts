import { Base64 } from 'js-base64';
import { ChangesSerializer } from './changes-serializer';
import { CRDTChangeBlock } from './crdt-change-block';
import { CRDTLoadRequest } from './crdt-load-request';
import { CRDTSyncMessage } from './crdt-sync-message';
import { LoadMessageSerializer } from './load-request-serializer';
import { SyncMessageSerializer } from './sync-message-serializer';

export class JSONSerializer<ChangesType>
  implements
    ChangesSerializer<ChangesType>,
    SyncMessageSerializer<ChangesType>,
    LoadMessageSerializer
{
  serialize(message: any): string {
    return JSON.stringify(message);
  }
  deserialize(message: string): any {
    try {
      return JSON.parse(message);
    } catch (err) {
      console.error('Failed to parse message:', message, err);
      throw err;
    }
  }

  encode(message: string): Uint8Array {
    const encoder = new TextEncoder();
    return encoder.encode(message);
  }
  decode(message: Uint8Array): string {
    const decoder = new TextDecoder();
    return decoder.decode(message);
  }

  serializeChanges(changes: ChangesType): Uint8Array {
    return this.encode(this.serialize(changes));
  }
  deserializeChanges(changes: Uint8Array): ChangesType {
    return this.deserialize(this.decode(changes));
  }
  serializeChangeBlock(changes: CRDTChangeBlock<ChangesType>): string {
    return this.serialize({
      changes: changes.changes,
      nonce: Base64.fromUint8Array(changes.nonce),
    });
  }
  deserializeChangeBlock(changes: string): CRDTChangeBlock<ChangesType> {
    const deserialized = this.deserialize(changes);
    return {
      ...deserialized,
      nonce: Base64.toUint8Array(deserialized.nonce),
    };
  }
  serializeSyncMessage(message: CRDTSyncMessage<ChangesType>): Uint8Array {
    return this.encode(this.serialize(message));
  }
  deserializeSyncMessage(message: Uint8Array): CRDTSyncMessage<ChangesType> {
    return this.deserialize(this.decode(message));
  }
  serializeLoadRequest(message: CRDTLoadRequest): Uint8Array {
    return this.encode(this.serialize(message));
  }
  deserializeLoadRequest(message: Uint8Array): CRDTLoadRequest {
    return this.deserialize(this.decode(message));
  }
}
