// This example is for an Editor with `ReactEditor` and `HistoryEditor`
import { BaseEditor } from 'slate'
import { ReactEditor } from 'slate-react'
import { HistoryEditor } from 'slate-history'

export type CustomEditor = BaseEditor & ReactEditor & HistoryEditor

export type ParagraphElementType = 'paragraph'
  export type ParagraphElement = {
  type: ParagraphElementType
  children: CustomText[]
}

export type Heading1ElementType = 'heading-one'
export type Heading1Element = {
  type: Heading1ElementType
  children: CustomText[]
}

export type Heading2ElementType = 'heading-two'
export type Heading2Element = {
  type: Heading2ElementType
  children: CustomText[]
}

export type BlockQuoteElementType = 'block-quote'
export type BlockQuoteElement = {
  type: BlockQuoteElementType
  children: CustomText[]
}

export type BulletedListElementType = 'bulleted-list'
export type BulletedListElement = {
  type: BulletedListElementType
  children: CustomText[]
}

export type NumberedListElementType = 'numbered-list'
export type NumberedListElement = {
  type: NumberedListElementType
  children: CustomText[]
}

export type ListItemElementType = 'list-item'
export type ListItemElement = {
  type: ListItemElementType
  children: CustomText[]
}

export type CustomElement = ParagraphElement | Heading1Element | Heading2Element | BlockQuoteElement | BulletedListElement | NumberedListElement | ListItemElement;
export type CustomElementType = ParagraphElementType | Heading1ElementType | Heading2ElementType | BlockQuoteElementType | BulletedListElementType | NumberedListElementType | ListItemElementType;

export type FormattedText = { 
  text: string;
  bold?: boolean;
  italic?: boolean;
  code?: boolean;
  underline?: boolean;
}
export type FormattedTextMarks = 'bold' | 'italic' | 'code' | 'underline';

export type CustomText = FormattedText

declare module 'slate' {
  interface CustomTypes {
    Editor: CustomEditor
    Element: CustomElement
    Text: CustomText
  }
}