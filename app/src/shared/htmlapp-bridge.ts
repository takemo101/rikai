// html-app の枠 → 画面の「書き戻し」（F42）：メッセージの検査と、下書きの本文の組み立て。DOM に触れない純粋な関数だけ（画面・橋のスクリプト・テストが共有する）。
// 枠の中のコードは、非信頼：**枠から来た値は、文字・画像のデータとして、形・大きさ・値の範囲を、ここで確かめてから**使う（`innerHTML`・`eval`・`href` には、入れない）。
// 検査は、手で書く（画面は、Zod をバンドルに入れない：`web/api/events.ts` と同じ流儀）。返す値は、**新しく作ったオブジェクト**（枠が渡した object を、そのまま使わない：`__proto__` などで、壊れない）。
// 枠が送れるのは、`{ __rikai: 1, type, … }`。余分なキーがあるメッセージは、捨てる（厳密）。

// **見えない・紛らわしい文字は、見える形にする**（`reveal`）：枠が、Unicode のタグ文字（U+E0000〜E007F。画面に何も描かれない）・異体字セレクタ（U+E0100〜E01EF など）・ゼロ幅・方向の制御（RLO）・
// 私用・未割り当て・対でないサロゲート・制御文字・「無視してよい」文字（Default_Ignorable）・空白に見える字（点字の空白・ハングルの空白）・結合記号の重ね書きで、
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
/** 要素のタグ名の形（英数字とハイフンだけ。これに合わない pick は、捨てる） */
const TAG = /^[a-z][a-z0-9-]{0,31}$/i;
/**
 * 見出し・錨のラベルに出してよいタグ名（標準の HTML 要素と、SVG の主な要素。小文字）。カスタム要素の名前（`ignore-previous-instructions` など、枠が自由に決められる）は、
 * 見出し・ラベルには出さず、`custom` にする（元の名前は、JSON のブロックの中の `tag` にだけ入る）
 */
const KNOWN_TAGS: ReadonlySet<string> = new Set(
  (
    'a abbr address area article aside audio b base bdi bdo blockquote body br button canvas caption cite code col colgroup data datalist dd del details dfn dialog div dl dt em embed fieldset figcaption figure footer form ' +
    'h1 h2 h3 h4 h5 h6 head header hgroup hr html i iframe img input ins kbd label legend li link main map mark menu meta meter nav noscript object ol optgroup option output p param picture pre progress q rp rt ruby ' +
    's samp script search section select slot small source span strong style sub summary sup table tbody td template textarea tfoot th thead time title tr track u ul var video wbr ' +
    'svg path circle rect g line text ellipse polygon polyline tspan defs use image symbol marker mask pattern stop clippath lineargradient radialgradient foreignobject'
  ).split(' '),
);
export const CUSTOM_TAG = 'custom';
/** 見出し・錨のラベルに出すタグ名：標準の要素なら小文字の名前、それ以外（カスタム要素）は `custom` */
export const shownTag = (tag: string): string => (KNOWN_TAGS.has(tag.toLowerCase()) ? tag.toLowerCase() : CUSTOM_TAG);
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

// 見えない・紛らわしい文字：制御（Cc）・書式（Cf：ゼロ幅・方向の制御・タグ文字・BOM）・私用（Co）・未割り当て（Cn）・対でないサロゲート（Cs）・行／段落の区切り（U+2028/2029）・
// Default_Ignorable_Code_Point（異体字セレクタ U+FE00〜FE0F・U+E0100〜E01EF・結合書記素結合子 U+034F・ハングルの空白に見える字・モンゴル文字の異体字セレクタ・クメール文字の固有の母音など）・
// 点字の空白（U+2800）。結合記号（\p{M}）の、3 個以上の連続も（重ね書きで、字を潰す）。日本語の濁点・タイ語・ヒンディー語などの、正当な 1〜2 個は、そのまま。
// 絵文字（\p{Extended_Pictographic}）のすぐ後ろの、1 個の U+FE0E・U+FE0F（表示形式の指定。❤️ など、ふつうの絵文字に付く）だけは、そのまま（その他の位置・2 個目以降は、見える形にする）。
// 通常の改行・タブ・復帰は、そのまま（text では、このあと、空白に整える）
const HIDDEN =
  /\p{M}{3,}|(?!(?<=\p{Extended_Pictographic})[\uFE0E\uFE0F])[\p{Cc}\p{Cf}\p{Co}\p{Cn}\p{Cs}\p{Default_Ignorable_Code_Point}\u2800\u2028\u2029]/gu;
const ORDINARY_WS = new Set(['\t', '\n', '\r']);
const escapeChar = (ch: string): string => {
  const cp = ch.codePointAt(0) as number;
  const hex = cp.toString(16).toUpperCase();
  return cp > 0xffff ? `\\u{${hex}}` : `\\u${hex.padStart(4, '0')}`;
};
const revealPlain = (s: string): string =>
  s.replace(HIDDEN, (run) => {
    let out = '';
    for (const ch of run) out += ORDINARY_WS.has(ch) ? ch : escapeChar(ch);
    return out;
  });

// 正当な絵文字の、2 つの並びだけは、見える化しない（見える化すると、絵文字が割れる）：
//  ① キーキャップ（`1️⃣`）：[0-9#*]・U+FE0F（なくてもよい）・U+20E3。
//  ② ZWJ（U+200D）で連結した絵文字（`👨‍👩‍👧`・`🏳️‍🌈`）：絵文字（肌色修飾子・U+FE0F を挟んでよい）の**間の 1 個**の ZWJ だけ。連結は、絵文字 20 個まで（それより先の ZWJ は、見える形にする）。
// 連続する ZWJ・絵文字の間に、ほかの見えない文字が挟まる・文字の間の ZWJ・絵文字と文字の間の ZWJ は、この並びに合わず、見える形になる（見えない文字で、指示を隠す余地を、小さく）
const EMOJI_UNIT = '\\p{Extended_Pictographic}(?:\\uFE0F|\\p{Emoji_Modifier})?';
const SAFE_EMOJI = new RegExp(`[0-9#*]\\uFE0F?\\u20E3|${EMOJI_UNIT}(?:\\u200D${EMOJI_UNIT}){1,19}`, 'gu');

export const reveal = (s: string): string => {
  let out = '';
  let from = 0;
  for (const m of s.matchAll(SAFE_EMOJI)) {
    out += revealPlain(s.slice(from, m.index)) + m[0];
    from = m.index + m[0].length;
  }
  return out + revealPlain(s.slice(from));
};

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

/**
 * `{ __rikai: 1, type: 'esc' }` の検査（枠の中の Esc を、親へ転送：個別表示で、閉じる・道具の中止に流す。F43）。**この 2 つのキーだけ**：余分なキー・型違いは、捨てる（false）。
 * 受けるのは、個別表示の枠だけ（親の登録で決まる）。1 つの枠につき、頻度の上限がある（`appBridge.ts`）
 */
export const parseEsc = (data: unknown): boolean =>
  isObj(data) && data.__rikai === 1 && data.type === 'esc' && onlyKeys(data, ['__rikai', 'type']);

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
/** 要素を選んだ下書きの、見出しの行の頭（利用者の文として、自然には書かれない）。「枠から」の札の、ラベル以外の印 */
const PICK_HEAD = `${FROM_FRAME}要素を選びました（枠の自己申告。下の JSON）：`;
/** 要素を選んだ下書きの錨のラベル：`枠から：<tag>`（`tag` は、`shownTag` を通った名前。枠が決めた長い文字は、入れない） */
const PICK_LABEL = /^枠から：[a-z][a-z0-9-]{0,31}$/i;
const hasLine = (text: string, head: string): boolean => text.startsWith(head) || text.includes(`\n${head}`);

/**
 * 錨と、利用者の文（下書き・コメントの最初の発言）が、「枠から」のものか（札を出す）。**錨のラベルだけでは、決めない**
 * （資料の本文に、`<div>枠から：p</div>` と書けば、同じ形の錨ができる：資料は、AI が書く）。次の**両方**が、そろうとき：
 * - 錨：要素を選んだ下書き（`枠から：<tag>`。枠のブロック〔DIV〕・引用なし・範囲なし）か、範囲の画像に、枠自身が作った画像が入った錨（引用なし・範囲あり・ラベルが、注記で終わる）
 * - 文：その下書きを作ったときの、見出しの行（要素を選んだ下書きは `【枠から】要素を選びました（枠の自己申告。下の JSON）：`・範囲の画像は `【枠から（画像）】`）が、行の頭にある
 *   （利用者の文は、利用者の発言：資料は、書けない。利用者が、その行を消せば、札は消える）
 */
export const fromFrameAnchor = (a: Pick<Anchor, 'label' | 'quote' | 'blockTag' | 'rect'>, text: string): boolean =>
  a.quote === '' &&
  ((a.blockTag === 'DIV' && !a.rect && PICK_LABEL.test(a.label) && hasLine(text, PICK_HEAD)) ||
    (!!a.rect && a.label.endsWith(FRAME_IMAGE_NOTE) && hasLine(text, FROM_FRAME_IMAGE)));

/** 選んだ要素の、下書き：錨のラベルと、本文の初期値（1 行の見出し＋ JSON のブロック。あとに、空行：利用者が、続けて書く）。状態があれば、JSON に `state` として入る */
export function pickDraft(pick: PickInfo, stateJson: string | null): { label: string; text: string } {
  const { x, y, w, h } = pick.rect;
  // 見出しの 1 行と錨のラベルには、枠が決めた長い文字（selector・text）も、枠が自由に決められるタグ名（カスタム要素）も、入れない（地の文として並んで、偽の区切り・指示に見えないように）。
  // 出すのは、標準の要素名（またはカスタム要素を表す `custom`）と整数だけ。selector・text・元の tag は、JSON のブロックの中にだけ入る
  const tag = shownTag(pick.tag);
  const head = `${PICK_HEAD}${tag}（x:${x} y:${y} w:${w} h:${h}）`;
  const body: Record<string, unknown> = {
    selector: pick.selector,
    tag: pick.tag,
    text: pick.text,
    rect: pick.rect,
    frame: pick.frame,
    styles: pick.styles,
  };
  if (stateJson !== null) body.state = JSON.parse(stateJson);
  return { label: `枠から：${tag}`, text: `${head}\n\n${jsonBlock(body)}\n\n` };
}

/** 「この枠にコメント」に添える、枠の状態（見出し「枠の状態」＋ JSON のブロック）。状態がなければ、null */
export function stateDraft(stateJson: string | null): string | null {
  if (stateJson === null) return null;
  return `${FROM_FRAME}枠の状態\n\n${jsonBlock(JSON.parse(stateJson))}\n\n`;
}
