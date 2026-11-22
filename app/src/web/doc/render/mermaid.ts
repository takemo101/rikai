// Mermaid の図（旧 app.js の `fillMermaid`）。mermaid は、動的 import（別の chunk。図のない資料では、読まない）。
// `securityLevel: 'strict'`。図のソースは、`data-mermaid` に、URI エンコードして持つ（DOMPurify が、属性を落とさないように）。
import { $$, h } from '../../lib/dom';

type MermaidApi = typeof import('mermaid')['default'];

let loading: Promise<MermaidApi> | null = null;
function loadMermaid(): Promise<MermaidApi> {
  loading ??= import('mermaid').then(({ default: mermaid }) => {
    mermaid.initialize({ startOnLoad: false, securityLevel: 'strict', theme: 'neutral', fontFamily: 'inherit' });
    return mermaid;
  });
  // 読み込みに失敗したら、次の描画で、もう一度試す
  loading.catch(() => {
    loading = null;
  });
  return loading;
}

const svgCache = new Map<string, string>();
let mermaidSeq = 0;

export async function fillMermaid(container: ParentNode): Promise<void> {
  const jobs: Promise<void>[] = [];
  for (const el of $$('.mermaid-block', container)) {
    let code: string;
    try {
      code = decodeURIComponent(el.dataset.mermaid || '');
    } catch {
      code = el.dataset.mermaid || '';
    }
    const cached = svgCache.get(code);
    if (cached !== undefined) {
      el.innerHTML = cached;
      continue;
    }
    jobs.push(
      (async () => {
        const id = `mmd${++mermaidSeq}`;
        try {
          const mermaid = await loadMermaid();
          const { svg } = await mermaid.render(id, code);
          svgCache.set(code, svg);
          el.innerHTML = svg;
        } catch {
          document.getElementById(`d${id}`)?.remove();
          el.classList.add('mermaid-error');
          el.replaceChildren(h('div', { class: 'mm-err', text: '図を描画できませんでした' }), h('pre', { text: code }));
        }
      })(),
    );
  }
  await Promise.all(jobs);
}
