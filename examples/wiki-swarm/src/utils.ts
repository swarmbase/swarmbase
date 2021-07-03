import { Collabswarm, CollabswarmDocument } from "@collabswarm/collabswarm";
import {
  CollabswarmActions,
  CollabswarmState,
} from "@collabswarm/collabswarm-redux";
import { Doc, BinaryChange } from "automerge";

export type AutomergeSwarm<T = any> = Collabswarm<
  Doc<T>,
  BinaryChange[],
  (doc: T) => void,
  CryptoKey,
  CryptoKey,
  CryptoKey
>;
export type AutomergeSwarmDocument<T = any> = CollabswarmDocument<
  Doc<T>,
  BinaryChange[],
  (doc: T) => void,
  CryptoKey,
  CryptoKey,
  CryptoKey
>;
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
