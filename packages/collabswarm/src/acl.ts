/**
 * An ACL keeps track of a list of user's public keys and produces changes that
 * can be sent to other swarm peers.
 * 
 * @tparam ChangesType Type of a change record.
 * @tparam PublicKey Type of a user's public key.
 */
export interface ACL<ChangesType, PublicKey> {
  /**
   * Add a new user to the ACL.
   *
   * @param publicKey User's public key.
   * @return A change record for the addition to the ACL.
   */
  add(publicKey: PublicKey): Promise<ChangesType>;

  /**
   * Remove a user from the ACL.
   * 
   * @param publicKey User's public key.
   * @return A change record for the removal from the ACL.
   */
  remove(publicKey: PublicKey): Promise<ChangesType>;

  /**
   * Gets a change record describing the current state of the ACL.
   * 
   * @return A change record describing the whole ACL.
   */
  current(): ChangesType;

  /**
   * Applies a change record to the ACL.
   * 
   * @param change A change record to apply.
   */
  merge(change: ChangesType): void;

  /**
   * Checks to see if the specified user is in the ACL already.
   * 
   * @param publicKey User's public key.
   * @return true if the user is in the ACL.
   */
  check(publicKey: PublicKey): Promise<boolean>;
}
