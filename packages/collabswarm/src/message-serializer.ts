import { CRDTSyncMessage } from "./crdt-sync-message";
import { KeySerializer } from "./key-serializer";

/**
 * MessageSerializer provides serialization/deserialization methods for `CRDTSyncMessage`s.
 *
 * @tparam ChangesType Type describing changes made to a CRDT document. CRDT implementation dependent.
 */
export interface MessageSerializer<ChangesType> {
  serializeMessage<DocumentKey>(message: CRDTSyncMessage<ChangesType, DocumentKey>, keySerializer: KeySerializer<DocumentKey>): Uint8Array;
  deserializeMessage<DocumentKey>(message: Uint8Array, keySerializer: KeySerializer<DocumentKey>): CRDTSyncMessage<ChangesType, DocumentKey>;
}
