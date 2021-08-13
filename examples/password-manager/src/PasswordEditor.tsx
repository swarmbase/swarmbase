import { useCollabswarmDocumentState } from '@collabswarm/collabswarm-react';
import { Form } from 'react-bootstrap';
import { PermissionsTable } from './PermissionsTable';
import { YjsCollabswarm } from './utils';
import Delta from 'quill-delta';
import * as Y from 'yjs';

export function PasswordEditor({
  passwordId,
  collabswarm,
  upsertPasswordStub,
}: {
  passwordId?: string;
  collabswarm: YjsCollabswarm;

  upsertPasswordStub: (id: string, name: Delta) => void;
}) {
  // TODO: Subscribe to a collabswarm document.
  const [doc, changeDoc] = useCollabswarmDocumentState(
    collabswarm,
    `/passwords/${passwordId}`,
  );

  const id = doc && doc.getText('id').toString();
  const name = doc && doc.getText('name').toString();
  const value = doc && doc.getText('value').toString();

  return (
    <Form>
      <Form.Label column="lg">{(id && name) || ''}</Form.Label>
      <Form.Group className="mb-3" controlId="exampleForm.ControlInput1">
        <Form.Label column="sm">Name</Form.Label>
        <Form.Control
          placeholder="Enter a name"
          value={name || ''}
          onChange={(e) => {
            if (!id) {
              return;
            }

            const a = new Delta().insert(name || '');
            const b = new Delta().insert(e.target.value);
            const diff = a.diff(b);

            changeDoc((current) => {
              current.getText('name').applyDelta(diff);
            });
            upsertPasswordStub(id, diff);
          }}
        />
      </Form.Group>
      <Form.Group className="mb-3" controlId="exampleForm.ControlTextarea1">
        <Form.Label column="sm">Value</Form.Label>
        {/* TODO: Switch to a quill editor for nice Yjs integration? */}
        <Form.Control
          as="textarea"
          rows={3}
          placeholder="Enter a secret here..."
          value={value || ''}
          onChange={(e) => {
            if (!id) {
              return;
            }

            const a = new Delta().insert(value || '');
            const b = new Delta().insert(e.target.value);
            const diff = a.diff(b);

            changeDoc((current) => {
              current.getText('value').applyDelta(diff);
            });
          }}
        />
      </Form.Group>
      {/* Sharing Controls */}
      <Form.Label column="sm">Permissions</Form.Label>
      <PermissionsTable
        permissions={doc && doc.getArray<Y.Map<string>>('permissions')}
        changePermissions={(changeFn) => {
          changeDoc((current) => {
            changeFn(current.getArray<Y.Map<string>>('permissions'));
          });
        }}
      />
    </Form>
  );
}
