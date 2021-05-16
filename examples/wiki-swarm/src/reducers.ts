import { combineReducers, CombinedState } from "redux";
import { WikiSwarmArticle } from "./models";
import { WikiSwarmActions, SEARCH } from "./actions";
import { AutomergeSwarmActions, AutomergeSwarmState } from "./utils";
import { collabswarmReducer } from "@collabswarm/collabswarm-redux";
import { AutomergeProvider } from "@collabswarm/collabswarm-automerge";

export interface WikiAppState {
}

export const wikiAppInitialState: WikiAppState = {
};

export function wikiAppReducer(state: WikiAppState = wikiAppInitialState, action: any): WikiAppState {
  switch (action.type) {
    case SEARCH: {
      return {
        ...state
      };
    }
    default: {
      return state;
    }
  }
}

export type RootState = CombinedState<{
  automergeSwarm: AutomergeSwarmState<WikiSwarmArticle>;
  wikiApp: WikiAppState;
}>

export const rootReducer: (state: RootState | undefined, action: WikiSwarmActions) => RootState = combineReducers({
  // automergeSwarm: collabswarmReducer(new AutomergeProvider<WikiSwarmArticle>()),
  automergeSwarm: collabswarmReducer(new AutomergeProvider()) as (state: AutomergeSwarmState<WikiSwarmArticle> | undefined, action: AutomergeSwarmActions) => AutomergeSwarmState<WikiSwarmArticle>,
  wikiApp: wikiAppReducer,
});

export function selectAutomergeSwarmState(rootState: RootState): AutomergeSwarmState<WikiSwarmArticle> {
  return rootState.automergeSwarm;
}
