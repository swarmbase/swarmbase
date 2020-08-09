import { Action } from "redux";
import { AutomergeSwarmActions } from "@robotoer/automerge-swarm-redux";


export const SEARCH = 'WIKI_SWARM_SEARCH';
export interface SearchAction extends Action<typeof SEARCH> {
  query: string;
}
export function search(query: string): SearchAction {
  return {
    type: SEARCH,
    query,
  };
}

export type WikiSwarmActions =
  AutomergeSwarmActions |
  SearchAction;
