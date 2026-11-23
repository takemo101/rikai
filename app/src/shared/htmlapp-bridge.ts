// html-app の枠 → 画面の「書き戻し」（F42）：メッセージの検査と、下書きの本文の組み立て。DOM に触れない純粋な関数だけ（画面・橋のスクリプト・テストが共有する）。
// 枠の中のコードは、非信頼：**枠から来た値は、文字・画像のデータとして、形・大きさ・値の範囲を、ここで確かめてから**使う（`innerHTML`・`eval`・`href` には、入れない）。
// 検査は、手で書く（画面は、Zod をバンドルに入れない：`web/api/events.ts` と同じ流儀）。返す値は、**新しく作ったオブジェクト**（枠が渡した object を、そのまま使わない：`__proto__` などで、壊れない）。
// 枠が送れるのは、`{ __rikai: 1, type, … }`。余分なキーがあるメッセージは、捨てる（厳密）。

// **見えない・紛らわしい文字は、見える形にする**（`reveal`）：枠が、Unicode のタグ文字（U+E0000〜E007F。画面に何も描かれない）・ゼロ幅・方向の制御（RLO）・私用・未割り当て・対でないサロゲート・制御文字で、
// 利用者に見えない文を、コメントの下書きに入れて、AI に読ませないように。取り除かず、`\uXXXX`（BMP の外は `\u{XXXXX}`）にして、利用者が気づけるようにする。
// 検査の段階（`parsePick`・`parseState`）で、**枠から来た文字列（selector・text・styles の値・state の文字列とキー）に、一度だけ**かける（下流で、二重にしない）。
// 長さの上限は、置き換えの前の長さで検査し、置き換えのあとの `state` が 8KB を超えたら捨てる（置き換えで、上限を迂回できない）。
import type { Anchor } from './types';

export const STATE_MAX_BYTES = 8192;
/** 状態（JSON）の、深さ・全体の要素数・文字列の長さ・キーの長さの上限 */
const STATE_MAX_DEPTH = 8;
const STATE_MAX_NODES = 500;
const STATE_MAX_STRING = 1000;
const STATE_MAX_KEY = 100;

/** 選んだ要素の、見た目の値（許可リスト。デザインの会話で使う 20 個）。橋のスクリプトも、この一覧から作る（二重に持たない） */
export const STYLE_KEYS = [
  'display',
  'position',
  'width',
  'height',
  'margin',
  'padding',
  'border',
  'border-radius',
  'box-shadow',
  'color',
  'background-color',
  'font-family',
  'font-size',
  'font-weight',
  'line-height',
  'gap',
  'opacity',
  'justify-content',
  'align-items',
  'flex-direction',
] as const;
/** 要素のタグ名（英数字とハイフンだけ。見出し・錨のラベルに、そのまま出すので、厳しく） */
const TAG = /^[a-z][a-z0-9-]{0,31}$/i;
const STYLE_SET: ReadonlySet<string> = new Set(STYLE_KEYS);
const STYLE_VALUE_MAX = 80;
const SELECTOR_MAX = 200;
const TEXT_MAX = 80;
const COORD_MAX = 100_000;

export interface PickInfo {
  selector: string;
  tag: string;
  text: string;
  rect: { x: number; y: number; w: number; h: number };
  styles: Record<string, string>;
  frame: { w: number; h: number };
}

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
/** 余分なキーがない（own key が、許す名前だけ） */
const onlyKeys = (o: Obj, allowed: readonly string[]): boolean => Object.keys(o).every((k) => allowed.includes(k));
const int = (v: unknown, min: number, max: number): number | null =>
  typeof v === 'number' && Number.isFinite(v) && Number.isInteger(v) && v >= min && v <= max ? v : null;
const flat = (s: string): string => s.replace(/\s+/g, ' ').trim();

// 見えない・紛らわしい文字：制御（Cc）・書式（Cf：ゼロ幅・方向の制御・タグ文字・BOM）・私用（Co）・未割り当て（Cn）・対でないサロゲート（Cs）・行／段落の区切り（U+2028/2029）。
// 通常の改行・タブ・復帰は、そのまま（text では、このあと、空白に整える）
const HIDDEN = /[\p{Cc}\p{Cf}\p{Co}\p{Cn}\p{Cs}\u2028\u2029]/gu;
const ORDINARY_WS = new Set(['\t', '\n', '\r']);
export const reveal = (s: string): string =>
  s.replace(HIDDEN, (ch) => {
    if (ORDINARY_WS.has(ch)) return ch;
    const cp = ch.codePointAt(0) as number;
    const hex = cp.toString(16).toUpperCase();
    return cp > 0xffff ? `\\u{${hex}}` : `\\u${hex.padStart(4, '0')}`;
  });

/** JSON の値の、すべての文字列とキーに `reveal` をかけた、新しい値（キーが `__proto__` でも壊れないよう、prototype のない object に作る） */
function revealDeep(v: unknown): unknown {
  if (typeof v === 'string') return reveal(v);
  if (Array.isArray(v)) return v.map(revealDeep);
  if (isObj(v)) {
    const o = Object.create(null) as Record<string, unknown>;
    for (const k of Object.keys(v)) o[reveal(k)] = revealDeep(v[k]);
    return o;
  }
  return v;
}

/** `{ __rikai: 1, type: 'pick', selector, tag, text, rect, styles, frame }` の検査。厳密：余分なキー・型違い・長すぎる・NaN・許可リストにないスタイルは、全体を捨てる（null） */
export function parsePick(data: unknown): PickInfo | null {
  if (!isObj(data) || data.__rikai !== 1 || data.type !== 'pick') return null;
  if (!onlyKeys(data, ['__rikai', 'type', 'selector', 'tag', 'text', 'rect', 'styles', 'frame'])) return null;
  const { selector, tag, text, rect, styles, frame } = data;
  if (typeof selector !== 'string' || !selector || selector.length > SELECTOR_MAX) return null;
  if (typeof tag !== 'string' || !TAG.test(tag)) return null;
  if (typeof text !== 'string' || text.length > TEXT_MAX) return null;
  if (!isObj(rect) || !onlyKeys(rect, ['x', 'y', 'w', 'h'])) return null;
  const [x, y, w, h] = [
    int(rect.x, -COORD_MAX, COORD_MAX),
    int(rect.y, -COORD_MAX, COORD_MAX),
    int(rect.w, 0, COORD_MAX),
    int(rect.h, 0, COORD_MAX),
  ];
  if (x === null || y === null || w === null || h === null) return null;
  if (!isObj(styles) || Object.keys(styles).length > STYLE_KEYS.length) return null;
  const outStyles: Record<string, string> = {};
  for (const k of Object.keys(styles)) {
    const v = styles[k];
    if (!STYLE_SET.has(k) || typeof v !== 'string' || v.length > STYLE_VALUE_MAX) return null;
    outStyles[k] = reveal(v);
  }
  if (!isObj(frame) || !onlyKeys(frame, ['w', 'h'])) return null;
  const [fw, fh] = [int(frame.w, 0, COORD_MAX), int(frame.h, 0, COORD_MAX)];
  if (fw === null || fh === null) return null;
  return {
    selector: flat(reveal(selector)),
    tag,
    text: flat(reveal(text)),
    rect: { x, y, w, h },
    styles: outStyles,
    frame: { w: fw, h: fh },
  };
}

const byteLength = (s: string): number => new TextEncoder().encode(s).length;

/** JSON の値が、深さ・要素数・文字列の長さの上限の中か（循環は、JSON.parse の結果にはない） */
function withinLimits(v: unknown): boolean {
  let nodes = 0;
  const walk = (x: unknown, depth: number): boolean => {
    if (++nodes > STATE_MAX_NODES || depth > STATE_MAX_DEPTH) return false;
    if (typeof x === 'string') return x.length <= STATE_MAX_STRING;
    if (Array.isArray(x)) return x.every((y) => walk(y, depth + 1));
    if (isObj(x)) return Object.keys(x).every((k) => k.length <= STATE_MAX_KEY && walk(x[k], depth + 1));
    return true;
  };
  return walk(v, 1);
}

/**
 * `{ __rikai: 1, type: 'state', json }` の検査。json は、文字列・8KB（UTF-8）以下・JSON として読める・深さ 8・要素 500・文字列 1000 文字・キー 100 文字まで。
 * 返すのは、**読み直して、書き直した JSON の文字列**（`JSON.stringify(JSON.parse(json))`）。枠の文字列そのものは、使わない。それ以外は null
 */
export function parseState(data: unknown): string | null {
  if (!isObj(data) || data.__rikai !== 1 || data.type !== 'state' || !onlyKeys(data, ['__rikai', 'type', 'json']))
    return null;
  const json = data.json;
  if (typeof json !== 'string' || !json || byteLength(json) > STATE_MAX_BYTES) return null;
  let v: unknown;
  try {
    v = JSON.parse(json);
  } catch {
    return null;
  }
  if (v === null || typeof v !== 'object' || !withinLimits(v)) return null; // 状態は、object か配列
  const out = JSON.stringify(revealDeep(v)); // 見える形にして、書き直す。置き換えで長くなっても、8KB を超えたら捨てる
  return byteLength(out) <= STATE_MAX_BYTES ? out : null;
}

/** 枠の画像（`snapshot`）の、data URL の長さの上限（約 1.5MB）と、1 辺の上限（px） */
export const SNAPSHOT_MAX_CHARS = 1_600_000;
export const SNAPSHOT_MAX_SIDE = 2400;
const PNG_URL = /^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/;
const REQ_ID = /^s[0-9]{1,9}$/;

/** 画面が、枠に頼む画像の、要求の印（`snapshot-req` の id。応答を結びつける） */
export const snapshotId = (n: number): string => `s${n}`;

/**
 * `{ __rikai: 1, type: 'snapshot', id, png }` の検査。id は、画面が出した印の形・png は、`data:image/png;base64,` の PNG（1.5MB まで）か、null（枠が作れなかった）。
 * 余分なキー・型違い・長すぎるものは、全体を捨てる。ここでは、画像として読めるか（`Image` の読み込み・大きさ）までは、見ない（画面の側が、読んで確かめる）
 */
export function parseSnapshot(data: unknown): { id: string; png: string | null } | null {
  if (
    !isObj(data) ||
    data.__rikai !== 1 ||
    data.type !== 'snapshot' ||
    !onlyKeys(data, ['__rikai', 'type', 'id', 'png'])
  )
    return null;
  const { id, png } = data;
  if (typeof id !== 'string' || !REQ_ID.test(id)) return null;
  if (png === null) return { id, png: null };
  if (typeof png !== 'string' || png.length > SNAPSHOT_MAX_CHARS || !PNG_URL.test(png)) return null;
  return { id, png };
}

/** コードブロックの囲み：値の中の、最長のバッククォートの連続 + 1（最低 3）。値が、ブロックを破れない */
export function fenceFor(body: string): string {
  let max = 0;
  for (const m of body.matchAll(/`+/g)) max = Math.max(max, m[0].length);
  return '`'.repeat(Math.max(3, max + 1));
}

/** JSON のコードブロック（```json … ```）。囲みは、`fenceFor` */
export function jsonBlock(value: unknown): string {
  const body = JSON.stringify(value, null, 2);
  const f = fenceFor(body);
  return `${f}json\n${body}\n${f}`;
}

/** 枠から来たことを示す印（コメントの先頭・錨のラベル） */
export const FROM_FRAME = '【枠から】';
export const FROM_FRAME_IMAGE = '【枠から（画像）】';
/** 範囲の画像に、枠自身が作った画像が入ったとき：錨のラベルの注記と、本文の先頭の 1 行（利用者が消せる） */
export const FRAME_IMAGE_NOTE = '（枠の画像は、枠自身が作ったもの）';
export const FRAME_IMAGE_LINE = `${FROM_FRAME_IMAGE}枠の画像は、枠の中のコードが作ったものです\n\n`;
/** 錨のラベルが、枠から来たものか（「枠から」の札を出す） */
/** 要素を選んだ下書きの錨のラベル：`枠から：<tag>`（枠が決めた長い文字は、入れない） */
const PICK_LABEL = /^枠から：[a-z][a-z0-9-]{0,31}$/i;

/**
 * 錨が、「枠から」の錨か（札を出す）。**枠（ブロック）の錨**であること＋ラベルの印：
 * 要素を選んだ下書き（`枠から：<tag>`。枠のブロック〔DIV〕・引用なし・範囲なし）か、範囲の画像に、枠自身が作った画像が入った錨（引用なし・範囲あり・ラベルが、注記で終わる）。
 * 本文の文を選んだコメント（引用あり）・本文の段落のコメントは、ラベルが似ていても、偽
 */
export const fromFrameAnchor = (a: Pick<Anchor, 'label' | 'quote' | 'blockTag' | 'rect'>): boolean =>
  a.quote === '' &&
  ((a.blockTag === 'DIV' && !a.rect && PICK_LABEL.test(a.label)) || (!!a.rect && a.label.endsWith(FRAME_IMAGE_NOTE)));

/** 選んだ要素の、下書き：錨のラベルと、本文の初期値（1 行の見出し＋ JSON のブロック。あとに、空行：利用者が、続けて書く）。状態があれば、JSON に `state` として入る */
export function pickDraft(pick: PickInfo, stateJson: string | null): { label: string; text: string } {
  const { x, y, w, h } = pick.rect;
  // 見出しの 1 行と錨のラベルには、枠が決めた長い文字（selector・text）を、入れない（地の文として並んで、偽の区切り・指示に見えないように）。出すのは、検査済みの tag と整数だけ。
  // selector・text は、JSON のブロックの中にだけ入る
  const head = `${FROM_FRAME}要素を選びました（枠の自己申告。下の JSON）：${pick.tag}（x:${x} y:${y} w:${w} h:${h}）`;
  const body: Record<string, unknown> = {
    selector: pick.selector,
    tag: pick.tag,
    text: pick.text,
    rect: pick.rect,
    frame: pick.frame,
    styles: pick.styles,
  };
  if (stateJson !== null) body.state = JSON.parse(stateJson);
  return { label: `枠から：${pick.tag}`, text: `${head}\n\n${jsonBlock(body)}\n\n` };
}

/** 「この枠にコメント」に添える、枠の状態（見出し「枠の状態」＋ JSON のブロック）。状態がなければ、null */
export function stateDraft(stateJson: string | null): string | null {
  if (stateJson === null) return null;
  return `${FROM_FRAME}枠の状態\n\n${jsonBlock(JSON.parse(stateJson))}\n\n`;
}
