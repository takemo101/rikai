// 数式の拡大表示の、複製：押された、描いた数式（`.katex`。HTML）を、`cloneNode(true)` で複製する（すでに無害化した DOM のコピー。文字列から作らない）。
// 数式は、SVG ではなく HTML（KaTeX の出力）なので、図のように、SVG を拡大するのではなく、**HTML を、そのまま `transform: scale` で拡大する**（ステージは、自然な大きさの箱の中に、複製を置く：`ZoomView.tsx`）。
// 範囲を選ぶ基準の箱は、式そのもの（`.katex` の箱）：本文の基準（`frameOf`）と、同じ箱。複製は、同じ CSS（`.math-block` と同じ規則を、`.zoom-math` にも適用：app.css）・同じ文字の大きさで置くので、箱の大きさが、本文と同じになる。
// 複製に、`id` はない（KaTeX は、`id` を出さない：`\htmlId` は、信頼しない設定で無効）ので、図のような、付け替えは要らない。
import { h } from '../lib/dom';
import type { Size } from '../lib/geom';

export interface ZoomMath {
  node: HTMLElement;
  /** 自然な大きさ（本文の、式の箱と同じ。px） */
  size: Size;
}

/**
 * 描いた数式（`.katex`）を、拡大表示用に複製する。式の箱（自然な大きさ）を測れない（隠れている・大きさがない）なら null。
 * 本文の式の、親の文字の大きさを写す（`.katex` の `1.21em` が、同じ px になる）。別行の数式は、`.katex-display` の中の `.katex`：外側（`.katex-display`）ごと複製する（式の高さ・位置が、本文と同じ構造で決まる）
 */
export function cloneMathForZoom(src: HTMLElement): ZoomMath | null {
  const box = src.getBoundingClientRect();
  if (!(box.width > 0 && box.height > 0)) return null;
  const outer = src.parentElement?.classList.contains('katex-display') ? src.parentElement : src;
  const node = h('div', { class: 'zoom-math' });
  node.style.fontSize = getComputedStyle(outer.parentElement ?? src).fontSize;
  node.append(outer.cloneNode(true));
  return { node, size: { w: box.width, h: box.height } };
}
