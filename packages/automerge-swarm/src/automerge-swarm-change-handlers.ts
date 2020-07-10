import { Doc } from "automerge";

export type AutomergeSwarmDocumentChangeHandler<T = any> = (current: Doc<T>, hashes: string[]) => void;
