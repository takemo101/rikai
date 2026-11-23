// 実行できる枠（html-app）の中身が、画面の配色（ライト／ダーク）への対応を示しているか（F28・F40）。DOM に触れない純粋な関数だけ（サーバー・画面・テストが共有する）。
// 示している資料だけ、橋が、土台のスタイル・ダークへの追従を付ける（オプトイン）。示さない資料（従来の、自分で全部書いたもの）は、従来どおり：土台なし・常にライト。
//
// 対応の印（どれか 1 つ）：
//   1. **橋が配る色の変数を使い、同じ名前を、自分では定義していない**：`var(--color-<名前>` を使っていて（直後が `)`・`,`・空白）、`--color-<名前>:` の定義がない。
//      名前は、`BRIDGE_COLORS`（橋が配る色。土台のスタイルも、これから作る：二重に持たない）。`--color-primary` のような、橋が配らない名前は、対応の印ではない
//      （自分で `--color-*` を作る資料は、AI がよく書く形。土台を付けると、背景だけが残って、ダークで、文字が白くなる）。同じ名前を自分で定義する資料も、対応の印ではない。
//   2. `<meta name="color-scheme" …>`（標準の、明示の宣言）。
// 単純な文字の検査：コメント・文字列の中の `var(--color-bg)` も、使っているとみなす（まれ。土台が付いて、ダークに従う：許容。誤検出の害は、ゼロではない）。
// `data-theme` という文字は、印にしない（本文に書いただけで、true になってしまう）。

/** 橋が配る色。名前 → [ライト, ダーク]（値が 1 つなら、どちらも同じ）。CSS の変数名は `--color-<名前>` */
export const BRIDGE_COLORS = {
  bg: ['#fff', '#09090b'],
  surface: ['#f4f4f5', '#18181b'],
  ink: ['#18181b', '#fafafa'],
  'ink-2': ['#3f3f46', '#d4d4d8'],
  muted: ['#63636b', '#a1a1aa'],
  line: ['#e4e4e7', '#27272a'],
  accent: ['#2563eb', '#60a5fa'],
  'accent-ink': ['#1d4ed8', '#93c5fd'],
  'accent-fill': ['#2563eb'],
  ok: ['#15803d', '#4ade80'],
  warn: ['#b45309', '#fbbf24'],
  err: ['#b91c1c', '#f87171'],
} as const satisfies Record<string, readonly [string] | readonly [string, string]>;

/** 土台のスタイルの `:root` に入れる、色の変数の宣言（`--color-bg:light-dark(#fff,#09090b);…`） */
export const bridgeColorDecls = (): string =>
  Object.entries(BRIDGE_COLORS as Record<string, readonly string[]>)
    .map(([name, v]) => `--color-${name}:${v.length === 2 ? `light-dark(${v[0]},${v[1]})` : v[0]}`)
    .join(';');

const META_SCHEME = /<meta\s[^>]*name\s*=\s*["']?color-scheme/i;
const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\-]/g, '\\$&');
// 名前ごとの、使っている・定義している、の検査（前方一致を避ける：`--color-ink` は、`--color-ink-2` に当たらない）
const CHECKS = Object.keys(BRIDGE_COLORS).map((name) => ({
  used: new RegExp(`var\\(\\s*--color-${escapeRe(name)}(?=[\\s,)])`),
  defined: new RegExp(`--color-${escapeRe(name)}\\s*:`),
}));

/** 枠の中身が、画面の配色に対応しているか（true：土台と、ダークへの追従を付ける） */
export const followsTheme = (content: string): boolean =>
  META_SCHEME.test(content) || CHECKS.some((c) => c.used.test(content) && !c.defined.test(content));
