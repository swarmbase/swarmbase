import { Button, Form, Table } from 'react-bootstrap';
import * as uuid from 'uuid';
import * as Y from 'yjs';

export function PermissionsTable({
  permissions,
  changePermissions,
}: {
  permissions?: Y.Array<Y.Map<string>>;
  changePermissions?: (
    changeFn: (permissions: Y.Array<Y.Map<string>>) => void,
  ) => void;
}) {
  return (
    <Table striped bordered hover>
      <thead>
        <tr>
          <th>User</th>
          <th colSpan={2}>Permisssions</th>
        </tr>
      </thead>
      <tbody>
        {permissions &&
          permissions.map<Y.Map<string>, JSX.Element>((permission, i) => (
            <tr key={permission.get('id')}>
              <td>
                <Form.Control
                  value={permission.get('userId')}
                  placeholder="Undefined User ID"
                  onChange={(e) => {
                    changePermissions &&
                      changePermissions((current) => {
                        current.get(i).set('userId', e.target.value);
                      });
                  }}
                />
              </td>
              <td>
                <Form.Control
                  as="select"
                  defaultValue={permission.get('permission') || 'r'}
                  onChange={(e) => {
                    changePermissions &&
                      changePermissions((current) => {
                        current.get(i).set('permission', e.target.value);
                      });
                  }}
                >
                  <option value="r">Read</option>
                  <option value="rw">Read/Write</option>
                </Form.Control>
              </td>
              <td>
                <Button
                  variant="danger"
                  onClick={() => {
                    changePermissions &&
                      changePermissions((current) => {
                        current.delete(i);
                      });
                  }}
                >
                  Remove
                </Button>
              </td>
            </tr>
          ))}
        {(!permissions || permissions.length === 0) && (
          <tr>
            <td colSpan={3}>No permissions defined!</td>
          </tr>
        )}
        <Button
          variant="success"
          onClick={() => {
            changePermissions &&
              changePermissions((current) => {
                current.push([
                  new Y.Map(
                    Object.entries({
                      id: uuid.v4(),
                      userId: '',
                      permission: 'r',
                    }),
                  ),
                ]);
              });
          }}
        >
          Add Permission
        </Button>
      </tbody>
    </Table>
  );
}
