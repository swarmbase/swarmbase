import {
  CollabswarmActions,
  CollabswarmState,
} from '@swarmbase/collabswarm-redux';
import { Doc, BinaryChange } from '@automerge/automerge';

export type AutomergeSwarmState<T = any> = CollabswarmState<
  Doc<T>,
  BinaryChange[],
  (doc: T) => void,
  CryptoKey,
  CryptoKey,
  CryptoKey
>;
export type AutomergeSwarmActions<T = any> = CollabswarmActions<
  Doc<T>,
  BinaryChange[],
  (doc: T) => void,
  CryptoKey,
  CryptoKey,
  CryptoKey
>;
