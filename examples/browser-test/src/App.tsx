import React from 'react';
import './App.css';
import { AutomergeSwarm, AutomergeSwarmConfig, DEFAULT_CONFIG } from '@robotoer/collabswarm-automerge';
import { AutomergeSwarmState, connectAsync, openDocumentAsync, closeDocumentAsync, changeDocumentAsync, AutomergeSwarmActions, initializeAsync } from '@robotoer/collabswarm-redux';
import { connect } from 'react-redux';
import { ThunkDispatch } from 'redux-thunk';
import { JsonEditor } from 'jsoneditor-react';
import * as jsondiffpatch from 'jsondiffpatch';

const jdp = jsondiffpatch.create();

interface AppProps {
  state: AutomergeSwarmState<any>;
  onInitialize: (config: AutomergeSwarmConfig) => Promise<AutomergeSwarm>;
  onConnect: (addresses: string[]) => any;
  onDocumentOpen: (documentId: string) => any;
  onDocumentClose: (documentId: string) => any;
  onDocumentChange: (documentId: string, changeFn: (current: any) => void, message?: string) => any;
}

interface AppState {
  connectionAddress: string;
  documentId: string;
}

class App extends React.Component<AppProps, AppState, AutomergeSwarmState<any>> {
  constructor(public props: AppProps) {
    super(props)

    this.state = {
      connectionAddress: '',
      documentId: ''
    };
  }

  componentDidMount() {
    if (this.props.onInitialize) {
      const config = process.env.REACT_APP_CLIENT_CONFIG ? JSON.parse(process.env.REACT_APP_CLIENT_CONFIG) : JSON.parse(JSON.stringify(DEFAULT_CONFIG));
      if (process.env.REACT_APP_SIGNALING_SERVER) {
        config.ipfs.config.Addresses.Swarm.push(process.env.REACT_APP_SIGNALING_SERVER);
      }
      this.props.onInitialize(config);
    }
  }

  render() {
    const ipfsInfo = this.props.state.node ? this.props.state.node.ipfsInfo : null;

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
        {/* {Object.entries(this.props.state.documents).map(([documentPath, documentState]: [string, any]) => <React.Fragment key={documentPath}> */}
        {Object.entries(this.props.state.documents).map(([documentPath, documentState]: [string, any]) => <React.Fragment key={JSON.stringify(documentState.document)}>
          <h3>{documentPath}</h3>
          <JsonEditor
            value={JSON.parse(JSON.stringify(documentState.document))}
            onChange={(currentDoc: any) => {
              try {
                const delta = jdp.diff(documentState.document, currentDoc);
                if (delta) {
                  console.log(`Applying json patch to '${documentPath}':`, delta);
                  this.props.onDocumentChange(documentPath, doc => {
                    try {
                      jdp.patch(doc, delta);
                    } catch(ex) {
                      console.warn(ex);
                    }
                  });
                }
              } catch(ex) {
                console.warn(ex);
                return;
              }
            }}/>
          <div>
            <button onClick={() => {
              this.props.onDocumentClose(documentPath);
            }}>Close Document</button>
          </div>
        </React.Fragment>)}
      </div>
    );
  }
}

function mapStateToProps(state: AutomergeSwarmState<any>) {
  return { state };
}

function mapDispatchToProps(dispatch: ThunkDispatch<AutomergeSwarmState<any>, unknown, AutomergeSwarmActions>) {
  return {
    onInitialize: (config: AutomergeSwarmConfig) => dispatch(initializeAsync<any, AutomergeSwarmState<any>>(config)),
    onConnect: (addresses: string[]) => dispatch(connectAsync(addresses)),
    onDocumentOpen: (documentId: string) => dispatch(openDocumentAsync(documentId)),
    onDocumentClose: (documentId: string) => dispatch(closeDocumentAsync(documentId)),
    onDocumentChange: (documentId: string, changeFn: (current: any) => void, message?: string) => dispatch(changeDocumentAsync(documentId, changeFn, message)),
  };
}

export default connect(mapStateToProps, mapDispatchToProps)(App);
