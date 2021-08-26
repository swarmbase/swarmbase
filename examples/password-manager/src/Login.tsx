import React from 'react';
import { Button, Container, Row, Form } from 'react-bootstrap';
import { useHistory } from 'react-router-dom';
import { exportKey, importKey } from './utils'


export function Login({
  setUserId,
  setPublicKey,
  setPrivateKey,
  setBootstrapPeers,
  setSignalingServerAddr,
}: {
  userId?: string;
  setUserId?: (userId: string) => void;
  publicKey?: CryptoKey;
  setPublicKey?: (publicKey: CryptoKey) => void;
  privateKey?: CryptoKey;
  setPrivateKey?: (privateKey: CryptoKey) => void;
  signalingServerAddr?: string;
  setSignalingServerAddr?: (signalingServerAddr: string) => void;
  bootstrapPeers?: string[];
  setBootstrapPeers?: (peers: string[]) => void;
}) {
  const history = useHistory();
  const [generatedPrivateKey, setGeneratedPrivateKey] = React.useState<
    string | undefined
  >();
  const [generatedPublicKey, setGeneratedPublicKey] = React.useState<
    string | undefined
  >();
  const [draftSignalingServerAddr, setDraftSignalingServerAddr] = React.useState('/ip4/127.0.0.1/tcp/9090/wss/p2p-webrtc-star');
  const [draftBootstrapPeers, setDraftBootstrapPeers] = React.useState('');
  // Generate a keypair.
  React.useEffect(() => {
    console.log(`Calling <Login /> init effect`);
    (async () => {
      const keypair = await crypto.subtle.generateKey(
        {
          name: 'ECDSA',
          namedCurve: 'P-384',
        },
        true,
        ['sign', 'verify'],
      );

      // Save these new generated keypairs.
      const exportedPrivateKey = await exportKey(keypair.privateKey);
      const exportedPublicKey = await exportKey(keypair.publicKey);
      setGeneratedPublicKey(exportedPublicKey);
      setGeneratedPrivateKey(exportedPrivateKey);
    })();

    return () => {
      // Nothing to cleanup.
    };
  }, []);

  return (
    <Container className="ml-auto mr-auto mt-5">
      <Row className="mt-5">
        {/* Allow user to enter a keypair */}
        <Form>
          <Form.Group className="mb-3" controlId="formBasicPrivateKey">
            <Form.Label>Private Key</Form.Label>
            <Form.Control
              type="password"
              placeholder="Enter private key"
              value={generatedPrivateKey || ''}
              onChange={(e) => setGeneratedPrivateKey(e.target.value)}
            />
            <Form.Text className="text-muted">
              We've auto-generated a key for you. Feel free to provide your own
              key (must be in JWK format).
            </Form.Text>
          </Form.Group>

          <Form.Group className="mb-3" controlId="formBasicPublicKey">
            <Form.Label>Public Key</Form.Label>
            <Form.Control
              as="textarea"
              rows={6}
              placeholder="Enter public key"
              value={generatedPublicKey || ''}
              onChange={(e) => setGeneratedPublicKey(e.target.value)}
            />
            <Form.Text className="text-muted">
              We've auto-generated a key for you. Feel free to provide your own
              key (must be in JWK format).
            </Form.Text>
          </Form.Group>

          <Form.Group className="mb-3" controlId="formSignalingServer">
            <Form.Label>Star Signal Server</Form.Label>
            <Form.Control
              placeholder="Enter the address of the webRTC signaling server"
              value={draftSignalingServerAddr || ''}
              onChange={(e) => setDraftSignalingServerAddr(e.target.value)}
            />
          </Form.Group>

          <Form.Group className="mb-3" controlId="formBootstrapPeers">
            <Form.Label>Bootstrap Peers</Form.Label>
            <Form.Control
              as="textarea"
              rows={6}
              placeholder="Enter a list of (line separated) Peer IDs"
              value={draftBootstrapPeers || ''}
              onChange={(e) => setDraftBootstrapPeers(e.target.value)}
            />
          </Form.Group>

          <Button
            variant="primary"
            onClick={async () => {
              setPublicKey &&
                generatedPublicKey &&
                setPublicKey(await importKey(generatedPublicKey, ['verify']));
              setPrivateKey &&
                generatedPrivateKey &&
                setPrivateKey(await importKey(generatedPrivateKey, ['sign']));
              setBootstrapPeers &&
                draftBootstrapPeers &&
                setBootstrapPeers(draftBootstrapPeers.split('\n'));
              setSignalingServerAddr &&
                draftSignalingServerAddr &&
                setSignalingServerAddr(draftSignalingServerAddr);
              setUserId &&
                generatedPublicKey &&
                setUserId(generatedPublicKey);
              // Redirct to the /secrets page.
              history.push('/secrets');
            }}
          >
            Login
          </Button>
        </Form>
      </Row>
    </Container>
  );
}
