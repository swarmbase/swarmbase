import {
  CollabswarmActions,
  CollabswarmState,
} from "@collabswarm/collabswarm-redux";
import { Doc, BinaryChange } from "automerge";

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
