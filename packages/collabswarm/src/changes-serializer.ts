import { CRDTChangeBlock } from './crdt-change-block';

/**
 * ChangesSerializer provides serialization/deserialization methods for `CRDTChangeBlock`s and Changes.
 *
 * @tparam ChangesType Type describing changes to a CRDT document. CRDT implementation dependent.
 */
export interface ChangesSerializer<ChangesType> {
  serializeChanges(changes: ChangesType): Uint8Array;
  deserializeChanges(changes: Uint8Array): ChangesType;
  serializeChangeBlock(changes: CRDTChangeBlock<ChangesType>): string;
  deserializeChangeBlock(changes: string): CRDTChangeBlock<ChangesType>;
}
