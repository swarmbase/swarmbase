import { Descendant } from 'slate';

export interface WikiSwarmArticle {
  /** Automerge 3 represents collaborative text as a native string. */
  title: string;
  content: Descendant[];
  tags: string[];

  createdBy: string;
  createdOn: string;
  updatedBy: string;
  updatedOn: string;
}
