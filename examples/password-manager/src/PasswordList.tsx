import React from 'react';
import { Button, ListGroup, Container, Col, Row } from 'react-bootstrap';
import { useCollabswarmDocumentState } from '@collabswarm/collabswarm-react';
import * as uuid from 'uuid';
import { YjsCollabswarm } from './utils';
import * as Y from 'yjs';
import { PasswordEditor } from './PasswordEditor';

export function PasswordList({ collabswarm }: { collabswarm: YjsCollabswarm }) {
  const [currentPassword, setCurrentPassword] = React.useState<
    Y.Map<Y.Text> | undefined
  >();
  const [passwords, changePasswords] = useCollabswarmDocumentState(
    collabswarm,
    'passwords-index',
  );

  const currentPasswordIdRef = currentPassword && currentPassword.get('id');
  const currentPasswordId =
    currentPasswordIdRef && currentPasswordIdRef.toString();

  return (
    <Container>
      <Row>
        <Col xs={6}>
          <ListGroup variant="flush">
            <ListGroup.Item>
              <Button
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
                +
              </Button>{' '}
            </ListGroup.Item>
          </ListGroup>
          <ListGroup defaultActiveKey="#link1">
            {passwords &&
              passwords
                .getArray<Y.Map<Y.Text>>('passwords')
                .map<Y.Map<Y.Text>, JSX.Element>((password) => {
                  const idRef = password.get('id');
                  const id = idRef && idRef.toString();
                  return (
                    <ListGroup.Item
                      key={id}
                      action
                      onClick={() => setCurrentPassword(password)}
                    >
                      {password.get('name')}
                    </ListGroup.Item>
                  );
                })}
          </ListGroup>
        </Col>
        <Col xs={6}>
          {currentPassword && (
            <PasswordEditor
              collabswarm={collabswarm}
              passwordId={currentPasswordId}
              upsertPasswordStub={(id, nameChanges) => {
                changePasswords((current) => {
                  current
                    .getArray<Y.Map<Y.Text>>('passwords')
                    .forEach((ymap) => {
                      const tIdRef = ymap.get('id');
                      const tId = tIdRef && tIdRef.toString();
                      if (tId === id) {
                        const tRef = ymap.get('name');
                        tRef && tRef.applyDelta(nameChanges);
                      }
                    });
                });
              }}
            />
          )}
        </Col>
      </Row>
    </Container>
  );
}
