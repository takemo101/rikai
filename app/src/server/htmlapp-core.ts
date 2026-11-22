// html-app：資料（Markdown）の ```html-app フェンス（JavaScript を動かす、隔離した枠の中身）を取り出す。何も実行しない。
// 数え方は、ブラウザの描画と同じ（marked の字句解析を、そのまま使う。フェンスは、文書の順に 0 から数える）。
// worker（htmlapp-worker.ts）と、サーバー側の同期の取り出し（テスト）が共有する。
import { Lexer, type Token } from 'marked';

/** ブラウザの `renderer.code` と同じ判定：情報文字列の最初の語が html-app */
export const kindOf = (lang: unknown): string =>
  String(lang || '')
    .trim()
    .split(/\s+/)[0]
    ?.toLowerCase() ?? '';

const subTokens = (t: Token, key: 'tokens' | 'items'): Token[] | undefined => {
  const v = key in t ? (t as Record<string, unknown>)[key] : undefined;
  return Array.isArray(v) ? (v as Token[]) : undefined;
};

/**
 * 資料の中の、html-app フェンスの中身（文書の順）。入れ子（箇条書き・引用の中）も、字句解析の順で数える。
 * ブロックの字句解析だけを使う（フェンスは、ブロックのトークン。行の中の解析は、要らない）。改行の正規化は、marked の `lex` と同じ
 */
export function appsOf(markdown: unknown): string[] {
  const out: string[] = [];
  const walk = (tokens: Token[] | undefined): void => {
    for (const t of tokens || []) {
      if (t.type === 'code' && 'lang' in t && kindOf(t.lang) === 'html-app')
        out.push(String('text' in t ? t.text : ''));
      walk(subTokens(t, 'tokens'));
      walk(subTokens(t, 'items'));
    }
  };
  walk(new Lexer().blockTokens(String(markdown || '').replace(/\r\n|\r/g, '\n'), []));
  return out;
}
