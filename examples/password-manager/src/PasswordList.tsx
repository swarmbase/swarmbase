import React from 'react';
import {
  Button,
  ListGroup,
  Container,
  Col,
  Row,
  Form,
  Table,
} from 'react-bootstrap';
import { PasswordItem } from './PasswordItem';
import { PermissionsTable } from './PermissionsTable';
import * as uuid from 'uuid';

export function PasswordList({
  passwords,
  setPasswords,
}: {
  passwords?: PasswordItem[];
  setPasswords?: (passwords: PasswordItem[]) => void;
}) {
  const [currentPassword, setCurrentPassword] = React.useState<
    PasswordItem | undefined
  >();
  const [changedPasswords, setChangedPasswords] = React.useState<{
    [id: string]: PasswordItem;
  }>({});

  return (
    <Container>
      <Row>
        <Col xs={6}>
          <ListGroup variant="flush">
            <ListGroup.Item>
              <Button
                onClick={() => {
                  setCurrentPassword({
                    id: uuid.v4(),
                  });
                }}
              >
                +
              </Button>{' '}
            </ListGroup.Item>
          </ListGroup>
          <ListGroup defaultActiveKey="#link1">
            {passwords &&
              passwords.map((password) => (
                <ListGroup.Item
                  key={password.id}
                  action
                  onClick={() => setCurrentPassword(password)}
                >
                  {password.name}
                </ListGroup.Item>
              ))}
          </ListGroup>
        </Col>
        <Col xs={6}>
          {currentPassword && (
            <Form>
              <Form.Label column="lg">
                {(currentPassword.id && currentPassword.name) || ''}
              </Form.Label>
              <Form.Group
                className="mb-3"
                controlId="exampleForm.ControlInput1"
              >
                <Form.Label column="sm">Name</Form.Label>
                <Form.Control
                  placeholder="Enter a name"
                  value={
                    (currentPassword.id &&
                      changedPasswords[currentPassword.id] &&
                      changedPasswords[currentPassword.id].name) ||
                    currentPassword.name ||
                    ''
                  }
                  onChange={(e) => {
                    if (!currentPassword.id) {
                      return;
                    }
                    const newChangedPasswords = { ...changedPasswords };
                    newChangedPasswords[currentPassword.id] = {
                      ...(changedPasswords[currentPassword.id] ||
                        currentPassword),
                      name: e.target.value,
                    };
                    setChangedPasswords(newChangedPasswords);
                  }}
                />
              </Form.Group>
              <Form.Group
                className="mb-3"
                controlId="exampleForm.ControlTextarea1"
              >
                <Form.Label column="sm">Value</Form.Label>
                <Form.Control
                  as="textarea"
                  rows={3}
                  placeholder="Enter a secret here..."
                  value={
                    (currentPassword.id &&
                      changedPasswords[currentPassword.id] &&
                      changedPasswords[currentPassword.id].value) ||
                    currentPassword.value ||
                    ''
                  }
                  onChange={(e) => {
                    if (!currentPassword.id) {
                      return;
                    }
                    const newChangedPasswords = { ...changedPasswords };
                    newChangedPasswords[currentPassword.id] = {
                      ...(changedPasswords[currentPassword.id] ||
                        currentPassword),
                      value: e.target.value,
                    };
                    setChangedPasswords(newChangedPasswords);
                  }}
                />
              </Form.Group>
              {/* Sharing Controls */}
              <Form.Label column="sm">Permissions</Form.Label>
              <PermissionsTable
                permissions={(currentPassword.id &&
                  changedPasswords[currentPassword.id] &&
                  changedPasswords[currentPassword.id].permissions) ||
                  currentPassword.permissions
                }
                setPermissions={permissions => {
                  if (!currentPassword.id) {
                    return;
                  }
                  const newChangedPasswords = { ...changedPasswords };
                  newChangedPasswords[currentPassword.id] = {
                    ...(changedPasswords[currentPassword.id] ||
                      currentPassword),
                    permissions,
                  };
                  setChangedPasswords(newChangedPasswords);
                }}
              />
              {/* Action Buttons */}
              <Button
                variant="secondary"
                disabled={
                  !currentPassword.id || !changedPasswords[currentPassword.id]
                }
                onClick={() => {
                  setChangedPasswords({});
                }}
              >
                Cancel
              </Button>{' '}
              <Button
                variant="success"
                disabled={
                  !currentPassword.id || !changedPasswords[currentPassword.id]
                }
                onClick={() => {
                  if (
                    !currentPassword.id ||
                    !changedPasswords[currentPassword.id] ||
                    !setPasswords
                  ) {
                    return;
                  }

                  const changedPassword = changedPasswords[currentPassword.id];
                  const currentPasswordIds = new Set(
                    (passwords || []).map((password) => password.id),
                  );
                  const isNewPassword = !currentPasswordIds.has(
                    changedPassword.id,
                  );

                  const newPasswords: PasswordItem[] = [];
                  for (const password of passwords || []) {
                    if (password.id === currentPassword.id) {
                      newPasswords.push(changedPassword);
                    } else {
                      newPasswords.push(password);
                    }
                  }

                  if (isNewPassword) {
                    newPasswords.push(changedPassword);
                  }

                  setPasswords(newPasswords);
                  setChangedPasswords({});
                  setCurrentPassword(changedPassword);
                }}
              >
                Save
              </Button>
            </Form>
          )}
        </Col>
      </Row>
    </Container>
  );
}
