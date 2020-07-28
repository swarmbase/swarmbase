import React from 'react';
import { connect } from 'react-redux';
import { ThunkDispatch } from 'redux-thunk';
import { Doc } from 'automerge';
import Editor from 'draft-js-plugins-editor';
import createLinkifyPlugin from 'draft-js-linkify-plugin';
import createMarkdownShortcutsPlugin from 'draft-js-markdown-shortcuts-plugin';
import createImagePlugin from 'draft-js-image-plugin';
import createVideoPlugin from 'draft-js-video-plugin';
import createInlineToolbarPlugin from 'draft-js-inline-toolbar-plugin';
import createSideToolbarPlugin from 'draft-js-side-toolbar-plugin';
import createUndoPlugin from 'draft-js-undo-plugin';
import { EditorState, convertFromRaw, convertToRaw, ContentState } from 'draft-js';
import { AutomergeSwarm, AutomergeSwarmConfig, AutomergeSwarmDocument, DEFAULT_CONFIG } from 'automerge-swarm';
import { AutomergeSwarmActions, changeDocumentAsync, openDocumentAsync, closeDocumentAsync, initializeAsync } from 'automerge-swarm-redux';
import { WikiSwarmArticle } from '../models';
import { RootState, selectAutomergeSwarmState } from '../reducers';
import moment from 'moment';
import { RouteComponentProps } from 'react-router-dom';
import Spinner from 'react-bootstrap/Spinner';

const linkifyPlugin = createLinkifyPlugin();
const markdownShortcutsPlugin = createMarkdownShortcutsPlugin();
const imagePlugin = createImagePlugin();
const videoPlugin = createVideoPlugin();
const inlineToolbarPlugin = createInlineToolbarPlugin();
const sideToolbarPlugin = createSideToolbarPlugin();
const undoPlugin = createUndoPlugin();
const plugins = [
  linkifyPlugin,
  markdownShortcutsPlugin,
  imagePlugin,
  videoPlugin,
  inlineToolbarPlugin,
  sideToolbarPlugin,
  undoPlugin,
];

interface MatchParams {
  documentId: string;
}

interface WikiArticleProps extends RouteComponentProps<MatchParams> {
  document: WikiSwarmArticle | null;

  onInitialize: (config: AutomergeSwarmConfig) => Promise<AutomergeSwarm>;
  onDocumentOpen: (documentPath: string) => Promise<AutomergeSwarmDocument<WikiSwarmArticle> | null>;
  onDocumentClose: (documentPath: string) => Promise<void>;
  onDocumentChange: (documentPath: string, changeFn: (current: WikiSwarmArticle) => void, message?: string) => Promise<Doc<WikiSwarmArticle>>;
}

interface WikiArticleState {
  editorState: EditorState;
}

class WikiArticle extends React.Component<WikiArticleProps, WikiArticleState, RootState> {
  private readonly _editorRef: React.RefObject<Editor>

  constructor(public props: WikiArticleProps) {
    super(props);
    this._editorRef = React.createRef<Editor>();

    this.state = {
      editorState: EditorState.createEmpty()
    };
  }

  componentDidMount() {
    // Load this article upon component mount.
    if (this.props.onInitialize && this.props.onDocumentOpen && this.props.match.params.documentId) {
      console.log('Loading article at:', this.props.match.params.documentId);
      console.log('Env:', process.env);
      const config = process.env.REACT_APP_CLIENT_CONFIG ? JSON.parse(process.env.REACT_APP_CLIENT_CONFIG) : JSON.parse(JSON.stringify(DEFAULT_CONFIG));
      if (process.env.REACT_APP_SIGNALING_SERVER) {
        config.ipfs.config.Addresses.Swarm.push(process.env.REACT_APP_SIGNALING_SERVER);
      }
      this.props.onInitialize(config)
        .then(() => this.props.onDocumentOpen(this.props.match.params.documentId))
        .then(loaded => console.log('Loaded article:', loaded));
    }
  }

  componentWillUnmount() {
    // Close this article upon component unmount.
    if (this.props.onDocumentClose && this.props.match.params.documentId) {
      console.log('Closing article at:', this.props.match.params.documentId);
      this.props.onDocumentClose(this.props.match.params.documentId);
    }
  }

  // https://caffeinecoding.com/react-redux-draftjs/
  render() {
    if (this.props.document) {
      if (!this.props.document.content) {
        console.warn('this.props.document.content is empty!', this.props.document);
      }
      const newContentState = this.props.document.content
        ? convertFromRaw(this.props.document.content)
        : ContentState.createFromText('');
      const newEditorState = EditorState.acceptSelection(
        EditorState.createWithContent(newContentState),
        this.state.editorState.getSelection()
      );
      return <div className="m-3">
        <div>TODO: Title goes here</div>
        <div>
          <Editor
            editorState={newEditorState}
            onChange={(editorState: EditorState) => {
              // We need to continue updating the local state in order
              // to get the latest selection position
              this.setState({ editorState });
            
              // Your Redux action
              this.props.onDocumentChange(this.props.match.params.documentId, currentDocument => {
                currentDocument.updatedOn = moment().format();
                // currentDocument.updatedBy = ???
                if (!currentDocument.createdOn && currentDocument.updatedOn) {
                  currentDocument.createdOn = currentDocument.updatedOn;
                }
                if (!currentDocument.createdBy && currentDocument.updatedBy) {
                  currentDocument.createdBy = currentDocument.updatedBy;
                }
                currentDocument.content = convertToRaw(editorState.getCurrentContent());
                console.log('Updating editor content:', currentDocument.content.blocks.map(x => x.text).join(' '));
              });
            }}
            ref={this._editorRef}
            plugins={plugins}
          />
        </div>
      </div>
    } else {
      return <div>
        <Spinner animation="grow" variant="info" className="mx-auto">
        </Spinner>
      </div>
    }
  }
}

function mapStateToProps(state: RootState, ownProps: WikiArticleProps) {
  const documentState = state.automergeSwarm.documents[ownProps.match.params.documentId];
  return {
    document: documentState ? documentState.document : null
  };
}

function mapDispatchToProps(dispatch: ThunkDispatch<RootState, unknown, AutomergeSwarmActions>) {
  return {
    onInitialize: (config: AutomergeSwarmConfig) => dispatch(initializeAsync<WikiSwarmArticle, RootState>(config, selectAutomergeSwarmState)),
    onDocumentOpen: (documentId: string) => dispatch(openDocumentAsync(documentId, selectAutomergeSwarmState)),
    onDocumentClose: (documentId: string) => dispatch(closeDocumentAsync(documentId, selectAutomergeSwarmState)),
    onDocumentChange: (documentId: string, changeFn: (current: any) => void, message?: string) => dispatch(changeDocumentAsync(documentId, changeFn, message, selectAutomergeSwarmState)),
  };
}

export default connect(mapStateToProps, mapDispatchToProps)(WikiArticle);
