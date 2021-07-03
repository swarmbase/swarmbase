import { ACL } from './acl';

/**
 * Factory for ACL objects.
 * 
 * @tparam ChangesType A block of CRDT change(s).
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
