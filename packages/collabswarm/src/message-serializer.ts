import { CRDTSyncMessage } from './crdt-sync-message';

/**
 * MessageSerializer provides serialization/deserialization methods for `CRDTSyncMessage`s.
 *
 * @tparam ChangesType Type describing changes made to a CRDT document. CRDT implementation dependent.
 */
export interface MessageSerializer<ChangesType> {
  serializeMessage(message: CRDTSyncMessage<ChangesType>): Uint8Array;
  deserializeMessage(message: Uint8Array): CRDTSyncMessage<ChangesType>;
}
