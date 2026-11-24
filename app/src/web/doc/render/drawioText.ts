// draw.io のラベルの文字：HTML の無害化（タグを外した文字にする）・文字幅の見積もり・折り返し。
// **ラベルは、資料の XML が持つ非信頼の値**：`html=1` のとき、`DOMParser` で `text/html` として読む（文書は、閲覧コンテキストを持たない：スクリプトは動かず、画像・リンクは読み込まれない）
// → 木をたどって**文字だけ**を取る（`<br>`・ブロック要素の切れ目は改行。`<script>`・`<style>` などの中身は捨てる）。**リンク・画像の URL・属性は、一切出さない**。

/** 文字の幅を測る関数（px）。ブラウザでは canvas の `measureText`、テストでは近似 */
export type Measure = (text: string, fontSize: number, bold: boolean) => number;

const SKIP = new Set([
  'SCRIPT',
  'STYLE',
  'NOSCRIPT',
  'TEMPLATE',
  'IFRAME',
  'OBJECT',
  'EMBED',
  'HEAD',
  'TITLE',
  'SVG',
  'MATH',
]);
const BLOCK = new Set([
  'DIV',
  'P',
  'LI',
  'TR',
  'H1',
  'H2',
  'H3',
  'H4',
  'H5',
  'H6',
  'UL',
  'OL',
  'TABLE',
  'BLOCKQUOTE',
  'PRE',
  'HR',
]);

/** ラベルの文字の長さの上限（これを超える分は捨てる） */
export const LABEL_MAX = 2000;

/** HTML のラベルを、文字だけにする。`<br>`→改行・ブロック要素→改行・その他のタグは捨てる */
export function htmlToText(html: string): string {
  const src = html.slice(0, LABEL_MAX * 4);
  // タグが 1 つもなければ、パースしない（ふつうの文字）。`&` の実体は、パーサーが戻す
  if (!/[<&]/.test(src)) return src.slice(0, LABEL_MAX);
  const doc = new DOMParser().parseFromString(src, 'text/html');
  let out = '';
  const walk = (node: Node): void => {
    for (let n = node.firstChild; n; n = n.nextSibling) {
      if (out.length > LABEL_MAX) return;
      if (n.nodeType === 3) {
        out += n.nodeValue ?? '';
      } else if (n.nodeType === 1) {
        const tag = (n as Element).tagName.toUpperCase();
        if (SKIP.has(tag)) continue;
        if (tag === 'BR') out += '\n';
        else if (BLOCK.has(tag)) {
          if (out && !out.endsWith('\n')) out += '\n';
          walk(n);
          if (out && !out.endsWith('\n')) out += '\n';
        } else walk(n);
      }
    }
  };
  walk(doc.body);
  return out
    .replace(/\u00a0/g, ' ')
    .replace(/\n+$/, '')
    .slice(0, LABEL_MAX);
}

/** 全角（CJK・かな・全角記号）の文字か（幅 = 1em として扱う） */
const WIDE =
  /[\u1100-\u115f\u2e80-\u303e\u3041-\u33ff\u3400-\u4dbf\u4e00-\ua4cf\uac00-\ud7a3\uf900-\ufaff\ufe30-\ufe6f\uff00-\uff60\uffe0-\uffe6]|[\u{20000}-\u{3fffd}]/u;

/** 文字幅の近似（canvas を使えないとき・テスト）：全角は 1em・英数字は 0.56em・空白は 0.3em */
export const approxMeasure: Measure = (text, fontSize, bold) => {
  let w = 0;
  for (const ch of text) w += WIDE.test(ch) ? 1 : ch === ' ' ? 0.3 : /[A-Z0-9]/.test(ch) ? 0.64 : 0.54;
  return w * fontSize * (bold ? 1.06 : 1);
};

/** 行頭に置かない文字（閉じ括弧・句読点・小書きのかな・長音） */
const NO_LINE_START =
  /^[、。，．,.)）\]］}｝〕〉》」』】!！?？:：;；ー々ぁぃぅぇぉっゃゅょゎ゛゜ァィゥェォッャュョヮ…‥%]/;
/** 行末に置かない文字（開き括弧） */
const NO_LINE_END = /[(（[［{｛〔〈《「『【]$/;

/** 折り返しの単位（空白区切りの語・全角 1 文字ごと）。語の後ろの空白は、語につける */
function tokens(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  for (const ch of line) {
    if (WIDE.test(ch)) {
      // 行頭に置けない文字は、前の単位につける
      if (NO_LINE_START.test(ch) && (cur || out.length)) {
        if (cur) cur += ch;
        else out[out.length - 1] += ch;
        continue;
      }
      if (cur) out.push(cur);
      cur = ch;
      out.push(cur);
      cur = '';
    } else if (ch === ' ') {
      cur += ch;
      out.push(cur);
      cur = '';
    } else {
      if (NO_LINE_START.test(ch) && !cur && out.length) {
        out[out.length - 1] += ch;
        continue;
      }
      cur += ch;
    }
  }
  if (cur) out.push(cur);
  // 開き括弧は、次の単位につける
  const merged: string[] = [];
  for (const t of out) {
    const prev = merged[merged.length - 1];
    if (prev !== undefined && NO_LINE_END.test(prev)) merged[merged.length - 1] = prev + t;
    else merged.push(t);
  }
  return merged;
}

/** 行数の上限（資料が、巨大な行数を作らないように） */
const LINES_MAX = 200;

/**
 * 文字を、幅 `width`（px）で折り返す。改行（`\n`）は、段落の切れ目。`width` が null なら、折り返さない（改行だけ）。
 * 1 つの単位が幅を超えるときは、文字ごとに割る。行末の空白は、幅に入れない
 */
export function wrapText(
  text: string,
  width: number | null,
  fontSize: number,
  bold: boolean,
  measure: Measure,
): string[] {
  const lines: string[] = [];
  for (const para of text.split('\n')) {
    if (lines.length >= LINES_MAX) break;
    if (width === null || width <= 0) {
      lines.push(para);
      continue;
    }
    let cur = '';
    const push = (): void => {
      lines.push(cur.replace(/\s+$/, ''));
      cur = '';
    };
    for (const tok of tokens(para)) {
      if (measure((cur + tok).replace(/\s+$/, ''), fontSize, bold) <= width) {
        cur += tok;
        continue;
      }
      if (cur) push();
      if (measure(tok.replace(/\s+$/, ''), fontSize, bold) <= width) {
        cur = tok;
        continue;
      }
      // 単位が、幅を超える：文字ごとに割る
      for (const ch of tok) {
        if (cur && measure(cur + ch, fontSize, bold) > width) push();
        cur += ch;
      }
    }
    push();
  }
  return lines.slice(0, LINES_MAX);
}

/** 行の幅の最大 */
export function maxLineWidth(lines: readonly string[], fontSize: number, bold: boolean, measure: Measure): number {
  let w = 0;
  for (const l of lines) w = Math.max(w, measure(l, fontSize, bold));
  return w;
}

/** canvas の `measureText` で測る関数（使えなければ近似）。同じ文字・大きさの結果は、覚える */
export function canvasMeasure(family: string): Measure {
  let ctx: CanvasRenderingContext2D | null = null;
  try {
    ctx = document.createElement('canvas').getContext('2d');
  } catch {
    ctx = null;
  }
  if (!ctx) return approxMeasure;
  const c = ctx;
  const memo = new Map<string, number>();
  return (text, fontSize, bold) => {
    if (!text) return 0;
    const key = `${bold ? 'b' : 'n'}${fontSize}\n${text}`;
    let w = memo.get(key);
    if (w === undefined) {
      c.font = `${bold ? 'bold ' : ''}${fontSize}px ${family}`;
      w = c.measureText(text).width;
      if (memo.size > 5000) memo.clear();
      memo.set(key, w);
    }
    return w;
  };
}
