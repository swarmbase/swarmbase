import React from 'react';
import { Button, ListGroup, Container, Col, Row, Form } from 'react-bootstrap';
import { useCollabswarmDocumentState } from '@collabswarm/collabswarm-react';
import * as uuid from 'uuid';
import { YjsCollabswarm } from './utils';
import * as Y from 'yjs';
import { PasswordEditor } from './PasswordEditor';

export function PasswordList({
  userId,
  collabswarm,
}: {
  userId: string;
  collabswarm: YjsCollabswarm;
}) {
  const [currentPassword, setCurrentPassword] = React.useState<
    Y.Map<Y.Text> | undefined
  >();
  const [passwords, changePasswords] = useCollabswarmDocumentState(
    collabswarm,
    `/${userId}/passwords-index`,
  );
  const [importingPassword, setImportingPassword] = React.useState(false);
  const [importPasswordId, setImportPasswordId] = React.useState('');

  const currentPasswordIdRef = currentPassword && currentPassword.get('id');
  const currentPasswordId =
    currentPasswordIdRef && currentPasswordIdRef.toString();
  let importButtonDisabled: boolean = true;
  if (importPasswordId) {
    importButtonDisabled = false;
  }

  return (
    <Container>
      <Row>
        <Col xs={6}>
          <Row className="mt-4" />
          <ListGroup defaultActiveKey="#link1">
            {passwords &&
              passwords
                .getArray<Y.Map<Y.Text>>('passwords')
                .map<Y.Map<Y.Text>, JSX.Element>((password) => {
                  const idRef = password.get('id');
                  const nameRef = password.get('name');
                  const id = idRef && idRef.toString();
                  const name = nameRef && nameRef.toString();
                  return (
                    <ListGroup.Item
                      key={id}
                      action
                      onClick={() => setCurrentPassword(password)}
                    >
                      {name || `Unnamed Secret (id: ${id})`}
                    </ListGroup.Item>
                  );
                })}
          </ListGroup>
          <ListGroup variant="flush">
            <ListGroup.Item>
              <Button
                variant="primary"
                onClick={() => {
                  changePasswords((current) => {
                    current.getArray<Y.Map<Y.Text>>('passwords').push([
                      new Y.Map<Y.Text>(
                        Object.entries({
                          id: new Y.Text(uuid.v4()),
                        }),
                      ),
                    ]);
                  });
                }}
              >
                New Secret
              </Button>{' '}
              {!importingPassword && (
                <Button
                  variant="success"
                  onClick={() => {
                    setImportingPassword(true);
                  }}
                >
                  Add Existing Secret
                </Button>
              )}
              {importingPassword && (
                <>
                  <Form.Control
                    placeholder="Enter a secret ID"
                    value={importPasswordId}
                    onChange={(e) => setImportPasswordId(e.target.value)}
                  ></Form.Control>
                  <Button
                    variant="success"
                    disabled={importButtonDisabled}
                    onClick={() => {
                      changePasswords((current) => {
                        current.getArray<Y.Map<Y.Text>>('passwords').push([
                          new Y.Map<Y.Text>(
                            Object.entries({
                              id: new Y.Text(importPasswordId),
                              // TODO: Populate name field.
                            }),
                          ),
                        ]);
                      });
                      setImportingPassword(false);
                    }}
                  >
                    Import
                  </Button>
                </>
              )}
            </ListGroup.Item>
          </ListGroup>
        </Col>
        <Col xs={6}>
          <Row className="mt-4" />

          {currentPassword && (
            <PasswordEditor
              userId={userId}
              collabswarm={collabswarm}
              passwordId={currentPasswordId}
            />
          )}
        </Col>
      </Row>
    </Container>
  );
}
