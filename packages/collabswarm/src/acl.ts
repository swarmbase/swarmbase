export interface ACL<ChangesType, PublicKey> {
  add(publicKey: PublicKey): Promise<ChangesType>;
  remove(publicKey: PublicKey): Promise<ChangesType>;
  current(): ChangesType;
  merge(change: ChangesType): void;
  check(publicKey: PublicKey): Promise<boolean>;
}
