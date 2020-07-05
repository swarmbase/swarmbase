import React from 'react';
import './App.css';
import { connectAsync, openDocumentAsync, closeDocumentAsync, changeDocumentAsync, AllActions, initializeAsync } from './actions';
import { RootState } from './reducers';
import { connect } from 'react-redux';
import { ThunkDispatch } from 'redux-thunk';

interface AppProps {
  state: RootState;
  onInitialize: () => Promise<void>;
  onConnect: (addresses: string[]) => any;
  onDocumentOpen: (documentId: string) => any;
  onDocumentClose: (documentId: string) => any;
  onDocumentChange: (documentId: string, changeFn: (current: any) => void, message?: string) => any;
}

interface AppState {
  connectionAddress: string;
  documentId: string;
}

class App extends React.Component<AppProps, AppState, RootState> {
  constructor(public props: AppProps) {
    super(props)

    this.state = {
      connectionAddress: '',
      documentId: ''
    };
  }

  componentDidMount() {
    if (this.props.onInitialize) {
      this.props.onInitialize();
    }
  }

  render() {
    const ipfsInfo = this.props.state.node.ipfsInfo;

    return (
      <div>
        {/* 
        - Navbar
          - Search
          - Profile
        - Content
          - Title/Editor
          - Content/Editor
        - Footer
          - Audit info
          */}
        <div id="info">
          <div><strong>Node Addresses:</strong></div>
          <ul>
            {ipfsInfo && ipfsInfo.addresses && ipfsInfo.addresses.map((address: any, i: number) => <li key={i}><pre>{address.toString()}</pre></li>)}
          </ul>
          <div><strong>Connected Peers:</strong></div>
          <ul>
            {this.props.state.node.peerAddrs.map((address: any, i: number) => <li key={i}><pre>{address}</pre></li>)}
          </ul>
        </div>
        <div id="connect">
          <input type="text" defaultValue={this.state.connectionAddress} onChange={(e) => this.setState({ connectionAddress: e.currentTarget.value })} />
          <button onClick={() => this.props.onConnect([this.state.connectionAddress])}>Connect</button>
        </div>
        <div id="open">
          <input type="text" value={this.state.documentId} onChange={(e) => this.setState({ documentId: e.currentTarget.value })} />
          <button onClick={() => this.props.onDocumentOpen(this.state.documentId)}>Open</button>
          <button onClick={() => this.props.onDocumentClose(this.state.documentId)}>Close</button>
        </div>
        <pre id="current">
          {JSON.stringify(this.props.state.document, null, 2)}
        </pre>
        <div id="actions">
          <button onClick={() => {
            if (this.props.state.documentId) {
              const r = Math.random().toString(36).substring(7);
              console.log('Setting document message to:', r);
              this.props.onDocumentChange(this.props.state.documentId, currentDoc => {
                currentDoc.message = r;
              });
            }
          }}>Update Document</button>
        </div>
      </div>
    );
  }
}

function mapStateToProps(state: RootState) {
  return { state };
}

function mapDispatchToProps(dispatch: ThunkDispatch<RootState, unknown, AllActions>) {
  return {
    onInitialize: () => dispatch(initializeAsync()),
    onConnect: (addresses: string[]) => dispatch(connectAsync(addresses)),
    onDocumentOpen: (documentId: string) => dispatch(openDocumentAsync(documentId)),
    onDocumentClose: (documentId: string) => dispatch(closeDocumentAsync(documentId)),
    onDocumentChange: (documentId: string, changeFn: (current: any) => void, message?: string) => dispatch(changeDocumentAsync(documentId, changeFn, message)),
  };
}

export default connect(mapStateToProps, mapDispatchToProps)(App);
