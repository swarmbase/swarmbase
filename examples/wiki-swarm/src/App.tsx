import React from 'react';
import './App.css';
import { RootState, WikiAppState } from './reducers';
import { Route, Link, Switch } from 'react-router-dom';
import WikiNavbar from './containers/WikiNavbar';
import WikiArticle from './containers/WikiArticle';
import { WikiHome } from './containers/WikiHome';
import { connect } from 'react-redux';
import { initializeAsync, AutomergeSwarmActions } from 'automerge-swarm-redux';
import { ThunkDispatch } from 'redux-thunk';
import { WikiSwarmArticle } from './models';

interface AppProps {
  onInitialize: () => Promise<void>;
}

class App extends React.Component<AppProps, unknown, RootState> {
  constructor(public props: AppProps) {
    super(props)

    this.state = {
      connectionAddress: '',
      documentId: ''
    };
  }

  componentDidMount() {
    if (this.props.onInitialize) {
      this.props.onInitialize();
    }
  }

  render() {
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
}

function mapStateToProps(state: RootState) {
  return {};
}

function mapDispatchToProps(dispatch: ThunkDispatch<RootState, unknown, AutomergeSwarmActions>) {
  return {
    onInitialize: () => dispatch(initializeAsync<WikiSwarmArticle, RootState>(state => state.automergeSwarm)),
  };
}

export default connect(mapStateToProps, mapDispatchToProps)(App);
// export default App;
