import { Action } from "redux";
import { WikiSwarmArticle } from "./models";
import { AutomergeSwarmActions } from "./utils";


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
  AutomergeSwarmActions<WikiSwarmArticle> |
  SearchAction;
