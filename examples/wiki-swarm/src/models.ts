import { Text } from 'automerge';
import { RawDraftContentState } from 'draft-js';

export interface WikiSwarmArticle {
  title: Text;
  content: RawDraftContentState;
  tags: string[];

  createdBy: string;
  createdOn: string;
  updatedBy: string;
  updatedOn: string;
}
