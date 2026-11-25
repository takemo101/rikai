// Markdown → 安全な DOM。
// AI が書いた Markdown・HTML は、必ず DOMPurify（`PURIFY`）を通す。html-app の iframe は、無害化の**あとで**足す（apps.ts）。
//
// ## 使い方（資料の本文と、AI の返信は、同じ関数 `mdToFragment(md, slug[, withApps])`）
//   import { fillDiagrams, mdToFragment } from '../doc/render';          // `doc/render/index.ts`
//   const frag = mdToFragment(m.text, { slug, kind: 'reply' });          // 無害化した DocumentFragment
//   body.replaceChildren(frag);
//   void fillDiagrams(body);                                             // 図（`.mermaid-block`・`.drawio-block`）を描く。待たなくてよい
// - 形式（diff・json・terminal・trace）・リンク（http(s)・mailto・`page:`）・画像（`assets/` だけ。外部はブロック表示）・Mermaid・draw.io（```drawio。`<mxGraphModel>` の XML）の置き場は、`doc`・`reply` どちらも同じ。
// - `kind: 'doc'`：資料の本文。```html-app を、枠の置き場（`.htmlapp`）にする（番号は、フェンスの順。サーバーが同じ番号の枠を配る）。
// - `kind: 'reply'`：返信。```html-app は、ふつうのコードブロック。**ブロックの番号づけ（`markBlocks`）は、しない**（本文だけ。呼ぶ側の仕事）。
// - `fillApps`（枠に iframe を入れる）も、本文だけ。返信では呼ばない。
import DOMPurify, { type Config } from 'dompurify';
import { Marked } from 'marked';
import { encSrc, h } from '../../lib/dom';
import { render as renderFmt } from './fmt';

export const PURIFY: Config = {
  USE_PROFILES: { html: true, svg: true },
  FORBID_TAGS: [
    'style',
    'script',
    'iframe',
    'form',
    'input',
    'button',
    'textarea',
    'select',
    'object',
    'embed',
    'link',
    'meta',
    'base',
    'dialog',
  ],
  FORBID_ATTR: ['style', 'srcset', 'formaction', 'ping'],
  ALLOWED_URI_REGEXP: /^(?:(?:https?|mailto|page):|[^a-z]|[a-z+.-]+(?:[^a-z+.\-:]|$))/i,
};

// 実行できる枠（html-app）：資料の ```html-app フェンスを、枠の置き場（div.htmlapp）にする。中身（JavaScript）は、ここでは、扱わない。
// サーバーが、同じ版の資料から、n 番目のフェンスを取り出して、隔離する CSP つきで配る（/appframe）。n は、資料の本文の描画だけが数える（appCtx）。
// 返信・前の版の差分では、枠にしない（ふつうのコードブロック）
let appCtx: { n: number; srcs: string[] } | null = null;

/**
 * 枠の高さ（情報文字列）：`height=480`（120〜1200px）は、**固定**。`height` がない・`height=auto`・読めない値は、`auto`（枠の中身に合わせて、枠が、高さを知らせる。apps.ts・frameBridge.ts）。
 * 従来の資料（`height=` を書いたもの）は、固定のまま
 */
export function appHeight(info: string): number | 'auto' {
  const m = /\bheight=(\d{2,4})(?:px)?\b/.exec(info);
  return m ? Math.min(1200, Math.max(120, Number(m[1]))) : 'auto';
}

const marked = new Marked({
  gfm: true,
  renderer: {
    code({ text, lang }) {
      const kind = (lang || '').trim().split(/\s+/)[0]?.toLowerCase() ?? '';
      if (kind === 'mermaid') return `<div class="mermaid-block" data-mermaid="${encSrc(text)}"></div>`;
      if (kind === 'drawio') return `<div class="drawio-block" data-drawio="${encSrc(text)}"></div>`;
      if (kind === 'html-app') {
        if (!appCtx) return false;
        const n = appCtx.n++;
        // ソースは、ここで持つ（属性に入れない：資料の生の HTML で、偽の data-src を書かれても、ソースの表示・位置づけ・差分に、使わない）
        appCtx.srcs[n] = text;
        const ht = appHeight(lang || '');
        // 見出し（`.cap`）は、空：安全の注意（隔離・秘密を入力しない）は、見える文字としては出さない（利用者の決定：2026-11-25）。見出しの `title`・`aria-label` に持つ（`htmlapp/apps.ts`）
        return `<div class="htmlapp" data-n="${n}" data-h="${ht}"><div class="cap"></div></div>`;
      }
      // diff・json・terminal（ANSI）・trace：決まった形の HTML にする（文字は escape 済み。読めないものは、ふつうのコードブロック）
      return renderFmt(kind, text) ?? false;
    },
  },
});

export interface MarkdownOptions {
  /** トピックの slug（`page:` のリンク・画像の URL に使う） */
  slug: string;
  /** `doc`：資料の本文（html-app を枠の置き場にする）／`reply`：AI の返信（html-app は、ふつうのコードブロック） */
  kind: 'doc' | 'reply';
}

/** Markdown を、無害化した断片にする（使い方は、ファイルの先頭） */
export function mdToFragment(md: string | null | undefined, { slug: topic, kind }: MarkdownOptions): DocumentFragment {
  appCtx = kind === 'doc' ? { n: 0, srcs: [] } : null;
  const srcs = appCtx ? appCtx.srcs : [];
  let html: string;
  try {
    html = marked.parse(md || '', { async: false });
  } finally {
    appCtx = null;
  }
  const clean = DOMPurify.sanitize(html, PURIFY);
  const tpl = document.createElement('template');
  tpl.innerHTML = clean;
  const root = tpl.content;

  // 実行できる枠のソース：無害化のあとに、表（srcs）から、ここで付ける。資料の生の HTML が持つ `data-src` は、上書き・削除する（偽のソースを、見せない）
  for (const el of root.querySelectorAll<HTMLElement>('.htmlapp')) {
    const n = Number(el.dataset.n);
    const src = Number.isInteger(n) ? srcs[n] : undefined;
    if (src !== undefined) el.dataset.src = encSrc(src);
    else el.removeAttribute('data-src');
  }
  // trace の棒の位置・長さ：`style` 属性は無害化で消えるので、無害化のあとに、数だけから、ここで設定する
  for (const b of root.querySelectorAll<HTMLElement>('.fmt-trace .tb')) {
    const s = Number(b.dataset.s);
    const w = Number(b.dataset.w);
    if (Number.isFinite(s) && Number.isFinite(w)) {
      b.style.left = `${Math.min(Math.max(s, 0), 100)}%`;
      b.style.width = `${Math.min(Math.max(w, 0.4), 100)}%`;
    }
  }
  for (const a of root.querySelectorAll<HTMLAnchorElement>('a[href]')) {
    const href = a.getAttribute('href') ?? '';
    if (href.startsWith('page:')) {
      const id = href.slice(5);
      a.setAttribute('href', `#/${topic}/${id}`);
      a.dataset.page = id;
      a.classList.add('pagelink');
    } else if (/^(https?:|mailto:)/i.test(href)) {
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
    } else a.removeAttribute('href');
  }
  for (const img of root.querySelectorAll('img')) {
    const src = img.getAttribute('src') || '';
    if (/^data:image\//i.test(src)) continue;
    if (/^([a-z][a-z0-9+.-]*:|\/\/)/i.test(src)) {
      img.replaceWith(h('span', { class: 'img-blocked', text: `[外部画像は表示しません: ${img.alt || src}]` }));
      continue;
    }
    const p = src.replace(/^\.\//, '').replace(/^assets\//, '');
    img.setAttribute('src', `/asset/${encodeURIComponent(topic)}/${p.split('/').map(encodeURIComponent).join('/')}`);
    img.loading = 'lazy';
  }
  return root;
}
