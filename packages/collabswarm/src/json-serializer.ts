import { ChangesSerializer } from './changes-serializer';
import { CRDTChangeBlock } from './crdt-change-block';
import { CRDTSyncMessage } from './crdt-sync-message';
import { MessageSerializer } from './message-serializer';

export class JSONSerializer<ChangesType>
  implements ChangesSerializer<ChangesType>, MessageSerializer<ChangesType> {
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
    return this.serialize(changes);
  }
  deserializeChangeBlock(changes: string): CRDTChangeBlock<ChangesType> {
    return this.deserialize(changes);
  }
  serializeMessage(message: CRDTSyncMessage<ChangesType>): Uint8Array {
    return this.encode(this.serialize(message));
  }
  deserializeMessage(message: Uint8Array): CRDTSyncMessage<ChangesType> {
    return this.deserialize(this.decode(message));
  }
}
