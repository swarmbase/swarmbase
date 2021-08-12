import { Button, Form, Table } from "react-bootstrap";
import { PasswordItemPermission } from "./PasswordItem";
import * as uuid from "uuid";

export function PermissionsTable({permissions, setPermissions}: {
  permissions?: PasswordItemPermission[];
  setPermissions?: (permissions: PasswordItemPermission[]) => void;
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
        {permissions && permissions.map((permission, i) => (
          <tr key={permission.id}>
            <td>
              <Form.Control
                value={permission.userId}
                placeholder="Undefined User ID"
                onChange={(e) => {
                  const newPermissions = [...(permissions || [])];
                  newPermissions[i] = {...newPermissions[i], userId: e.target.value};
                  setPermissions && setPermissions(newPermissions);
                }}
              />
            </td>
            <td>
              <Form.Control
                as="select"
                defaultValue={permission.permission || 'r'}
                onChange={e => {
                  const newPermissions = [...(permissions || [])];
                  newPermissions[i] = {...newPermissions[i], permission: e.target.value as 'r' | 'rw'};
                  setPermissions && setPermissions(newPermissions);
                }}
              >
                <option value="r">Read</option>
                <option value="rw">Read/Write</option>
              </Form.Control>
            </td>
            <td>
              <Button variant="danger" onClick={() => {
                const newPermissions = [...(permissions || [])];
                newPermissions.splice(i, 1);
                setPermissions && setPermissions(newPermissions);
              }}>
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
        <Button variant="success" onClick={() => {
          const newPermissions = [...(permissions || [])];
          newPermissions.push({
            id: uuid.v4(),
            userId: '',
            permission: 'r'
          });
          setPermissions && setPermissions(newPermissions);
        }}>
          Add Permission
        </Button>
      </tbody>
    </Table>
  );
}
