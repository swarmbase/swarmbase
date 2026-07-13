import React from 'react';
import { createRoot } from 'react-dom/client';
import 'bootstrap/dist/css/bootstrap.css'
import './index.css';
import App from './App';
import { Provider } from 'react-redux';
import { createStore, applyMiddleware, Middleware } from 'redux';
import { createRootReducer } from './reducers';
import { thunk } from 'redux-thunk';
import { BrowserRouter } from 'react-router-dom';

const logger: Middleware = store => next => action => {
  console.log('dispatching', action);
  let result = next(action);
  console.log('next state', store.getState());
  return result;
}

const userKeyPair = (await crypto.subtle.generateKey(
  { name: 'ECDSA', namedCurve: 'P-384' },
  true,
  ['sign', 'verify'],
)) as CryptoKeyPair;
const store = createStore(
  createRootReducer(userKeyPair.privateKey, userKeyPair.publicKey),
  applyMiddleware(thunk, logger),
);

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error('Missing #root element');
}

createRoot(rootElement).render(
  <Provider store={store}>
    <React.StrictMode>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </React.StrictMode>
  </Provider>,
);
