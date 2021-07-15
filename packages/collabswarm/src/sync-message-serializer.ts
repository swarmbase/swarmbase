import { CRDTSyncMessage } from './crdt-sync-message';

/**
 * MessageSerializer provides serialization/deserialization methods for `CRDTSyncMessage`s.
 *
 * @tparam ChangesType Type describing changes made to a CRDT document. CRDT implementation dependent.
 */
export interface SyncMessageSerializer<ChangesType> {
  serializeSyncMessage(message: CRDTSyncMessage<ChangesType>): Uint8Array;
  deserializeSyncMessage(message: Uint8Array): CRDTSyncMessage<ChangesType>;
}
