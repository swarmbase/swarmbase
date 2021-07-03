/**
 * An ACL keeps track of a list of user's public keys and produces changes that
 * can be sent to other swarm peers.
 *
 * @tparam ChangesType A block of CRDT change(s).
 * @tparam PublicKey Type of a user's public key.
 */
export interface ACL<ChangesType, PublicKey> {
  /**
   * Add a new user to the ACL.
   *
   * @param publicKey User's public key.
   * @return A block of change(s) for the addition to the ACL.
   */
  add(publicKey: PublicKey): Promise<ChangesType>;

  /**
   * Remove a user from the ACL.
   *
   * @param publicKey User's public key.
   * @return A block of change(s) for the removal from the ACL.
   */
  remove(publicKey: PublicKey): Promise<ChangesType>;

  /**
   * Gets a block of change(s) describing the current state of the ACL.
   *
   * @return A block of change(s) describing the whole ACL.
   */
  current(): ChangesType;

  /**
   * Applies a block of change(s) to the ACL.
   *
   * @param changes A block of change(s) to apply.
   */
  merge(changes: ChangesType): void;

  /**
   * Checks to see if the specified user is in the ACL already.
   *
   * @param publicKey User's public key.
   * @return true if the user is in the ACL.
   */
  check(publicKey: PublicKey): Promise<boolean>;
}
