// draw.io の図（```drawio）：Mermaid の図と同じ経路（本文のブロック `.drawio-block`・インライン SVG）。
// 置き場は、`markdown.ts` が作る（`data-drawio`＝URI エンコードした XML）。描画の本体（`drawioRender.ts`）は、**動的 import**：図のない資料では、読まない。
// 描いた SVG は、外観とソースをキーに覚える（再描画のたびに、組み直さない。`cloneNode(true)` で置く：HTML の文字列を使わない・`innerHTML` を使わない）。失敗の表示も覚える。
import { $$, h } from '../../lib/dom';
import { resolvedTheme } from '../../lib/theme';
import { safeDecode } from './blocks';

type Done = { ok: true; svg: SVGSVGElement; notes: string[] } | { ok: false; message: string };

const CACHE_MAX = 60;
const cache = new Map<string, Done>();
const key = (theme: string, src: string): string => `${theme}\n${src}`;

/** 失敗の表示：ソースの表示の長さの上限 */
const SOURCE_SHOWN = 3000;

function show(el: HTMLElement, src: string, done: Done): void {
  el.classList.remove('mermaid-error', 'drawio-error');
  if (done.ok) {
    const kids: Element[] = [done.svg.cloneNode(true) as SVGSVGElement];
    if (done.notes.length) kids.push(h('div', { class: 'dx-note', text: `※ ${done.notes.join('／')}` }));
    el.replaceChildren(...kids);
    return;
  }
  el.classList.add('mermaid-error', 'drawio-error');
  const shown = src.length > SOURCE_SHOWN ? `${src.slice(0, SOURCE_SHOWN)}\n…（以下省略）` : src;
  el.replaceChildren(
    h('div', { class: 'mm-err', text: `図を描画できませんでした（draw.io）：${done.message}` }),
    h('pre', { text: shown }),
  );
}

export async function fillDrawio(container: ParentNode): Promise<void> {
  const jobs: Promise<void>[] = [];
  for (const el of $$('.drawio-block', container)) {
    const raw = el.dataset.drawio || '';
    const src = safeDecode(raw);
    const theme = resolvedTheme();
    const k = key(theme, src);
    const hit = cache.get(k);
    if (hit) {
      show(el, src, hit);
      continue;
    }
    jobs.push(
      (async () => {
        let done: Done;
        try {
          const { renderDrawio } = await import('./drawioRender');
          const r = await renderDrawio(src, theme);
          done = { ok: true, svg: r.svg, notes: r.notes };
        } catch (e) {
          done = {
            ok: false,
            message: e instanceof Error && e.name === 'DrawioError' ? e.message : '描画中にエラーが起きました',
          };
        }
        if (cache.size >= CACHE_MAX) cache.clear();
        cache.set(k, done);
        // 描いている間に、ブロックが差し替わった・外観が変わったなら、置かない（変わったときの描き直しが、いまの状態で描く）
        if (!el.isConnected || (el.dataset.drawio || '') !== raw || resolvedTheme() !== theme) return;
        show(el, src, done);
      })(),
    );
  }
  await Promise.all(jobs);
}
