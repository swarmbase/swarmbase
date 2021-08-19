import React, { useEffect } from 'react';
import {
  BrowserRouter as Router,
  Switch,
  Route,
  Redirect,
} from 'react-router-dom';
import { Container, Nav } from 'react-bootstrap';
import { LinkContainer } from 'react-router-bootstrap';
import './App.css';
import 'bootstrap/dist/css/bootstrap.min.css';
import { CollabswarmDocument, SubtleCrypto } from '@collabswarm/collabswarm';
import { CollabswarmContext, useCollabswarm } from '@collabswarm/collabswarm-react';
import {
  YjsProvider,
  YjsJSONSerializer,
  YjsKeychainProvider,
  YjsACLProvider,
} from '@collabswarm/collabswarm-yjs';
import { Login } from './Login';
import { PasswordList } from './PasswordList';
import { Settings } from './Settings';

const crdt = new YjsProvider();
const serializer = new YjsJSONSerializer();
const auth = new SubtleCrypto();
const acl = new YjsACLProvider();
const keychain = new YjsKeychainProvider();

function App() {
  const [privateKey, setPrivateKey] = React.useState<CryptoKey | undefined>();
  const [publicKey, setPublicKey] = React.useState<CryptoKey | undefined>();
  const [bootstrapPeers, setBootstrapPeers] = React.useState<
    string[] | undefined
  >();
  const [docCache, setDocCache] = React.useState<{ [docPath: string]: CollabswarmDocument<any, any, any, any, any, any> }>({});
  const [docDataCache, setDocDataCache] = React.useState<{ [docPath: string]: any }>({});
  const [docReadersCache, setDocReadersCache] = React.useState<{ [docPath: string]: any[] }>({});
  const [docWritersCache, setDocWritersCache] = React.useState<{ [docPath: string]: any[] }>({});
  const collabswarm = useCollabswarm(
    privateKey,
    publicKey,
    crdt,
    serializer,
    serializer,
    serializer,
    auth,
    acl,
    keychain,
  );
  // Calls connect whenever bootstrap peers changes.
  useEffect(() => {
    if (collabswarm && bootstrapPeers) {
      collabswarm.connect(bootstrapPeers);
    } else {
      console.warn(`Skipping collabswarm.connect(${bootstrapPeers})`);
    }
  }, [bootstrapPeers, collabswarm]);

  const loggedIn = (privateKey && publicKey) !== undefined;

  return (
    <CollabswarmContext.Provider value={{
      docCache,
      docDataCache,
      docReadersCache,
      docWritersCache,
      setDocCache,
      setDocDataCache,
      setDocReadersCache,
      setDocWritersCache,
    }}>
      <Router>
        <Container>
          <Nav variant="tabs" defaultActiveKey="/login">
            <Nav.Item>
              <LinkContainer to="/login">
                <Nav.Link>Login</Nav.Link>
              </LinkContainer>
            </Nav.Item>
            <Nav.Item>
              <LinkContainer to="/secrets">
                <Nav.Link>Secrets</Nav.Link>
              </LinkContainer>
            </Nav.Item>
            <Nav.Item>
              <LinkContainer to="/settings">
                <Nav.Link>Settings</Nav.Link>
              </LinkContainer>
            </Nav.Item>
          </Nav>

          <Switch>
            <Route path="/login">
              <Login
                privateKey={privateKey}
                setPrivateKey={setPrivateKey}
                publicKey={publicKey}
                setPublicKey={setPublicKey}
                bootstrapPeers={bootstrapPeers}
                setBootstrapPeers={setBootstrapPeers}
              />
            </Route>
            <Route path="/secrets">
              {loggedIn ? (
                collabswarm ? (
                  <PasswordList collabswarm={collabswarm} />
                ) : (
                  <i>Loading collabswarm...</i>
                )
              ) : (
                <Redirect to="/login" />
              )}
            </Route>
            <Route path="/settings">
              {loggedIn ? (
                collabswarm ? (
                  <Settings collabswarm={collabswarm} publicKey={publicKey} />
                ) : (
                  <i>Loading collabswarm...</i>
                )
              ) : (
                <Redirect to="/login" />
              )}
            </Route>
            <Route exact path="/">
              {loggedIn ? <Redirect to="/secrets" /> : <Redirect to="/login" />}
            </Route>
          </Switch>
        </Container>
      </Router>
    </CollabswarmContext.Provider>
  );
}

export default App;
