import { ACL } from './acl';

/**
 * Factory for ACL objects.
 * 
 * @tparam ChangesType Type of a change record.
 * @tparam PublicKey Type of a user's public key.
 */
export interface ACLProvider<ChangesType, PublicKey> {
  /**
   * Construct a new ACL object.
   * 
   * @return A new ACL object.
   */
  initialize(): ACL<ChangesType, PublicKey>;
}
