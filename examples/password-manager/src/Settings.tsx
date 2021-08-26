import { Button, Table, Row, Container } from 'react-bootstrap';
import { YjsCollabswarm } from './utils';

type Setting = {
  key: string; // id
  value: string;
};

export function Settings({
  collabswarm,
  publicKey,
}: {
  collabswarm: YjsCollabswarm;
  publicKey?: CryptoKey;
}) {
  const settings: Setting[] = collabswarm.ipfsInfo.addresses.map((a, i) => ({
    key: `Peer ID ${i + 1}`,
    value: a.toString(),
  }));
  // settings.push(
  //   {
  //     key: 'IPFS Public Key',
  //     value: collabswarm.ipfsInfo.publicKey,
  //   },
    //  TODO: shows as [object CryptoKey]
    // {
    //   key: 'Public Key',
    //   value: String(publicKey),
    // },
  // );

  return (
    <Container className="ml-auto mr-auto mt-5">
      <Row className="mt-5">
        <Table striped bordered hover responsive>
          <thead>
            <tr>
              <th>Item</th>
              <th colSpan={2}>Value</th>
            </tr>
          </thead>
          <tbody>
            {settings &&
              settings.map((setting, i) => (
                <tr key={setting.key}>
                  <td>{setting.key}</td>
                  <td
                    style={{
                      wordBreak: 'break-all',
                    }}
                  >
                    {setting.value}
                  </td>
                  <td>
                    <Button
                      variant="secondary"
                      onClick={async () => {
                        await navigator.clipboard.writeText(
                          String(setting.value),
                        );
                        // TODO: use https://react-bootstrap-v4.netlify.app/components/alerts/
                        alert('Copied to Clipboard!');
                        console.log('Did copy to clipboard:', setting.key);
                      }}
                    >
                      Copy
                    </Button>
                  </td>
                </tr>
              ))}
            {(!settings || settings.length === 0) && (
              <tr>
                <td colSpan={3}>No settings found!</td>
              </tr>
            )}
          </tbody>
        </Table>
      </Row>
    </Container>
  );
}
