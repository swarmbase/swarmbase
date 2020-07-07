import React, { useState } from 'react';
import { connect } from 'react-redux';
import { ThunkDispatch } from 'redux-thunk';
import Button from 'react-bootstrap/Button';
import FormControl from 'react-bootstrap/FormControl';
import InputGroup from 'react-bootstrap/InputGroup';
import { RootState } from '../reducers';
import { WikiSwarmActions } from '../actions';

interface WikiNavbarProps {
  onWikiSearch: (currentSearch: string) => void;
}

function WikiNavbar({
  onWikiSearch
}: WikiNavbarProps) {
  const [currentSearch, setCurrentSearch] = useState('');

  return <div>
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
        <Button variant="outline-secondary" onClick={() => onWikiSearch(currentSearch)}>Search</Button>
      </InputGroup.Append>
    </InputGroup>
  </div>
}

function mapStateToProps(state: RootState) {
  return {
  };
}

function mapDispatchToProps(dispatch: ThunkDispatch<RootState, unknown, WikiSwarmActions>) {
  return {
  };
}

export default connect(mapStateToProps, mapDispatchToProps)(WikiNavbar);
