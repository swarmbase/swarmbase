import React from 'react';
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
import { SubtleCrypto } from '@collabswarm/collabswarm';
import { useCollabswarm } from '@collabswarm/collabswarm-react';
import {
  YjsProvider,
  YjsJSONSerializer,
  YjsKeychainProvider,
  YjsACLProvider,
} from '@collabswarm/collabswarm-yjs';
import { Login } from './Login';
import { PasswordList } from './PasswordList';
import { PasswordItem } from './PasswordItem';

const examplePasswords = [
  {
    id: '1',
    name: 'Service 1',
    value: 'password1',
  },
  {
    id: '2',
    name: 'Service 2',
    value: 'password2',
  },
];
const crdt = new YjsProvider();
const serializer = new YjsJSONSerializer();
const auth = new SubtleCrypto();
const acl = new YjsACLProvider();
const keychain = new YjsKeychainProvider();

function App() {
  const [privateKey, setPrivateKey] = React.useState<CryptoKey | undefined>();
  const [publicKey, setPublicKey] = React.useState<CryptoKey | undefined>();
  const [passwords, setPasswords] = React.useState<PasswordItem[]>(
    examplePasswords,
  );
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

  const loggedIn = (privateKey && publicKey) !== undefined;

  return (
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
        </Nav>

        <Switch>
          <Route path="/login">
            <Login
              privateKey={privateKey}
              setPrivateKey={setPrivateKey}
              publicKey={publicKey}
              setPublicKey={setPublicKey}
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
          <Route exact path="/">
            {loggedIn ? <Redirect to="/secrets" /> : <Redirect to="/login" />}
          </Route>
        </Switch>
      </Container>
    </Router>
  );
}

export default App;