import { ACL } from './acl';

export interface ACLProvider<ChangesType, PublicKey> {
  initialize(): ACL<ChangesType, PublicKey>;
}
