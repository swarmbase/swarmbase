import { AutomergeSwarmSyncMessage } from "@collabswarm/collabswarm-automerge";
import { CollabswarmActions, CollabswarmState } from "@collabswarm/collabswarm-redux";
import { Doc, Change } from "automerge";

export type AutomergeSwarmState<T = any> = CollabswarmState<Doc<T>, Change[], (doc: T) => void, AutomergeSwarmSyncMessage>;
export type AutomergeSwarmActions<T = any> = CollabswarmActions<Doc<T>, Change[], (doc: T) => void, AutomergeSwarmSyncMessage>;
