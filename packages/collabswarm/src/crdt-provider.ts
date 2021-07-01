/**
 * The crdt provider provides an implementation of a set of methods for interacting with crdts generally
 */

import { CRDTSyncMessage } from './crdt-sync-message';

/**
 * CRDTProvider is an interface with a set of methods for manipulating CRDT documents.
 *
 * @tparam DocType The CRDT document type
 * @tparam ChangesType A block of CRDT change(s)
 * @tparam ChangeFnType A function for applying changes to a document
 * @tparam MessageType The sync message that gets sent when changes are made to a document
 */
export interface CRDTProvider<
  DocType,
  ChangesType,
  ChangeFnType,
  > {
  /**
   * Create a new empty (contains the equivalent of `{}`) CRDT document.
   */
  newDocument(): DocType;

  /**
   * Apply locally made changes to provided CRDT document as defined by `changeFn`.
   *
   * @param document CRDT document to change.
   * @param message A description of the change made.
   * @param changeFn A function that modifies a CRDT document (provided as a parameter).
   *     This function will be run as a part of `.localChange(...)`
   */
  localChange(
    document: DocType,
    message: string,
    changeFn: ChangeFnType,
  ): [DocType, ChangesType];

  /**
   * Apply CRDT document changes made by a remote peer.
   *
   * @param document CRDT document to update.
   * @param changes An object describing changes made by a peer. CRDT-specific.
   */
  remoteChange(document: DocType, changes: ChangesType): DocType;

  /**
   * Gets all changes for the document.
   *
   * @param document CRDT document to inspect.
   */
  getHistory(document: DocType): ChangesType;
}
