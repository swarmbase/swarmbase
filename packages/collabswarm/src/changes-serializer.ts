import { CRDTChangeBlock } from "./crdt-change-block";

export interface ChangesSerializer<ChangesType> {
  serializeChanges(changes: ChangesType): Uint8Array;
  deserializeChanges(changes: Uint8Array): ChangesType;
  serializeChangeBlock(changes: CRDTChangeBlock<ChangesType>): string;
  deserializeChangeBlock(changes: string): CRDTChangeBlock<ChangesType>;
}
