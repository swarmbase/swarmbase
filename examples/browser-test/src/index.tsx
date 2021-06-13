import React from 'react';
import ReactDOM from 'react-dom';
import 'jsoneditor/dist/jsoneditor.css';
import 'jsoneditor-react/es/editor.css';
import './index.css';
import App from './App';
import * as serviceWorker from './serviceWorker';
import { Provider } from 'react-redux';
import { createStore, applyMiddleware, Middleware } from 'redux';
import { collabswarmReducer } from '@collabswarm/collabswarm-redux';
import { AutomergeJSONSerializer, AutomergeProvider } from '@collabswarm/collabswarm-automerge';
import thunk from 'redux-thunk';
import { AutomergeSwarmActions, AutomergeSwarmState } from './utils';

const logger: Middleware = store => next => action => {
  console.log('dispatching', action);
  let result = next(action);
  console.log('next state', store.getState());
  return result;
}

const store = createStore<AutomergeSwarmState<any>, AutomergeSwarmActions<any>, unknown, unknown>(
  collabswarmReducer(new AutomergeProvider(), new AutomergeJSONSerializer(), new AutomergeJSONSerializer()),
  applyMiddleware(thunk, logger),
);

ReactDOM.render(
  <Provider store={store}>
    <React.StrictMode>
      <App />
    </React.StrictMode>
  </Provider>,
  document.getElementById('root')
);

// If you want your app to work offline and load faster, you can change
// unregister() to register() below. Note this comes with some pitfalls.
// Learn more about service workers: https://bit.ly/CRA-PWA
serviceWorker.unregister();
