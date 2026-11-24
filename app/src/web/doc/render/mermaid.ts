// Mermaid の図。mermaid は、動的 import（別の chunk。図のない資料では、読まない）。
// `securityLevel: 'strict'`。図のソースは、`data-mermaid` に、URI エンコードして持つ（DOMPurify が、属性を落とさないように）。
import { $$, h } from '../../lib/dom';
import { type ResolvedTheme, resolvedTheme } from '../../lib/theme';

type MermaidApi = typeof import('mermaid')['default'];

/**
 * 図の配色：ライトは neutral・ダークは dark（画面の外観に合わせる。`securityLevel: 'strict'` は変えない）。
 * ダークは、組み込みの dark では見えにくいところ（円グラフの扇・線・凡例、ノードの白っぽい光る縁）を、`themeVariables` で直す
 */
const DARK_VARIABLES = {
  // 円グラフ：区別できる 12 色（暗い地で、明るさをそろえる）。線は、地の色・凡例と題は、明るい文字
  pie1: '#60a5fa',
  pie2: '#34d399',
  pie3: '#fbbf24',
  pie4: '#f87171',
  pie5: '#a78bfa',
  pie6: '#22d3ee',
  pie7: '#fb923c',
  pie8: '#f472b6',
  pie9: '#a3e635',
  pie10: '#2dd4bf',
  pie11: '#c084fc',
  pie12: '#94a3b8',
  pieStrokeColor: '#09090b',
  pieOuterStrokeColor: '#52525b',
  pieStrokeWidth: '1.5px',
  pieOuterStrokeWidth: '1px',
  pieTitleTextColor: '#fafafa',
  pieSectionTextColor: '#09090b',
  pieLegendTextColor: '#e4e4e7',
  // 光る縁（明るい影）は、やめる
  dropShadow: 'none',
};

function configOf(theme: ResolvedTheme) {
  return {
    startOnLoad: false,
    securityLevel: 'strict' as const,
    theme: theme === 'dark' ? ('dark' as const) : ('neutral' as const),
    fontFamily: 'inherit',
    ...(theme === 'dark' ? { themeVariables: DARK_VARIABLES } : {}),
  };
}

let loading: Promise<MermaidApi> | null = null;
function loadMermaid(): Promise<MermaidApi> {
  loading ??= import('mermaid').then(({ default: mermaid }) => mermaid);
  // 読み込みに失敗したら、次の描画で、もう一度試す
  loading.catch(() => {
    loading = null;
  });
  return loading;
}

/**
 * 描画は、1 本の列（Promise の連鎖）で、1 つずつ：`initialize` は、グローバルで、`render` は、実際に描く時点の設定を読む。
 * 並べて走らせると、待っていた図が、あとから付けた外観で描かれてしまう。毎回、`initialize(外観)` してから `render` し、前の描画が終わるまで、次を始めない
 */
let chain: Promise<unknown> = Promise.resolve();
function renderQueued(theme: ResolvedTheme, id: string, code: string): Promise<string> {
  const run = chain.then(async () => {
    const mermaid = await loadMermaid();
    mermaid.initialize(configOf(theme));
    const { svg } = await mermaid.render(id, code);
    return svg;
  });
  chain = run.catch(() => undefined);
  return run;
}

/** 描いた図（SVG）の、キャッシュ。キーに、外観を含める（ライトの図を、ダークで使い回さない） */
export const svgCacheKey = (theme: ResolvedTheme, code: string): string => `${theme}\n${code}`;
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
    const theme = resolvedTheme();
    const key = svgCacheKey(theme, code);
    const cached = svgCache.get(key);
    if (cached !== undefined) {
      el.innerHTML = cached;
      continue;
    }
    jobs.push(
      (async () => {
        const id = `mmd${++mermaidSeq}`;
        try {
          const svg = await renderQueued(theme, id, code);
          // 描いている間に、外観が変わっていたら、この図は、捨てる（キャッシュに入れない・置かない）。変わったときの描き直しが、いまの外観で描く
          if (resolvedTheme() !== theme) return;
          svgCache.set(key, svg);
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
