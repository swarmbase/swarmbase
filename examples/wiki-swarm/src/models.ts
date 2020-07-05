import { Text } from 'automerge';

export interface WikiSwarmArticle {
  title: Text;
  content: Text;
  tags: string[];

  createdBy: string;
  createdOn: string;
  updatedBy: string;
  updatedOn: string;
}
