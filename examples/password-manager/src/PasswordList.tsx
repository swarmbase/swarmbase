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
          <Button
            onClick={() => {
              setCurrentPassword({
                id: uuid.v4(),
              });
            }}
          >
            Add New
          </Button>
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
              <Form.Group
                className="mb-3"
                controlId="exampleForm.ControlInput1"
              >
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
                <Form.Label>Value</Form.Label>
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
              <div className="mt-1 mb-2">Permissions</div>
              <Table striped bordered hover>
                <thead>
                  <tr>
                    <th>User</th>
                    <th colSpan={2}>Permisssions</th>
                  </tr>
                </thead>
                <tbody>
                  {/* TODO: This is broken: Needs to read from changedPasswords as well. */}
                  {currentPassword.permissions &&
                    currentPassword.permissions.map((permission, i) => (
                      <tr>
                        <td>{permission.userId || <i>Undefined User ID</i>}</td>
                        <td>
                          <Form.Control
                            as="select"
                            defaultValue={permission.permission || 'r'}
                            onChange={(e) => {
                              // TODO: Finish this.
                              // if (!currentPassword.id) {
                              //   return;
                              // }
                              // const newPermissions = [...(currentPassword.permissions || [])];
                              // const newChangedPasswords = {...changedPasswords};
                              // newChangedPasswords[currentPassword.id] = {...(changedPasswords[currentPassword.id] || currentPassword), permissions: [e.target.value]};
                              // setChangedPasswords(newChangedPasswords);
                            }}
                          >
                            <option value="r">Read</option>
                            <option value="rw">Read/Write</option>
                          </Form.Control>
                        </td>
                        <td>
                          <Button variant="danger">Remove</Button>
                        </td>
                      </tr>
                    ))}
                  {(!currentPassword.permissions ||
                    currentPassword.permissions.length === 0) && (
                    <tr>
                      <td colSpan={3}>No permissions defined!</td>
                    </tr>
                  )}
                </tbody>
              </Table>
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
