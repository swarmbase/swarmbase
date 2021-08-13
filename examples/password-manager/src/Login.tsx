import React from 'react';
import { Button, Container, Row, Form } from 'react-bootstrap';
import { useHistory } from 'react-router-dom';

async function exportKey(key: CryptoKey): Promise<string> {
  const jwk = await crypto.subtle.exportKey('jwk', key);
  return JSON.stringify(jwk);
}

async function importKey(
  keyData: string,
  keyUsage: KeyUsage[],
): Promise<CryptoKey> {
  const jwk = JSON.parse(keyData) as JsonWebKey;
  return await crypto.subtle.importKey(
    'jwk',
    jwk,
    {
      name: 'ECDSA',
      namedCurve: 'P-384',
    },
    true,
    keyUsage,
  );
}

export function Login({
  setPublicKey,
  setPrivateKey,
}: {
  publicKey?: CryptoKey;
  setPublicKey?: (publicKey: CryptoKey) => void;
  privateKey?: CryptoKey;
  setPrivateKey?: (privateKey: CryptoKey) => void;
}) {
  const history = useHistory();
  const [generatedPrivateKey, setGeneratedPrivateKey] = React.useState<
    string | undefined
  >();
  const [generatedPublicKey, setGeneratedPublicKey] = React.useState<
    string | undefined
  >();
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
          <Button
            variant="primary"
            onClick={async () => {
              setPublicKey &&
                generatedPublicKey &&
                setPublicKey(await importKey(generatedPublicKey, ['verify']));
              setPrivateKey &&
                generatedPrivateKey &&
                setPrivateKey(await importKey(generatedPrivateKey, ['sign']));
              // Redirct to the /secrets page.
              history.push('/secrets');
            }}
          >
            Login
          </Button>
          <Button
            onClick={async () => {
              const cryptoKey: CryptoKey = await genDocumentKey();
              console.log(cryptoKey);
              const jwk: JsonWebKey = await exportCryptoKey(cryptoKey);
              console.log(jwk);
              console.log(JSON.stringify(jwk));
              const andBacktoCryptoKey: CryptoKey = await _importJsonKey(jwk);
              console.log(andBacktoCryptoKey);

              // with string serialize step
              const stringKey: string = JSON.stringify(jwk);
              const jwkFromString: JsonWebKey = JSON.parse(stringKey);
              const cryptoKeyFromString: CryptoKey = await _importJsonKey(
                jwkFromString,
              );
              console.log(cryptoKeyFromString);
            }}
          >
            Gen AES Key
          </Button>
        </Form>
      </Row>
    </Container>
  );
}

async function genDocumentKey() {
  return await crypto.subtle.generateKey(
    { name: 'AES-GCM', length: 256 },
    true,
    ['encrypt', 'decrypt'],
  );
}

async function exportCryptoKey(key: CryptoKey) {
  return await crypto.subtle.exportKey('jwk', key);
}

function _importJsonKey(jwk: JsonWebKey) {
  return crypto.subtle.importKey(
    'jwk',
    jwk,
    { name: 'AES-GCM', length: 256 },
    true,
    ['encrypt', 'decrypt'],
  );
}
