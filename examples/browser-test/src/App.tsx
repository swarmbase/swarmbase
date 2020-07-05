import React from 'react';
import './App.css';
import { AutomergeSwarmState, connectAsync, openDocumentAsync, closeDocumentAsync, changeDocumentAsync, AutomergeSwarmActions, initializeAsync } from 'automerge-swarm-redux';
import { connect } from 'react-redux';
import { ThunkDispatch } from 'redux-thunk';
import { AnnouncementDocument } from './models';

interface AppProps {
  state: AutomergeSwarmState<AnnouncementDocument>;
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

class App extends React.Component<AppProps, AppState, AutomergeSwarmState<AnnouncementDocument>> {
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
        <div id="info">
          <div><strong>Node Addresses:</strong></div>
          <ul>
            {ipfsInfo && ipfsInfo.addresses && ipfsInfo.addresses.map((address: any, i: number) => <li key={i}><pre>{address.toString()}</pre></li>)}
          </ul>
          <div><strong>Connected Peers:</strong></div>
          <ul>
            {this.props.state.peers.map((address: string, i: number) => <li key={i}><pre>{address}</pre></li>)}
          </ul>
        </div>
        <div id="connect">
          <input type="text" defaultValue={this.state.connectionAddress} onChange={(e) => this.setState({ connectionAddress: e.currentTarget.value })} />
          <button onClick={() => this.props.onConnect([this.state.connectionAddress])}>Connect</button>
        </div>
        <div id="open">
          <input type="text" value={this.state.documentId} onChange={(e) => this.setState({ documentId: e.currentTarget.value })} />
          <button onClick={() => this.props.onDocumentOpen(this.state.documentId)}>Open</button>
        </div>
        {Object.entries(this.props.state.documents).map(([documentPath, documentState]) => <React.Fragment key={documentPath}>
          <h3>{documentPath}</h3>
          <pre>
            {JSON.stringify(documentState.document, null, 2)}
          </pre>
          <div>
            <button onClick={() => {
              const r = Math.random().toString(36).substring(7);
              console.log(`Setting the message field of document '${documentPath}' to:`, r);
              this.props.onDocumentChange(documentPath, currentDoc => {
                currentDoc.message = r;
              });
            }}>Update Document</button>
            <button onClick={() => {
              this.props.onDocumentClose(documentPath);
            }}>Close Document</button>
          </div>
        </React.Fragment>)}
      </div>
    );
  }
}

function mapStateToProps(state: AutomergeSwarmState<AnnouncementDocument>) {
  return { state };
}

function mapDispatchToProps(dispatch: ThunkDispatch<AutomergeSwarmState<AnnouncementDocument>, unknown, AutomergeSwarmActions>) {
  return {
    onInitialize: () => dispatch(initializeAsync()),
    onConnect: (addresses: string[]) => dispatch(connectAsync(addresses)),
    onDocumentOpen: (documentId: string) => dispatch(openDocumentAsync(documentId)),
    onDocumentClose: (documentId: string) => dispatch(closeDocumentAsync(documentId)),
    onDocumentChange: (documentId: string, changeFn: (current: any) => void, message?: string) => dispatch(changeDocumentAsync(documentId, changeFn, message)),
  };
}

export default connect(mapStateToProps, mapDispatchToProps)(App);
