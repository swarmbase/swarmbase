import { useCollabswarmDocumentState } from '@collabswarm/collabswarm-react';
import { Form } from 'react-bootstrap';
import { PermissionsTable } from './PermissionsTable';
import { YjsCollabswarm } from './utils';
import Delta from 'quill-delta';
import * as Y from 'yjs';
import { indexDocPath } from './constants';

export function PasswordEditor({
  passwordId,
  collabswarm,
}: {
  passwordId?: string;
  collabswarm: YjsCollabswarm;
}) {
  const [, changePasswords] = useCollabswarmDocumentState(
    collabswarm,
    indexDocPath,
  );
  const [doc, changeDoc] = useCollabswarmDocumentState(
    collabswarm,
    `/passwords/${passwordId}`,
  );

  const id = (doc && doc.getText('id').toString()) || passwordId;
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
            // Skip making changes if `id` is missing (invalid state)
            if (!id) {
              return;
            }

            // Calculate operations that were performed on the text.
            const a = new Delta().insert(name || '');
            const b = new Delta().insert(e.target.value);
            const diff = a.diff(b);

            // Apply diffs calculated on text.
            changeDoc((current) => {
              current.getText('name').applyDelta(diff.ops);
              console.log('Applied diff:', diff, current);
            });
            changePasswords((currentIndex) => {
              currentIndex
                .getArray<Y.Map<Y.Text>>('passwords')
                .forEach((ymap) => {
                  const tIdRef = ymap.get('id');
                  const tId = tIdRef && tIdRef.toString();
                  if (tId === id) {
                    let tRef = ymap.get('name');
                    if (!tRef) {
                      tRef = new Y.Text();
                      ymap.set('name', tRef);
                    }
                    console.log(
                      'Updating index password name entry',
                      tId,
                      tRef,
                    );
                    tRef && tRef.applyDelta(diff.ops);
                  }
                });
            });
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
              current.getText('value').applyDelta(diff.ops);
            });
          }}
        />
      </Form.Group>
      {/* Sharing Controls */}
      <Form.Label column="sm">Permissions</Form.Label>
      <PermissionsTable passwordId={passwordId} collabswarm={collabswarm} />
    </Form>
  );
}
