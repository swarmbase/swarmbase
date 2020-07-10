import React from 'react';
import './App.css';
import { Route, Switch } from 'react-router-dom';
import WikiNavbar from './containers/WikiNavbar';
import WikiArticle from './containers/WikiArticle';
import { WikiHome } from './containers/WikiHome';

export default function App() {
  return (
    <div>
      <WikiNavbar />
      <Switch>
        <Route path="/document/:documentId" component={WikiArticle} />
        <Route path="/" component={WikiHome} />
      </Switch>
    </div>
  );
}
