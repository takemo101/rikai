// html-app の枠 → 画面の「書き戻し」（F42）と、枠から取った情報（`frameMeta`。F45）：メッセージの検査と、保存・送信の形の検査。DOM に触れない純粋な関数だけ（画面・サーバー・橋のスクリプト・テストが共有する）。
// 枠の中のコードは、非信頼：**枠から来た値は、文字・画像のデータとして、形・大きさ・値の範囲を、ここで確かめてから**使う（`innerHTML`・`eval`・`href` には、入れない）。
// 検査は、手で書く（画面は、Zod をバンドルに入れない：`web/api/events.ts` と同じ流儀）。返す値は、**新しく作ったオブジェクト**（枠が渡した object を、そのまま使わない：`__proto__` などで、壊れない）。
// 枠が送れるのは、`{ __rikai: 1, type, … }`。余分なキーがあるメッセージは、捨てる（厳密）。
// **`frameMeta`（コメントのメッセージの、省略できる項目）の検査は、`parseFrameMeta` の 1 か所**：画面（下書きに入れるとき）と、サーバー（送られてきたとき。画面を信用しない）が、同じ関数を使う。

// **見えない・紛らわしい文字は、見える形にする**（`reveal`）：枠が、Unicode のタグ文字（U+E0000〜E007F。画面に何も描かれない）・異体字セレクタ（U+E0100〜E01EF など）・ゼロ幅・方向の制御（RLO）・
// 私用・未割り当て・対でないサロゲート・制御文字・「無視してよい」文字（Default_Ignorable）・空白に見える字（点字の空白・ハングルの空白）・結合記号の重ね書きで、
// 利用者に見えない文を、コメントの下書きに入れて、AI に読ませないように。取り除かず、`\uXXXX`（BMP の外は `\u{XXXXX}`）にして、利用者が気づけるようにする。
// 検査の段階（`parsePick`・`parseState`）で、**枠から来た文字列（selector・text・styles の値・state の文字列とキー）に、一度だけ**かける。保存・送信の形の検査（`parseFrameMeta`）も、同じ関数を通す
// （すでに見える形のものは、そのまま：何度かけても同じ。サーバーは、画面を信用せず、もう一度かける）。長さの上限は、置き換えの前の長さで測り（`shownLength`）、置き換えのあとの `state` が 8KB を超えたら捨てる（置き換えで、上限を迂回できない）。
import { FRAME_IMAGE_NOTE } from './htmlapp-note';
import { IMG_OUT_MAX_SIDE } from './image';
import type { Anchor, FrameMeta, FramePick } from './types';

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
 * 見出し・ラベルには出さず、`custom` にする（元の名前は、開いたメタデータの `tag` にだけ入る）
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
/** 見た目の値 1 つの長さの上限（`font-family` などが、切れないように 300。橋のスクリプトも、この値で切る）。`text` は 80・`selector` は 200 のまま */
export const STYLE_VALUE_MAX = 300;
const SELECTOR_MAX = 200;
const TEXT_MAX = 80;
const COORD_MAX = 100_000;

/** 選んだ要素の情報（`parsePick` の出力。`frameMeta.pick` と同じ形） */
export type PickInfo = FramePick;

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

const PICK_FIELDS = ['selector', 'tag', 'text', 'rect', 'styles', 'frame'] as const;

/**
 * 文字列の長さの数え方。枠から届いたもの（`rawLength`）は、そのまま数える。保存した形（`shownLength`）は、`reveal` が作った `\uXXXX`・`\u{XXXXX}` を 1 文字と数える
 * （見える形にしたあとでも、元の上限〔selector 200・text 80・state の文字列 1000 など〕で測る。全体の 8KB・16KB の上限が、実際の大きさを抑える）
 */
type Len = (s: string) => number;
const rawLength: Len = (s) => s.length;
const shownLength: Len = (s) => s.replace(/\\u(?:\{[0-9A-F]{5,6}\}|[0-9A-F]{4})/g, '.').length;

/** `pick` の中身（selector・tag・text・rect・styles・frame）の検査。キーの過不足は、呼ぶ側が見る。厳密：型違い・長すぎる・NaN・許可リストにないスタイルは、全体を捨てる（null）。文字列には `reveal` をかける */
function pickFields(data: Obj, len: Len): PickInfo | null {
  const { selector, tag, text, rect, styles, frame } = data;
  if (typeof selector !== 'string' || !selector || len(selector) > SELECTOR_MAX) return null;
  if (typeof tag !== 'string' || !TAG.test(tag)) return null;
  if (typeof text !== 'string' || len(text) > TEXT_MAX) return null;
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
    if (!STYLE_SET.has(k) || typeof v !== 'string' || len(v) > STYLE_VALUE_MAX) return null;
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

/** `{ __rikai: 1, type: 'pick', selector, tag, text, rect, styles, frame }` の検査。厳密：余分なキー・型違い・長すぎる・NaN・許可リストにないスタイルは、全体を捨てる（null） */
export function parsePick(data: unknown): PickInfo | null {
  if (!isObj(data) || data.__rikai !== 1 || data.type !== 'pick') return null;
  if (!onlyKeys(data, ['__rikai', 'type', ...PICK_FIELDS])) return null;
  return pickFields(data, rawLength);
}

const byteLength = (s: string): number => new TextEncoder().encode(s).length;

/** JSON の値が、深さ・要素数・文字列の長さの上限の中か（循環は、JSON.parse の結果にはない） */
function withinLimits(v: unknown, len: Len): boolean {
  let nodes = 0;
  const walk = (x: unknown, depth: number): boolean => {
    if (++nodes > STATE_MAX_NODES || depth > STATE_MAX_DEPTH) return false;
    if (typeof x === 'string') return len(x) <= STATE_MAX_STRING;
    if (Array.isArray(x)) return x.every((y) => walk(y, depth + 1));
    if (isObj(x)) return Object.keys(x).every((k) => len(k) <= STATE_MAX_KEY && walk(x[k], depth + 1));
    return true;
  };
  return walk(v, 1);
}

/**
 * 状態の値（JSON として読んだもの）の検査：object か配列・深さ 8・要素 500・文字列 1000 文字・キー 100 文字まで。
 * 返すのは、**見える形にして、書き直した JSON の文字列**（置き換えで長くなっても、8KB〔UTF-8〕を超えたら捨てる）。それ以外は null
 */
function checkState(v: unknown, len: Len): string | null {
  if (v === null || typeof v !== 'object' || !withinLimits(v, len)) return null; // 状態は、object か配列
  const out = JSON.stringify(revealDeep(v));
  return byteLength(out) <= STATE_MAX_BYTES ? out : null;
}

/** 状態の JSON の文字列の検査：文字列・8KB（UTF-8）以下・JSON として読める・深さ 8・要素 500・文字列 1000 文字・キー 100 文字まで。**読み直して、見える形にして、書き直した JSON の文字列**を返す。それ以外は null */
function stateText(json: unknown, len: Len): string | null {
  if (typeof json !== 'string' || !json || byteLength(json) > STATE_MAX_BYTES) return null;
  let v: unknown;
  try {
    v = JSON.parse(json);
  } catch {
    return null;
  }
  return checkState(v, len);
}

/**
 * `{ __rikai: 1, type: 'state', json }` の検査。json は、文字列・8KB（UTF-8）以下・JSON として読める・深さ 8・要素 500・文字列 1000 文字・キー 100 文字まで。
 * 返すのは、**読み直して、書き直した JSON の文字列**（`JSON.stringify(JSON.parse(json))`）。枠の文字列そのものは、使わない。それ以外は null
 */
export function parseState(data: unknown): string | null {
  if (!isObj(data) || data.__rikai !== 1 || data.type !== 'state' || !onlyKeys(data, ['__rikai', 'type', 'json']))
    return null;
  return stateText(data.json, rawLength);
}

/** `frameMeta` 全体の大きさの上限（`JSON.stringify` の UTF-8。メッセージ 1 つあたり）。`state` の 8KB に、`pick`（約 2〜4KB）が入る大きさ */
export const FRAME_META_MAX_BYTES = 16384;
export type FrameMetaResult = { ok: true; meta: FrameMeta } | { ok: false; reason: string; tooBig?: true };
const rejected = (reason: string): FrameMetaResult => ({ ok: false, reason });

/**
 * `frameMeta`（`{ pick?, state?, imageFromFrame? }`）の検査（F45）。画面が下書きに入れるとき・サーバーがコメントを受けるとき（**サーバーは、画面を信用しない**）の、同じ関数。
 * 厳密：object・余分なキー（`__proto__` を含む）なし・空でない・`pick` は `parsePick` と同じ形・`state` は `parseState` の出力と同じ形（JSON の文字列。再シリアライズして 8KB・深さ 8・要素 500・文字列 1000）・
 * `imageFromFrame` は `true` だけ・全体で 16KB まで。文字列には `reveal` をかける（すでに見える形のものは、そのまま：何度かけても同じ）。返すのは、**新しく作ったオブジェクト**。
 * 失敗は、`reason`（何が悪いか。値は含めない）。大きさの超過は `tooBig`
 */
export function parseFrameMeta(data: unknown): FrameMetaResult {
  if (!isObj(data)) return rejected('frameMeta は、オブジェクトで送ってください');
  if (!onlyKeys(data, ['pick', 'state', 'imageFromFrame'])) return rejected('frameMeta に、使えないキーがあります');
  const meta: FrameMeta = {};
  if (data.pick !== undefined) {
    const pick = isObj(data.pick) && onlyKeys(data.pick, PICK_FIELDS) ? pickFields(data.pick, shownLength) : null;
    if (!pick)
      return rejected(
        'frameMeta.pick の形が不正です（selector・tag・text・rect・styles・frame。長さ・値の範囲に収める）',
      );
    meta.pick = pick;
  }
  if (data.state !== undefined) {
    const out = stateText(data.state, shownLength);
    if (out === null)
      return rejected(
        'frameMeta.state が不正です（オブジェクトか配列の JSON の文字列。8KB・深さ 8・要素 500・文字列 1000 文字まで）',
      );
    meta.state = out;
  }
  if (data.imageFromFrame !== undefined) {
    if (data.imageFromFrame !== true) return rejected('frameMeta.imageFromFrame は、true だけです');
    meta.imageFromFrame = true;
  }
  if (meta.pick === undefined && meta.state === undefined && !meta.imageFromFrame)
    return rejected('frameMeta が空です');
  if (byteLength(JSON.stringify(meta)) > FRAME_META_MAX_BYTES)
    return { ok: false, reason: `frameMeta が大きすぎます（${FRAME_META_MAX_BYTES / 1024}KB まで）`, tooBig: true };
  return { ok: true, meta };
}

/**
 * `{ __rikai: 1, type: 'esc' }` の検査（枠の中の Esc を、親へ転送：個別表示で、閉じる・道具の中止に流す。F43）。**この 2 つのキーだけ**：余分なキー・型違いは、捨てる（false）。
 * 受けるのは、個別表示の枠だけ（親の登録で決まる）。1 つの枠につき、頻度の上限がある（`web/htmlapp/frameBridge.ts`）
 */
export const parseEsc = (data: unknown): boolean =>
  isObj(data) && data.__rikai === 1 && data.type === 'esc' && onlyKeys(data, ['__rikai', 'type']);

/** 枠の画像（`snapshot`）の、data URL の長さの上限（約 1.5MB）と、1 辺の上限（px） */
export const SNAPSHOT_MAX_CHARS = 1_600_000;
export const SNAPSHOT_MAX_SIDE = IMG_OUT_MAX_SIDE;
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

/** 旧い形のコメント（0.25.x まで）の、枠から来たことを示す印：本文の先頭の見出し。**いまは、本文に書かない**（`frameMeta` を持つ）。旧いコメントの札の判定のためだけに、残してある */
const FROM_FRAME = '【枠から】';
const FROM_FRAME_IMAGE = '【枠から（画像）】';
/** 旧い形：要素を選んだ下書きの、見出しの行の頭 */
const PICK_HEAD = `${FROM_FRAME}要素を選びました（枠の自己申告。下の JSON）：`;
/** 要素を選んだ下書きの錨のラベル：`枠から：<tag>`（`tag` は、`shownTag` を通った名前。枠が決めた長い文字は、入れない） */
const PICK_LABEL = /^枠から：[a-z][a-z0-9-]{0,31}$/i;
const hasLine = (text: string, head: string): boolean => text.startsWith(head) || text.includes(`\n${head}`);

/** 選んだ要素の錨のラベル：`枠から：<tag>`（見出し・ラベルに出すタグ名だけ。selector・text は入れない） */
export const pickLabel = (pick: PickInfo): string => `枠から：${shownTag(pick.tag)}`;

/**
 * **旧い形のコメント**（`frameMeta` を持たない。本文に見出しと JSON を書いていた 0.25.x まで）が、「枠から」のものか（札を出す）。**新しい形は、`frameMeta` の有無で決める。これは使わない**。
 * 錨のラベルだけでは、決めない（資料の本文に、`<div>枠から：p</div>` と書けば、同じ形の錨ができる：資料は、AI が書く）。次の**両方**が、そろうとき：
 * - 錨：要素を選んだ下書き（`枠から：<tag>`。枠のブロック〔DIV〕・引用なし・範囲なし）か、範囲の画像に、枠自身が作った画像が入った錨（引用なし・範囲あり・ラベルが、注記で終わる）
 * - 文：その下書きを作ったときの、見出しの行（要素を選んだ下書きは `【枠から】要素を選びました（枠の自己申告。下の JSON）：`・範囲の画像は `【枠から（画像）】`）が、行の頭にある
 */
export const isLegacyFromFrame = (a: Pick<Anchor, 'label' | 'quote' | 'blockTag' | 'rect'>, text: string): boolean =>
  a.quote === '' &&
  ((a.blockTag === 'DIV' && !a.rect && PICK_LABEL.test(a.label) && hasLine(text, PICK_HEAD)) ||
    (!!a.rect && a.label.endsWith(FRAME_IMAGE_NOTE) && hasLine(text, FROM_FRAME_IMAGE)));

/** 情報の行の、1 行の説明（`枠から：` に続く）：要素を選びました（button・x:113 y:133 w:93 h:34）／枠の状態／枠の画像は、枠自身が作ったもの。タグ名は、標準の要素名か `custom`（枠が決めた長い名前は、出さない） */
export function frameMetaSummary(meta: FrameMeta): string {
  const parts: string[] = [];
  if (meta.pick) {
    const { x, y, w, h } = meta.pick.rect;
    parts.push(`要素を選びました（${shownTag(meta.pick.tag)}・x:${x} y:${y} w:${w} h:${h}）`);
  }
  if (meta.state !== undefined) parts.push('枠の状態');
  if (meta.imageFromFrame) parts.push('枠の画像は、枠自身が作ったもの');
  return parts.join('／');
}
