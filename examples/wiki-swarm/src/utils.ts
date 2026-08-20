import { Collabswarm, CollabswarmDocument } from '@collabswarm/collabswarm';
import {
  CollabswarmActions,
  CollabswarmState,
} from '@collabswarm/collabswarm-redux';
import { Doc, Change } from '@automerge/automerge';

export type AutomergeSwarm<T = any> = Collabswarm<
  Doc<T>,
  Change[],
  (doc: T) => void,
  CryptoKey,
  CryptoKey,
  CryptoKey
>;
export type AutomergeSwarmDocument<T = any> = CollabswarmDocument<
  Doc<T>,
  Change[],
  (doc: T) => void,
  CryptoKey,
  CryptoKey,
  CryptoKey
>;
export type AutomergeSwarmState<T = any> = CollabswarmState<
  Doc<T>,
  Change[],
  (doc: T) => void,
  CryptoKey,
  CryptoKey,
  CryptoKey
>;
export type AutomergeSwarmActions<T = any> = CollabswarmActions<
  Doc<T>,
  Change[],
  (doc: T) => void,
  CryptoKey,
  CryptoKey,
  CryptoKey
>;
