import React from 'react';
import './App.css';
import {
  connectAsync,
  openDocumentAsync,
  closeDocumentAsync,
  changeDocumentAsync,
  initializeAsync,
} from '@collabswarm/collabswarm-redux';
import { connect } from 'react-redux';
import { ThunkDispatch } from 'redux-thunk';
import { JsonEditor } from 'jsoneditor-react';
import * as jsondiffpatch from 'jsondiffpatch';
import { AutomergeSwarmActions, AutomergeSwarmState } from './utils';
import {
  Collabswarm,
  CollabswarmConfig,
  CollabswarmDocument,
  defaultConfig,
  defaultBootstrapConfig,
} from '@collabswarm/collabswarm';
import { Doc, BinaryChange } from 'automerge';

export type AutomergeSwarm<T = any> = Collabswarm<
  Doc<T>,
  BinaryChange[],
  (doc: T) => void,
  CryptoKey,
  CryptoKey,
  CryptoKey
>;
export type AutomergeSwarmDocument<T = any> = CollabswarmDocument<
  Doc<T>,
  BinaryChange[],
  (doc: T) => void,
  CryptoKey,
  CryptoKey,
  CryptoKey
>;

const jdp = jsondiffpatch.create();

interface AppProps {
  state: AutomergeSwarmState;
  onInitialize: (config: CollabswarmConfig) => Promise<AutomergeSwarm>;
  onConnect: (addresses: string[]) => any;
  onDocumentOpen: (documentId: string) => any;
  onDocumentClose: (documentId: string) => any;
  onDocumentChange: (
    documentId: string,
    changeFn: (current: any) => void,
    message?: string,
  ) => any;
}

interface AppState {
  connectionAddress: string;
  documentId: string;
  aclReaders: { [docPath: string]: string[] };
  aclWriters: { [docPath: string]: string[] };
}

class App extends React.Component<
  AppProps,
  AppState,
  AutomergeSwarmState<any>
> {
  constructor(public props: AppProps) {
    super(props);

    this.state = {
      connectionAddress: '',
      documentId: '',
      aclReaders: {},
      aclWriters: {},
    };
  }

  async refreshACL(documentPath: string) {
    const docState = this.props.state.documents[documentPath];
    if (!docState?.documentRef) return;
    try {
      const readers = await docState.documentRef.getReaders();
      const writers = await docState.documentRef.getWriters();
      const serializeKeys = async (keys: CryptoKey[]) => {
        const results = await Promise.allSettled(
          keys.map(async (k) => {
            const raw = await crypto.subtle.exportKey('raw', k);
            const hash = await crypto.subtle.digest('SHA-256', raw);
            return Array.from(new Uint8Array(hash).slice(0, 8))
              .map((b) => b.toString(16).padStart(2, '0'))
              .join('');
          }),
        );
        return results.map((r) =>
          r.status === 'fulfilled' ? r.value : '<unexportable>',
        );
      };
      const readerIds = await serializeKeys(readers);
      const writerIds = await serializeKeys(writers);
      this.setState((prev) => ({
        aclReaders: { ...prev.aclReaders, [documentPath]: readerIds },
        aclWriters: { ...prev.aclWriters, [documentPath]: writerIds },
      }));
    } catch (err) {
      console.warn('Failed to refresh ACL:', err);
    }
  }

  componentDidMount() {
    if (this.props.onInitialize) {
      // Get relay/bootstrap address from env. The relay multiaddr
      // (e.g. /ip4/.../tcp/9001/ws/p2p/...) is used as a bootstrap peer
      // for libp2p peer discovery — NOT as a listen address.
      const relayAddr = process.env.REACT_APP_RELAY_MULTIADDR;
      const bootstrapPeers = relayAddr ? [relayAddr] : [];
      const config = defaultConfig(defaultBootstrapConfig(bootstrapPeers));
      this.props.onInitialize(config);
    }
  }

  render() {
    const nodeAddresses = (() => {
      try {
        return this.props.state.node ? this.props.state.node.libp2p.getMultiaddrs() : null;
      } catch (ex) {
        // No-op.
        console.warn('Failed to read node addresses:', ex);
      }
      return null;
    })();

    return (
      <div>
        <div id="info">
          <div>
            <strong>Node Addresses:</strong>
          </div>
          <ul>
            {nodeAddresses &&
              nodeAddresses.map((address: any, i: number) => (
                <li key={i}>
                  <pre>{address.toString()}</pre>
                </li>
              ))}
          </ul>
          <div>
            <strong>Connected Peers:</strong>
          </div>
          <ul>
            {this.props.state.peers.map((address: string, i: number) => (
              <li key={i}>
                <pre>{address}</pre>
              </li>
            ))}
          </ul>
        </div>
        <div id="connect">
          <input
            type="text"
            defaultValue={this.state.connectionAddress}
            onChange={(e) =>
              this.setState({ connectionAddress: e.currentTarget.value })
            }
          />
          <button
            onClick={() => this.props.onConnect([this.state.connectionAddress])}
          >
            Connect
          </button>
        </div>
        <div id="open">
          <input
            type="text"
            value={this.state.documentId}
            onChange={(e) =>
              this.setState({ documentId: e.currentTarget.value })
            }
          />
          <button
            onClick={() => this.props.onDocumentOpen(this.state.documentId)}
          >
            Open
          </button>
        </div>
        {/* {Object.entries(this.props.state.documents).map(([documentPath, documentState]: [string, any]) => <React.Fragment key={documentPath}> */}
        {Object.entries(this.props.state.documents).map(
          ([documentPath, documentState]: [string, any]) => (
            <React.Fragment key={JSON.stringify(documentState.document)}>
              <h3>{documentPath}</h3>
              <JsonEditor
                value={JSON.parse(JSON.stringify(documentState.document))}
                onChange={(currentDoc: any) => {
                  try {
                    const delta = jdp.diff(documentState.document, currentDoc);
                    if (delta) {
                      console.log(
                        `Applying json patch to '${documentPath}':`,
                        delta,
                      );
                      this.props.onDocumentChange(documentPath, (doc) => {
                        try {
                          jdp.patch(doc, delta);
                        } catch (ex) {
                          console.warn(ex);
                        }
                      });
                    }
                  } catch (ex) {
                    console.warn(ex);
                    return;
                  }
                }}
              />
              <div style={{ marginTop: '8px' }}>
                <strong>ACL:</strong>{' '}
                <button onClick={() => this.refreshACL(documentPath)}>
                  Refresh ACL
                </button>
                {this.state.aclReaders[documentPath] && (
                  <div>
                    <em>Read access incl. writers ({this.state.aclReaders[documentPath].length}):</em>{' '}
                    {this.state.aclReaders[documentPath].map((id, i) => (
                      <code key={`${id}-${i}`} style={{ marginRight: '4px' }}>{id}…</code>
                    ))}
                  </div>
                )}
                {this.state.aclWriters[documentPath] && (
                  <div>
                    <em>Writers ({this.state.aclWriters[documentPath].length}):</em>{' '}
                    {this.state.aclWriters[documentPath].map((id, i) => (
                      <code key={`${id}-${i}`} style={{ marginRight: '4px' }}>{id}…</code>
                    ))}
                  </div>
                )}
              </div>
              <div>
                <button
                  onClick={() => {
                    this.props.onDocumentClose(documentPath);
                  }}
                >
                  Close Document
                </button>
              </div>
            </React.Fragment>
          ),
        )}
      </div>
    );
  }
}

function mapStateToProps(state: AutomergeSwarmState<any>) {
  return { state };
}

function mapDispatchToProps(
  dispatch: ThunkDispatch<
    AutomergeSwarmState<any>,
    unknown,
    AutomergeSwarmActions
  >,
) {
  return {
    onInitialize: (config: CollabswarmConfig) =>
      dispatch(
        initializeAsync<
          Doc<any>,
          BinaryChange[],
          (doc: any) => void,
          CryptoKey,
          CryptoKey,
          CryptoKey
        >(config),
      ),
    onConnect: (addresses: string[]) =>
      dispatch(
        connectAsync<
          Doc<any>,
          BinaryChange[],
          (doc: any) => void,
          CryptoKey,
          CryptoKey,
          CryptoKey
        >(addresses),
      ),
    onDocumentOpen: (documentId: string) =>
      dispatch(
        openDocumentAsync<
          Doc<any>,
          BinaryChange[],
          (doc: any) => void,
          CryptoKey,
          CryptoKey,
          CryptoKey
        >(documentId),
      ),
    onDocumentClose: (documentId: string) =>
      dispatch(
        closeDocumentAsync<
          Doc<any>,
          BinaryChange[],
          (doc: any) => void,
          CryptoKey,
          CryptoKey,
          CryptoKey
        >(documentId),
      ),
    onDocumentChange: (
      documentId: string,
      changeFn: (current: any) => void,
      message?: string,
    ) =>
      dispatch(
        changeDocumentAsync<
          Doc<any>,
          BinaryChange[],
          (doc: any) => void,
          CryptoKey,
          CryptoKey,
          CryptoKey
        >(documentId, changeFn, message),
      ),
  };
}

export default connect(mapStateToProps, mapDispatchToProps)(App);
