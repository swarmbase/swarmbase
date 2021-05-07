import { Text } from 'automerge';
import { Descendant } from 'slate';

export interface WikiSwarmArticle {
  title: Text;
  content: Descendant[];
  tags: string[];

  createdBy: string;
  createdOn: string;
  updatedBy: string;
  updatedOn: string;
}
