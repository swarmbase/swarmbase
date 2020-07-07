import { combineReducers, CombinedState } from "redux";
import { automergeSwarmReducer, AutomergeSwarmState, AutomergeSwarmActions } from "automerge-swarm-redux";
import { WikiSwarmArticle } from "./models";
import { WikiSwarmActions } from "./actions";

export interface WikiAppState {
  currentDocumentPath: string | null;
}

export const wikiAppInitialState: WikiAppState = {
  currentDocumentPath: null
};

export function wikiAppReducer(state: WikiAppState = wikiAppInitialState, action: any): WikiAppState {
  switch (action.type) {
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
  automergeSwarm: automergeSwarmReducer as (state: AutomergeSwarmState<WikiSwarmArticle> | undefined, action: AutomergeSwarmActions) => AutomergeSwarmState<WikiSwarmArticle>,
  wikiApp: wikiAppReducer,
});

export function selectAutomergeSwarmState(rootState: RootState): AutomergeSwarmState<WikiSwarmArticle> {
  return rootState.automergeSwarm;
}
