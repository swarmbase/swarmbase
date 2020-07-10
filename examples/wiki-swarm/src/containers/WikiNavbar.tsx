import React, { useState } from 'react';
import Button from 'react-bootstrap/Button';
import FormControl from 'react-bootstrap/FormControl';
import InputGroup from 'react-bootstrap/InputGroup';
import { LinkContainer } from 'react-router-bootstrap';

export default function WikiNavbar() {
  const [currentSearch, setCurrentSearch] = useState('');

  return <div className="m-3">
    <InputGroup className="mb-3">
      <InputGroup.Prepend>
        <InputGroup.Text id="document-prefix">/documents/</InputGroup.Text>
      </InputGroup.Prepend>
      <FormControl
        placeholder="Document ID"
        aria-label="Document ID"
        aria-describedby="document-prefix"
        value={currentSearch}
        onChange={e => setCurrentSearch(e.target.value)}
      />
      <InputGroup.Append>
        <LinkContainer to={`/document/${currentSearch}`}>
          <Button variant="outline-secondary">Search</Button>
        </LinkContainer>
      </InputGroup.Append>
    </InputGroup>
  </div>
}
