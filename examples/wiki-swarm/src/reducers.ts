import { combineReducers, CombinedState } from "redux";
import { automergeSwarmReducer, AutomergeSwarmState, AutomergeSwarmActions } from "@robotoer/automerge-swarm-redux";
import { WikiSwarmArticle } from "./models";
import { WikiSwarmActions, SEARCH } from "./actions";
import { EditorState } from "draft-js";

export interface WikiAppState {
  editorState: EditorState;
}

export const wikiAppInitialState: WikiAppState = {
  editorState: EditorState.createEmpty(),
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
  automergeSwarm: automergeSwarmReducer as (state: AutomergeSwarmState<WikiSwarmArticle> | undefined, action: AutomergeSwarmActions) => AutomergeSwarmState<WikiSwarmArticle>,
  wikiApp: wikiAppReducer,
});

export function selectAutomergeSwarmState(rootState: RootState): AutomergeSwarmState<WikiSwarmArticle> {
  return rootState.automergeSwarm;
}
