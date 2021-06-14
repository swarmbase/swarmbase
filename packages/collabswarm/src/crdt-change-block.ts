export interface CRDTChangeBlock<ChangesType> {
  signature?: string;
  changes: ChangesType;
}
