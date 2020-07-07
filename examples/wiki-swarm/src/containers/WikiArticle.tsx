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
import { EditorState, convertFromRaw, convertToRaw } from 'draft-js';
import { AutomergeSwarmDocument } from 'automerge-swarm';
import { AutomergeSwarmActions, changeDocumentAsync, openDocumentAsync, closeDocumentAsync } from 'automerge-swarm-redux';
import { WikiSwarmArticle } from '../models';
import { RootState, selectAutomergeSwarmState } from '../reducers';
import moment from 'moment';

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

interface WikiArticleProps {
  documentPath: string;
  document: WikiSwarmArticle;

  onDocumentOpen: (documentPath: string) => Promise<AutomergeSwarmDocument<WikiSwarmArticle> | null>;
  onDocumentClose: (documentPath: string) => Promise<void>;
  onDocumentChange: (documentPath: string, changeFn: (current: any) => void, message?: string) => Promise<Doc<WikiSwarmArticle>>;
}

interface WikiArticleState {
  editorState: EditorState;
}

class WikiArticle extends React.Component<WikiArticleProps, WikiArticleState, RootState> {
  constructor(public props: WikiArticleProps) {
    super(props)

    this.state = {
      editorState: EditorState.createEmpty()
    };
  }

  componentDidMount() {
    // Load this article upon component mount.
    if (this.props.onDocumentOpen && this.props.documentPath) {
      console.log('Loading article at:', this.props.documentPath);
      this.props.onDocumentOpen(this.props.documentPath);
    }
  }

  componentWillUnmount() {
    // Close this article upon component unmount.
    if (this.props.onDocumentClose && this.props.documentPath) {
      console.log('Closing article at:', this.props.documentPath);
      this.props.onDocumentClose(this.props.documentPath);
    }
  }

  focus() {
    (this.refs.editor as any).focus();
  }

  // https://caffeinecoding.com/react-redux-draftjs/
  render() {
    const newEditorState = EditorState.acceptSelection(
      EditorState.createWithContent(convertFromRaw(this.props.document.content)),
      this.state.editorState.getSelection()
    );
    return <div>
      <div>TODO: Title goes here</div>
      <div onClick={this.focus}>
        <Editor
          editorState={newEditorState}
          onChange={(editorState: EditorState) => {
            // We need to continue updating the local state in order
            // to get the latest selection position
            this.setState({ editorState })
          
            // Your Redux action
            this.props.onDocumentChange(this.props.documentPath, (currentDocument: WikiSwarmArticle) => {
              currentDocument.updatedOn = moment().format();
              // currentDocument.updatedBy = ???
              if (!currentDocument.createdOn) {
                currentDocument.createdOn = currentDocument.updatedOn;
              }
              if (!currentDocument.createdBy) {
                currentDocument.createdBy = currentDocument.updatedBy;
              }
              currentDocument.content = convertToRaw(editorState.getCurrentContent());
            })
          }}
          ref='editor'
          plugins={plugins}
        />
      </div>
    </div>
  }
}

function mapStateToProps(state: RootState) {
  return { state };
}

function mapDispatchToProps(dispatch: ThunkDispatch<RootState, unknown, AutomergeSwarmActions>) {
  return {
    onDocumentOpen: (documentId: string) => dispatch(openDocumentAsync(documentId, selectAutomergeSwarmState)),
    onDocumentClose: (documentId: string) => dispatch(closeDocumentAsync(documentId, selectAutomergeSwarmState)),
    onDocumentChange: (documentId: string, changeFn: (current: any) => void, message?: string) => dispatch(changeDocumentAsync(documentId, changeFn, message, selectAutomergeSwarmState)),
  };
}

export default connect(mapStateToProps, mapDispatchToProps)(WikiArticle);
