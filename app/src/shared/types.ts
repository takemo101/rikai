// .rikai/ の JSON の形（meta.json・threads.json・rounds/NNN.json）。サーバー・CLI・画面が共有する。DOM・Node の API に触れない。
// 旧実装（lib/store.js・actions.js・agent.js）が実際に書く形だけを書く。

/** コメントの対象（本文の範囲）。画像・図の中の範囲は rect（基準ブロックに対する比率） */
export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Anchor {
  blockId: string;
  blockHash: string;
  blockTag: string;
  blockText: string;
  quote: string;
  prefix: string;
  suffix: string;
  label: string;
  rect?: Rect;
}

export type AskType = 'single_choice' | 'multi_choice' | 'yes_no' | 'scale' | 'free_text';

export interface AskOption {
  id: string;
  label: string;
  detail?: string;
}

/** AI から人への質問（normAsk が保存する形）。型ごとに、持つ項目が違う */
export interface SingleChoiceAsk {
  type: 'single_choice';
  question: string;
  options: AskOption[];
  allowOther: boolean;
}
export interface MultiChoiceAsk {
  type: 'multi_choice';
  question: string;
  options: AskOption[];
  allowOther: boolean;
}
export interface YesNoAsk {
  type: 'yes_no';
  question: string;
}
export interface ScaleAsk {
  type: 'scale';
  question: string;
  min: number;
  max: number;
  minLabel?: string;
  maxLabel?: string;
}
export interface FreeTextAsk {
  type: 'free_text';
  question: string;
  placeholder?: string;
}
export type Ask = SingleChoiceAsk | MultiChoiceAsk | YesNoAsk | ScaleAsk | FreeTextAsk;

/** 人の回答（normAnswer が保存する形）。質問の型ごとに違う */
export type AskAnswer =
  | { choice: string }
  | { other: string }
  | { choices: string[]; other?: string }
  | { value: boolean }
  | { value: number }
  | { text: string };

export type MessageKind = 'comment' | 'followup' | 'answer' | 'reply';

export interface Message {
  id: string;
  author: 'user' | 'ai';
  kind: MessageKind;
  at: string;
  /** 人の comment・followup と、AI の reply は本文を持つ。answer は持たない */
  text?: string;
  images?: string[];
  /** 人の送信済みの印（AI のメッセージは、いつも true） */
  sent?: boolean;
  /** 送信された round の番号（人のメッセージ） */
  round?: number;
  /** AI の質問 */
  ask?: Ask;
  /** answer：答えた質問のメッセージ ID と、回答 */
  to?: string;
  answer?: AskAnswer;
  /** AI の reply：リンク先のページ（新しいスレッドの link・返信の page） */
  page?: string;
  /** AI の reply：その返信と同時に直った版 */
  revision?: number;
}

export interface Thread {
  id: string;
  page: string;
  /** スレッドを作った時点の、ページの版 */
  version: number;
  anchor: Anchor | null;
  resolved: boolean;
  /** 解決の変更を AI に送ったか（false なら、未送信の変更がある） */
  resolveSent: boolean;
  createdAt: string;
  origin: 'user' | 'ai';
  messages: Message[];
}

export interface ThreadsFile {
  seq: number;
  threads: Thread[];
}

export interface PageInfo {
  title: string;
  parent: string | null;
  versions: number;
  createdAt: string;
}

export interface Meta {
  /** データの版。ない古い形は 1 として読む（保存すると入る） */
  schema?: number;
  slug: string;
  title: string;
  source: string;
  createdAt: string;
  rev: number;
  round: number;
  closed: boolean;
  pending: number[];
  pages: Record<string, PageInfo>;
}

/** Round の items[].anchor（AI に渡す形） */
export interface RoundAnchor {
  quote: string;
  label: string;
  prefix: string;
  suffix: string;
  region?: Rect;
}

/** Round の中の、メッセージの要約（AI に渡す形。画像は絶対パス） */
export interface RoundMessage {
  id: string;
  author: 'user' | 'ai';
  kind: MessageKind;
  text?: string;
  ask?: Ask;
  answer?: AskAnswer;
  to?: string;
  page?: string;
  revision?: number;
  images?: string[];
}

export interface RoundItem {
  thread: string;
  page: string;
  createdOnVersion: number;
  latestVersion: number;
  anchor: RoundAnchor | null;
  userMarked?: 'resolved' | 'reopened';
  history: RoundMessage[];
  new: RoundMessage[];
}

export interface RoundPage {
  title: string;
  version: number;
  file: string;
}

/** rounds/NNN.json：Submit の記録 */
export interface Round {
  round: number;
  status: 'pending' | 'handled';
  submittedAt: string;
  topic: string;
  overallNote?: string;
  pages: Record<string, RoundPage>;
  items: RoundItem[];
  handledAt?: string;
}
