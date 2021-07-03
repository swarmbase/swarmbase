import React from "react";
import { connect } from "react-redux";
import { ThunkDispatch } from "redux-thunk";
import { Doc } from "automerge";
import { CollabswarmConfig, DEFAULT_CONFIG } from "@collabswarm/collabswarm";
import {
  changeDocumentAsync,
  openDocumentAsync,
  closeDocumentAsync,
  initializeAsync,
} from "@collabswarm/collabswarm-redux";
import { WikiSwarmArticle } from "../models";
import { RootState, selectAutomergeSwarmState } from "../reducers";
import dayjs from "dayjs";
import { RouteComponentProps } from "react-router-dom";
import Spinner from "react-bootstrap/Spinner";
import { SlateInput } from "../components/SlateInput";
import { initialValue } from "../components/Slate";
import { AutomergeSwarm, AutomergeSwarmActions, AutomergeSwarmDocument } from "../utils";

interface MatchParams {
  documentId: string;
}

interface WikiArticleProps extends RouteComponentProps<MatchParams> {
  document: WikiSwarmArticle | null;

  onInitialize: (config: CollabswarmConfig) => Promise<AutomergeSwarm>;
  onDocumentOpen: (
    documentPath: string
  ) => Promise<AutomergeSwarmDocument<WikiSwarmArticle> | null>;
  onDocumentClose: (documentPath: string) => Promise<void>;
  onDocumentChange: (
    documentPath: string,
    changeFn: (current: WikiSwarmArticle) => void,
    message?: string
  ) => Promise<Doc<WikiSwarmArticle>>;
}

interface WikiArticleState { }

class WikiArticle extends React.Component<
  WikiArticleProps,
  WikiArticleState,
  RootState
> {
  constructor(public props: WikiArticleProps) {
    super(props);
  }

  componentDidMount() {
    // Load this article upon component mount.
    if (this.props.onDocumentOpen && this.props.match.params.documentId) {
      console.log("Loading article at:", this.props.match.params.documentId);
      console.log("Env:", process.env);
      const config = process.env.REACT_APP_CLIENT_CONFIG
        ? JSON.parse(process.env.REACT_APP_CLIENT_CONFIG)
        : JSON.parse(JSON.stringify(DEFAULT_CONFIG));
      if (process.env.REACT_APP_SIGNALING_SERVER) {
        config.ipfs.config.Addresses.Swarm.push(
          process.env.REACT_APP_SIGNALING_SERVER
        );
      }
      this.props
        .onInitialize(config)
        .then(() =>
          this.props.onDocumentOpen(this.props.match.params.documentId)
        )
        .then((loaded) => console.log("Loaded article:", loaded));
    }
  }

  componentWillUnmount() {
    // Close this article upon component unmount.
    if (this.props.onDocumentClose && this.props.match.params.documentId) {
      console.log("Closing article at:", this.props.match.params.documentId);
      this.props.onDocumentClose(this.props.match.params.documentId);
    }
  }

  // https://caffeinecoding.com/react-redux-draftjs/
  render() {
    if (this.props.document) {
      if (!this.props.document.content) {
        console.warn(
          "this.props.document.content is empty!",
          this.props.document
        );
      }
      return (
        <div className="m-3">
          <div>TODO: Title goes here</div>
          <div>
            <SlateInput
              value={this.props.document.content || initialValue}
              placeholder="Enter run notes here..."
              onChange={(content) => {
                // Your Redux action
                this.props.onDocumentChange(
                  this.props.match.params.documentId,
                  (currentDocument) => {
                    currentDocument.updatedOn = dayjs().format();
                    // currentDocument.updatedBy = ???
                    if (
                      !currentDocument.createdOn &&
                      currentDocument.updatedOn
                    ) {
                      currentDocument.createdOn = currentDocument.updatedOn;
                    }
                    if (
                      !currentDocument.createdBy &&
                      currentDocument.updatedBy
                    ) {
                      currentDocument.createdBy = currentDocument.updatedBy;
                    }
                    currentDocument.content = content;
                    // console.log('Updating editor content:', currentDocument.content.blocks.map(x => x.text).join(' '));
                  }
                );
              }}
            />
          </div>
        </div>
      );
    } else {
      return (
        <div>
          <Spinner
            animation="grow"
            variant="info"
            className="mx-auto"
          ></Spinner>
        </div>
      );
    }
  }
}

function mapStateToProps(state: RootState, ownProps: WikiArticleProps) {
  const documentState =
    state.automergeSwarm.documents[ownProps.match.params.documentId];
  return {
    document: documentState ? documentState.document : null,
  };
}

function mapDispatchToProps(
  dispatch: ThunkDispatch<
    RootState,
    unknown,
    AutomergeSwarmActions<WikiSwarmArticle>
  >
) {
  return {
    onInitialize: (config: CollabswarmConfig) =>
      dispatch(initializeAsync(config, selectAutomergeSwarmState)),
    onDocumentOpen: (documentId: string) =>
      dispatch(openDocumentAsync(documentId, selectAutomergeSwarmState)),
    onDocumentClose: (documentId: string) =>
      dispatch(closeDocumentAsync(documentId, selectAutomergeSwarmState)),
    onDocumentChange: (
      documentId: string,
      changeFn: (current: any) => void,
      message?: string
    ) =>
      dispatch(
        changeDocumentAsync(
          documentId,
          changeFn,
          message,
          selectAutomergeSwarmState
        )
      ),
  };
}

export default connect(mapStateToProps, mapDispatchToProps)(WikiArticle);
