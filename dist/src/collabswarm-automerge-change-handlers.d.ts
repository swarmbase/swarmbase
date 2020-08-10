import { Doc } from "automerge";
export declare type AutomergeSwarmDocumentChangeHandler<T = any> = (current: Doc<T>, hashes: string[]) => void;
