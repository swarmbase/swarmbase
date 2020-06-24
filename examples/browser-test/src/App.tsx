import React, { useState } from 'react';
import './App.css';
import { connectAsync, openDocumentAsync, closeDocumentAsync, changeDocumentAsync, AllActions } from './actions';
import { RootState } from './reducers';
import { connect } from 'react-redux';
import { ThunkDispatch } from 'redux-thunk';

interface AppProps {
  state: RootState;
  onConnect: (addresses: string[]) => any;
  onDocumentOpen: (documentId: string) => any;
  onDocumentClose: (documentId: string) => any;
  onDocumentChange: (documentId: string, changeFn: (current: any) => void, message?: string) => any;
}

function App({ state, onConnect, onDocumentOpen, onDocumentClose, onDocumentChange }: AppProps) {
  const [connectionAddress, setConnectionAddress] = useState('');
  const [documentId, setDocumentId] = useState('');

  return (
    <div>
      <div id="connect">
        <input type="text" value={connectionAddress} onInput={(e) => setConnectionAddress(e.currentTarget.value)} />
        <button onClick={() => onConnect([connectionAddress])}></button>
      </div>
      <div id="open">
        <input type="text" value={documentId} onInput={(e) => setDocumentId(e.currentTarget.value)} />
        <button onClick={() => onDocumentOpen(documentId)}></button>
      </div>
      <pre id="current">
        {JSON.stringify(document, null, 2)}
      </pre>
      <div id="actions">
        <button onClick={() => {
          if (state.documentId) {
            const r = Math.random().toString(36).substring(7);
            onDocumentChange(state.documentId, currentDoc => {
              currentDoc.message = r;
            });
          }
        }}></button>
      </div>
    </div>
  );
}

function mapStateToProps(state: RootState) {
  return state;
  // return {
  //   peerId: selectPeerId(state),
  //   roomId: selectRoomId(state),
  //   topics: selectTopicsQueue(state),
  //   users: selectUsers(state),
  //   usersLookup: selectUsersLookup(state),
  // };
}

function mapDispatchToProps(dispatch: ThunkDispatch<RootState, unknown, AllActions>) {
  return {
    onConnect: (addresses: string[]) => dispatch(connectAsync(addresses)),
    onDocumentOpen: (documentId: string) => dispatch(openDocumentAsync(documentId)),
    onDocumentClose: (documentId: string) => dispatch(closeDocumentAsync(documentId)),
    onDocumentChange: (documentId: string, changeFn: (current: any) => void, message?: string) => dispatch(changeDocumentAsync(documentId, changeFn, message)),
  };
}

export default connect(mapStateToProps, mapDispatchToProps)(App);
